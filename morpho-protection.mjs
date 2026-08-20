import { encodeAbiParameters, encodeFunctionData, keccak256 } from "viem";
import { z } from "zod";
import { morphoPosition, MORPHO_POSITION_CONSTANTS } from "./morpho-position.mjs";

const WAD = 10n ** 18n;
const ORACLE_PRICE_SCALE = 10n ** 36n;
const BPS = 10_000n;
const MORPHO_BLUE = MORPHO_POSITION_CONSTANTS.MORPHO_BLUE;

const ERC20_APPROVE_ABI = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}];

const MARKET_PARAMS_COMPONENTS = [
  { name: "loanToken", type: "address" },
  { name: "collateralToken", type: "address" },
  { name: "oracle", type: "address" },
  { name: "irm", type: "address" },
  { name: "lltv", type: "uint256" },
];

const MORPHO_PROTECTION_ABI = [
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketParams", type: "tuple", components: MARKET_PARAMS_COMPONENTS },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "assetsRepaid", type: "uint256" }, { name: "sharesRepaid", type: "uint256" }],
  },
  {
    type: "function",
    name: "supplyCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketParams", type: "tuple", components: MARKET_PARAMS_COMPONENTS },
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
];

function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) throw new Error("invalid zero denominator");
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n;
}

function parseDecimalWad(value, label) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,18})?$/.test(text)) throw new Error(`${label} must be a positive decimal with at most 18 places`);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * WAD + BigInt(fraction.padEnd(18, "0"));
}

function parseShockBps(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < -99 || number > 0) {
    throw new Error("protectAgainstShockPct must be from -99 through 0");
  }
  return BigInt(Math.round(number * 100));
}

function parseBufferBps(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 500) {
    throw new Error("executionBufferBps must be an integer from 0 through 500");
  }
  return BigInt(number);
}

function formatUnits(raw, decimals) {
  const places = Math.max(0, Math.min(36, Number(decimals) || 0));
  const padded = raw.toString().padStart(places + 1, "0");
  const integer = places ? padded.slice(0, -places) || "0" : padded;
  const fraction = places ? padded.slice(-places).replace(/0+$/, "").slice(0, 12) : "";
  return `${integer}${fraction ? `.${fraction}` : ""}`;
}

function ratioNumber(numerator, denominator, scale = 1_000_000n) {
  if (denominator === 0n) return null;
  return Number((numerator * scale) / denominator) / Number(scale);
}

function healthFactor({ collateral, borrowed, price, lltv }) {
  if (borrowed === 0n) return null;
  const collateralValue = (collateral * price) / ORACLE_PRICE_SCALE;
  return ratioNumber(collateralValue * lltv, borrowed * WAD);
}

function withBuffer(amount, bufferBps, cap = null) {
  const buffered = ceilDiv(amount * (BPS + bufferBps), BPS);
  return cap === null ? buffered : buffered > cap ? cap : buffered;
}

function asMarketTuple(params, expectedMarketId) {
  const values = [params.loanToken, params.collateralToken, params.oracle, params.irm];
  if (values.some((value) => !/^0x[0-9a-fA-F]{40}$/.test(String(value || "")))) {
    throw new Error("Morpho market parameters are incomplete; no action plan was prepared");
  }
  const tuple = {
    loanToken: params.loanToken,
    collateralToken: params.collateralToken,
    oracle: params.oracle,
    irm: params.irm,
    lltv: BigInt(params.lltvRaw),
  };
  const derivedMarketId = keccak256(encodeAbiParameters(
    [{ type: "tuple", components: MARKET_PARAMS_COMPONENTS }],
    [tuple],
  ));
  if (derivedMarketId.toLowerCase() !== String(expectedMarketId || "").toLowerCase()) {
    throw new Error("Morpho market parameters do not hash to the observed market ID; no action plan was prepared");
  }
  return tuple;
}

function transaction({ to, data, purpose }) {
  return { to, value: "0", data, purpose };
}

