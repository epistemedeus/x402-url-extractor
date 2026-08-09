import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
} from "viem";

const BASE_CHAIN_ID = 8453;
const ORACLE_PRICE_SCALE = 10n ** 36n;
const BASE_RPCS = (process.env.MORPHO_BASE_RPC_URLS || "https://mainnet.base.org,https://base.drpc.org,https://base-rpc.publicnode.com")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const PRE_LIQUIDATE_EVENT = [{
  type: "event",
  name: "PreLiquidate",
  inputs: [
    { name: "id", type: "bytes32", indexed: true },
    { name: "liquidator", type: "address", indexed: true },
    { name: "borrower", type: "address", indexed: true },
    { name: "repaidAssets", type: "uint256", indexed: false },
    { name: "repaidShares", type: "uint256", indexed: false },
    { name: "seizedAssets", type: "uint256", indexed: false },
  ],
}];

const MARKET_PARAMS_COMPONENTS = [
  { name: "loanToken", type: "address" },
  { name: "collateralToken", type: "address" },
  { name: "oracle", type: "address" },
  { name: "irm", type: "address" },
  { name: "lltv", type: "uint256" },
];
const MARKET_PARAMS_ABI = [{
  type: "function",
  name: "marketParams",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "tuple", components: MARKET_PARAMS_COMPONENTS }],
}];
const PRE_PARAMS_ABI = [{
  type: "function",
  name: "preLiquidationParams",
  stateMutability: "view",
  inputs: [],
  outputs: [{
    name: "",
    type: "tuple",
    components: [
      { name: "preLltv", type: "uint256" },
      { name: "preLCF1", type: "uint256" },
      { name: "preLCF2", type: "uint256" },
      { name: "preLIF1", type: "uint256" },
      { name: "preLIF2", type: "uint256" },
      { name: "preLiquidationOracle", type: "address" },
    ],
  }],
}];
const ORACLE_ABI = [{ type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }];
const DECIMALS_ABI = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] }];
const SYMBOL_ABI = [{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] }];

function isTransactionHash(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(value || "").trim());
}

function ratioNumber(numerator, denominator, scale = 1_000_000n) {
  if (denominator === 0n) return null;
  return Number((numerator * scale) / denominator) / Number(scale);
}

function formatUnits(raw, decimals) {
  const places = Math.max(0, Math.min(36, Number(decimals) || 0));
  const padded = raw.toString().padStart(places + 1, "0");
  const integer = places ? padded.slice(0, -places) || "0" : padded;
  const fraction = places ? padded.slice(-places).replace(/0+$/, "").slice(0, 12) : "";
  return `${integer}${fraction ? `.${fraction}` : ""}`;
}

function percentWad(raw) {
  return ratioNumber(BigInt(raw) * 100n, 10n ** 18n);
}