function quotePosition(position, address, targetHealthWad, shockBps, bufferBps) {
  const directState = position.directRpc;
  if (!directState?.corePositionVerified || !directState.oraclePriceRaw) {
    return {
      marketId: position.marketId,
      currentHealthFactor: position.risk.healthFactor,
      status: "state_unverified",
      plans: [],
      explanation: "Direct RPC did not confirm the indexed collateral and borrow shares with a fresh oracle read, so no transaction plan was prepared.",
    };
  }
  const collateral = BigInt(position.assets.collateral.amountRaw);
  const borrowed = BigInt(position.assets.loan.borrowedRaw);
  const price = BigInt(directState.oraclePriceRaw);
  const lltv = BigInt(position.marketParams?.lltvRaw || position.risk.liquidationLtvRaw);
  const shockedPrice = (price * (BPS + shockBps)) / BPS;
  const collateralValueAtShock = (collateral * shockedPrice) / ORACLE_PRICE_SCALE;
  const targetBorrow = (collateralValueAtShock * lltv) / targetHealthWad;
  const baseRepay = borrowed > targetBorrow ? borrowed - targetBorrow : 0n;
  const repay = withBuffer(baseRepay, bufferBps, borrowed);

  const requiredCollateralValue = ceilDiv(borrowed * targetHealthWad, lltv);
  const requiredCollateral = ceilDiv(requiredCollateralValue * ORACLE_PRICE_SCALE, shockedPrice);
  const baseCollateralAdd = requiredCollateral > collateral ? requiredCollateral - collateral : 0n;
  const collateralAdd = withBuffer(baseCollateralAdd, bufferBps);
  if (price <= 0n || shockedPrice <= 0n) {
    return {
      marketId: position.marketId,
      currentHealthFactor: position.risk.healthFactor,
      status: "state_unverified",
      plans: [],
      explanation: "The fresh direct-RPC oracle price was zero or invalid, so no transaction plan was prepared.",
    };
  }
  let marketParams;
  try {
    marketParams = asMarketTuple(position.marketParams, position.marketId);
  } catch (error) {
    return {
      marketId: position.marketId,
      currentHealthFactor: position.risk.healthFactor,
      status: "state_unverified",
      plans: [],
      explanation: String(error?.message || error),
    };
  }

  const common = {
    marketId: position.marketId,
    currentHealthFactor: position.risk.healthFactor,
    healthFactorAtShockBeforeAction: healthFactor({ collateral, borrowed, price: shockedPrice, lltv }),
    targetHealthFactorAtShock: ratioNumber(targetHealthWad, WAD),
    shock: { collateralPricePct: Number(shockBps) / 100, oraclePriceRaw: shockedPrice.toString() },
    stateBasis: {
      blockNumber: directState.blockNumber,
      collateralAndBorrowShares: "direct_rpc_exact_match",
      oraclePrice: "direct_rpc_fresh_read",
      borrowAssets: "indexed amount with explicit execution buffer",
      marketParams: "keccak256 match to observed Morpho market ID",
    },
  };

  if (baseRepay === 0n && baseCollateralAdd === 0n) {
    return {
      ...common,
      status: "target_met",
      plans: [],
      explanation: "The indexed position already meets the requested target under the specified collateral-price shock.",
    };
  }

  const repayHealth = healthFactor({ collateral, borrowed: borrowed - repay, price: shockedPrice, lltv });
  const collateralHealth = healthFactor({ collateral: collateral + collateralAdd, borrowed, price: shockedPrice, lltv });
  const repayApproval = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [MORPHO_BLUE, repay],
  });
  const repayCall = encodeFunctionData({
    abi: MORPHO_PROTECTION_ABI,
    functionName: "repay",
    args: [marketParams, repay, 0n, address, "0x"],
  });
  const collateralApproval = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [MORPHO_BLUE, collateralAdd],
  });
  const collateralCall = encodeFunctionData({
    abi: MORPHO_PROTECTION_ABI,
    functionName: "supplyCollateral",
    args: [marketParams, collateralAdd, address, "0x"],
  });

  return {
    ...common,
    status: "protection_available",
    plans: [
      {
        id: "partial_repay",
        asset: { address: position.assets.loan.address, symbol: position.assets.loan.symbol, decimals: position.assets.loan.decimals },
        amountRaw: repay.toString(),
        amount: formatUnits(repay, position.assets.loan.decimals),
        expectedHealthFactorAtShock: repayHealth,
        transactions: [
          transaction({ to: position.assets.loan.address, data: repayApproval, purpose: "Approve the Morpho contract to pull the bounded loan-asset amount." }),
          transaction({ to: MORPHO_BLUE, data: repayCall, purpose: "Partially repay debt on behalf of the borrower." }),
        ],
      },
      {
        id: "add_collateral",
        asset: { address: position.assets.collateral.address, symbol: position.assets.collateral.symbol, decimals: position.assets.collateral.decimals },
        amountRaw: collateralAdd.toString(),
        amount: formatUnits(collateralAdd, position.assets.collateral.decimals),
        expectedHealthFactorAtShock: collateralHealth,
        transactions: [
          transaction({ to: position.assets.collateral.address, data: collateralApproval, purpose: "Approve the Morpho contract to pull the bounded collateral amount." }),
          transaction({ to: MORPHO_BLUE, data: collateralCall, purpose: "Supply additional collateral on behalf of the borrower." }),
        ],
      },
    ],
  };
}