async function defaultRpcRequest(method, params, {
  fetchImpl = fetch,
  rpcUrls = BASE_RPCS,
  timeoutMs = 8_000,
} = {}) {
  let lastError;
  for (const rpcUrl of rpcUrls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Base RPC HTTP ${response.status}`);
      if (!payload || payload.error || payload.result === undefined || payload.result === null) {
        throw new Error(payload?.error?.message || "Base RPC returned no result");
      }
      return payload.result;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Base RPC unavailable");
}

async function contractRead(rpcRequest, address, abi, functionName, blockTag, rpcOptions) {
  const data = encodeFunctionData({ abi, functionName });
  const result = await rpcRequest("eth_call", [{ to: address, data }, blockTag], rpcOptions);
  return decodeFunctionResult({ abi, functionName, data: result });
}

async function replayEvent(log, { rpcRequest, blockTag, rpcOptions }) {
  const decoded = decodeEventLog({
    abi: PRE_LIQUIDATE_EVENT,
    data: log.data,
    topics: log.topics,
    strict: true,
  });
  const contract = log.address;
  const marketParams = await contractRead(rpcRequest, contract, MARKET_PARAMS_ABI, "marketParams", blockTag, rpcOptions);
  const preParams = await contractRead(rpcRequest, contract, PRE_PARAMS_ABI, "preLiquidationParams", blockTag, rpcOptions);
  const [oraclePrice, loanDecimals, collateralDecimals, loanSymbol, collateralSymbol] = await Promise.all([
    contractRead(rpcRequest, preParams.preLiquidationOracle, ORACLE_ABI, "price", blockTag, rpcOptions),
    contractRead(rpcRequest, marketParams.loanToken, DECIMALS_ABI, "decimals", blockTag, rpcOptions),
    contractRead(rpcRequest, marketParams.collateralToken, DECIMALS_ABI, "decimals", blockTag, rpcOptions),
    contractRead(rpcRequest, marketParams.loanToken, SYMBOL_ABI, "symbol", blockTag, rpcOptions).catch(() => null),
    contractRead(rpcRequest, marketParams.collateralToken, SYMBOL_ABI, "symbol", blockTag, rpcOptions).catch(() => null),
  ]);
  const repaidAssets = BigInt(decoded.args.repaidAssets);
  const seizedAssets = BigInt(decoded.args.seizedAssets);
  const collateralQuotedInLoanRaw = (seizedAssets * BigInt(oraclePrice)) / ORACLE_PRICE_SCALE;
  const grossIncentiveRaw = collateralQuotedInLoanRaw - repaidAssets;
  const grossIncentivePct = repaidAssets === 0n
    ? null
    : ratioNumber(grossIncentiveRaw * 100n, repaidAssets);

  return {
    contract,
    marketId: decoded.args.id,
    liquidator: decoded.args.liquidator,
    borrower: decoded.args.borrower,
    assets: {
      repaid: {
        token: marketParams.loanToken,
        symbol: loanSymbol,
        decimals: Number(loanDecimals),
        raw: repaidAssets.toString(),
        amount: formatUnits(repaidAssets, Number(loanDecimals)),
      },
      seized: {
        token: marketParams.collateralToken,
        symbol: collateralSymbol,
        decimals: Number(collateralDecimals),
        raw: seizedAssets.toString(),
        amount: formatUnits(seizedAssets, Number(collateralDecimals)),
      },
      repaidSharesRaw: BigInt(decoded.args.repaidShares).toString(),
    },
    protocolOracle: {
      address: preParams.preLiquidationOracle,
      priceRaw: BigInt(oraclePrice).toString(),
      scale: ORACLE_PRICE_SCALE.toString(),
      collateralQuotedInLoanRaw: collateralQuotedInLoanRaw.toString(),
      collateralQuotedInLoanAmount: formatUnits(collateralQuotedInLoanRaw, Number(loanDecimals)),
    },
    grossEconomics: {
      incentiveInLoanRaw: grossIncentiveRaw.toString(),
      incentiveInLoanAmount: formatUnits(grossIncentiveRaw < 0n ? -grossIncentiveRaw : grossIncentiveRaw, Number(loanDecimals)),
      incentiveSign: grossIncentiveRaw < 0n ? "negative" : "positive",
      incentivePct: grossIncentivePct,
      boundary: "Protocol-oracle collateral quote minus repaid loan assets before gas, swap slippage, callback costs, funding costs, MEV, failed attempts, and token-specific behavior.",
    },
    parameters: {
      marketLltvRaw: marketParams.lltv.toString(),
      marketLltvPct: percentWad(marketParams.lltv),
      preLltvRaw: preParams.preLltv.toString(),
      preLltvPct: percentWad(preParams.preLltv),
      closeFactorStartRaw: preParams.preLCF1.toString(),
      closeFactorEndRaw: preParams.preLCF2.toString(),
      incentiveStartRaw: preParams.preLIF1.toString(),
      incentiveEndRaw: preParams.preLIF2.toString(),
    },
  };
}

export async function morphoPreLiquidationReplay(rawTransactionHash, {
  chainId = BASE_CHAIN_ID,
  rpcRequest = defaultRpcRequest,
  fetchImpl = fetch,
  rpcUrls = BASE_RPCS,
  timeoutMs = 8_000,
} = {}) {
  const transactionHash = String(rawTransactionHash || "").trim().toLowerCase();
  if (!isTransactionHash(transactionHash)) throw new Error("invalid transactionHash: expected a 0x-prefixed 32-byte hex value");
  if (Number(chainId) !== BASE_CHAIN_ID) throw new Error("this product supports Base mainnet only (chainId 8453)");
  const rpcOptions = { fetchImpl, rpcUrls, timeoutMs };
  const receipt = await rpcRequest("eth_getTransactionReceipt", [transactionHash], rpcOptions);
  if (Number(BigInt(receipt.status || "0x0")) !== 1) throw new Error("transaction did not execute successfully");
  const matchingLogs = (receipt.logs || []).filter((log) => {
    try {
      decodeEventLog({ abi: PRE_LIQUIDATE_EVENT, data: log.data, topics: log.topics, strict: true });
      return true;
    } catch {
      return false;
    }
  });
  if (!matchingLogs.length) throw new Error("transaction contains no decodable Morpho PreLiquidate event");
  const blockTag = receipt.blockNumber;
  const [transaction, block, events] = await Promise.all([
    rpcRequest("eth_getTransactionByHash", [transactionHash], rpcOptions),
    rpcRequest("eth_getBlockByNumber", [blockTag, false], rpcOptions),
    Promise.all(matchingLogs.map((log) => replayEvent(log, { rpcRequest, blockTag, rpcOptions }))),
  ]);
  const gasUsed = BigInt(receipt.gasUsed || 0);
  const effectiveGasPrice = BigInt(receipt.effectiveGasPrice || transaction.gasPrice || 0);
  const gasCostWei = gasUsed * effectiveGasPrice;

  return {
    ok: true,
    product: "morpho-preliquidation-replay",
    version: "1.0.0",
    chain: { id: BASE_CHAIN_ID, name: "Base mainnet" },
    transaction: {
      hash: transactionHash,
      blockNumber: Number(BigInt(receipt.blockNumber)),
      blockTimestamp: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(),
      from: transaction.from,
      to: transaction.to,
      status: "success",
      gasUsed: gasUsed.toString(),
      effectiveGasPriceWei: effectiveGasPrice.toString(),
      gasCostWei: gasCostWei.toString(),
      gasCostEth: formatUnits(gasCostWei, 18),
    },
    eventCount: events.length,
    events,
    verification: {
      receipt: "fresh direct Base RPC",
      event: "strict ABI decode of the official PreLiquidate signature",
      params: "PreLiquidation immutable contract reads at the execution block",
      price: "PreLiquidation oracle read at the execution block",
    },
    boundary: "Historical deterministic replay, not a profitability claim or execution recommendation. Gross event economics omit swaps, funding, callback behavior, competing transactions, failures, MEV, and the native-gas conversion into the loan asset. No wallet was accessed and no transaction was prepared, signed, broadcast, or funded.",
  };
}

export const MORPHO_PRELIQUIDATION_REPLAY_CONSTANTS = {
  BASE_CHAIN_ID,
  ORACLE_PRICE_SCALE: ORACLE_PRICE_SCALE.toString(),
};