export async function morphoProtection(rawAddress, {
  targetHealthFactor = "1.25",
  protectAgainstShockPct = -10,
  executionBufferBps = 25,
  positionLoader = morphoPosition,
  positionOptions = {},
} = {}) {
  const targetHealthWad = parseDecimalWad(targetHealthFactor, "targetHealthFactor");
  if (targetHealthWad <= WAD || targetHealthWad > 5n * WAD) {
    throw new Error("targetHealthFactor must be greater than 1 and at most 5");
  }
  const shockBps = parseShockBps(protectAgainstShockPct);
  const bufferBps = parseBufferBps(executionBufferBps);
  const snapshot = await positionLoader(rawAddress, positionOptions);
  const address = snapshot.address;
  const quotes = snapshot.positions.map((position) =>
    quotePosition(position, address, targetHealthWad, shockBps, bufferBps));

  return {
    ok: true,
    product: "morpho-protection-quote",
    version: "1.0.0",
    address,
    chain: snapshot.chain,
    fetchedAt: snapshot.fetchedAt,
    latestIndexedAt: snapshot.latestIndexedAt,
    inputs: {
      targetHealthFactor: ratioNumber(targetHealthWad, WAD),
      protectAgainstShockPct: Number(shockBps) / 100,
      executionBufferBps: Number(bufferBps),
    },
    positionCount: quotes.length,
    actionableCount: quotes.filter((quote) => quote.status === "protection_available").length,
    unverifiedCount: quotes.filter((quote) => quote.status === "state_unverified").length,
    quotes,
    source: snapshot.source,
    invariants: {
      signing: "none",
      broadcasting: "none",
      custody: "none",
      value: "0 on every unsigned transaction template",
      revalidation: "Re-read position, accrued debt, market parameters, oracle, balances, allowances, gas, and policy immediately before signing.",
      simulation: "Simulate the complete approval plus Morpho call sequence against fresh chain state before signing.",
      postconditions: [
        "debt or collateral changes only in the quoted market and direction",
        "post-action health meets the requested target under the requested shock",
        "fees, gas, token behavior, and approvals remain inside caller policy",
      ],
    },
    boundary: "Deterministic read-only quote and unsigned transaction templates. No wallet is accessed and no transaction is signed or broadcast. Amounts use indexed debt plus an explicit buffer; this is not a promise of execution, financial advice, or a substitute for fresh simulation.",
  };
}

export const MORPHO_PROTECTION_CONSTANTS = {
  MORPHO_BLUE,
  WAD: WAD.toString(),
  ORACLE_PRICE_SCALE: ORACLE_PRICE_SCALE.toString(),
};

const protectionAssetSchema = z.object({
  address: z.string().nullable(),
  symbol: z.string().nullable(),
  decimals: z.number(),
}).strict();

const protectionTransactionSchema = z.object({
  to: z.string(),
  value: z.literal("0"),
  data: z.string().regex(/^0x[0-9a-fA-F]+$/),
  purpose: z.string(),
}).strict();

const protectionPlanSchema = z.object({
  id: z.enum(["partial_repay", "add_collateral"]),
  asset: protectionAssetSchema,
  amountRaw: z.string(),
  amount: z.string(),
  expectedHealthFactorAtShock: z.number().nullable(),
  transactions: z.array(protectionTransactionSchema).length(2),
}).strict();

const protectionQuoteCommon = {
  marketId: z.string(),
  currentHealthFactor: z.number().nullable(),
  healthFactorAtShockBeforeAction: z.number().nullable(),
  targetHealthFactorAtShock: z.number().nullable(),
  shock: z.object({
    collateralPricePct: z.number(),
    oraclePriceRaw: z.string(),
  }).strict(),
  stateBasis: z.object({
    blockNumber: z.number().int().nullable(),
    collateralAndBorrowShares: z.literal("direct_rpc_exact_match"),
    oraclePrice: z.literal("direct_rpc_fresh_read"),
    borrowAssets: z.literal("indexed amount with explicit execution buffer"),
    marketParams: z.literal("keccak256 match to observed Morpho market ID"),
  }).strict(),
};

export const morphoProtectionMcpOutputSchema = z.object({
  ok: z.literal(true),
  product: z.literal("morpho-protection-quote"),
  version: z.literal("1.0.0"),
  address: z.string(),
  chain: z.object({
    id: z.number().int(),
    name: z.string(),
  }).strict(),
  fetchedAt: z.string().datetime(),
  latestIndexedAt: z.string().datetime().nullable(),
  inputs: z.object({
    targetHealthFactor: z.number(),
    protectAgainstShockPct: z.number(),
    executionBufferBps: z.number().int(),
  }).strict(),
  positionCount: z.number().int().nonnegative(),
  actionableCount: z.number().int().nonnegative(),
  unverifiedCount: z.number().int().nonnegative(),
  quotes: z.array(z.discriminatedUnion("status", [
    z.object({
      marketId: z.string(),
      currentHealthFactor: z.number().nullable(),
      status: z.literal("state_unverified"),
      plans: z.array(protectionPlanSchema).max(0),
      explanation: z.string(),
    }).strict(),
    z.object({
      ...protectionQuoteCommon,
      status: z.literal("target_met"),
      plans: z.array(protectionPlanSchema).max(0),
      explanation: z.string(),
    }).strict(),
    z.object({
      ...protectionQuoteCommon,
      status: z.literal("protection_available"),
      plans: z.array(protectionPlanSchema).length(2),
    }).strict(),
  ])),
  source: z.object({
    provider: z.string(),
  }).passthrough(),
  invariants: z.object({
    signing: z.literal("none"),
    broadcasting: z.literal("none"),
    custody: z.literal("none"),
    value: z.literal("0 on every unsigned transaction template"),
    revalidation: z.string(),
    simulation: z.string(),
    postconditions: z.array(z.string()).min(1),
  }).strict(),
  boundary: z.string(),
}).strict();
