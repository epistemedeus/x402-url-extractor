import { decodeFunctionResult, encodeFunctionData } from "viem";

const MORPHO_GRAPHQL = "https://api.morpho.org/graphql";
const BASE_CHAIN_ID = 8453;
const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const WAD = 10n ** 18n;
const ORACLE_PRICE_SCALE = 10n ** 36n;
const BASE_RPCS = (process.env.MORPHO_BASE_RPC_URLS || "https://mainnet.base.org,https://base-rpc.publicnode.com,https://base.llamarpc.com")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const POSITION_ABI = [{
  type: "function",
  name: "position",
  stateMutability: "view",
  inputs: [{ name: "id", type: "bytes32" }, { name: "user", type: "address" }],
  outputs: [{ name: "supplyShares", type: "uint256" }, { name: "borrowShares", type: "uint128" }, { name: "collateral", type: "uint128" }],
}];
const ORACLE_ABI = [{
  type: "function",
  name: "price",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "uint256" }],
}];

const POSITION_QUERY = `
  query SameDayDeskMorphoPositions($where: MarketPositionFilters!) {
    marketPositions(first: 100, where: $where) {
      items {
        healthFactor
        priceVariationToLiquidationPrice
        market {
          marketId
          lltv
          loanAsset { address symbol decimals price { usd timestamp } }
          collateralAsset { address symbol decimals price { usd timestamp } }
          oracle { address }
          state { timestamp price }
        }
        state {
          timestamp
          collateral
          collateralUsd
          borrowAssets
          borrowAssetsUsd
          supplyAssets
          supplyAssetsUsd
          borrowShares
        }
      }
      pageInfo { count countTotal limit skip }
    }
  }
`;

function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || "").trim());
}

function toBig(value, label) {
  try {
    return BigInt(value ?? 0);
  } catch {
    throw new Error(`Morpho returned an invalid ${label}`);
  }
}

function formatUnits(raw, decimals) {
  const places = Math.max(0, Math.min(36, Number(decimals) || 0));
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const padded = absolute.toString().padStart(places + 1, "0");
  const integer = places ? padded.slice(0, -places) || "0" : padded;
  const fraction = places ? padded.slice(-places).replace(/0+$/, "").slice(0, 10) : "";
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function ratioNumber(numerator, denominator, scale = 1_000_000n) {
  if (denominator === 0n) return null;
  return Number((numerator * scale) / denominator) / Number(scale);
}

function wadNumber(value) {
  return ratioNumber(value, WAD);
}

function nullableNumber(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? null
    : Number(value);
}

function parseShockBps(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < -99 || numeric > 100) {
    throw new Error("shock percentages must be finite numbers from -99 through 100");
  }
  return Math.round(numeric * 100);
}

function computeRisk({ collateral, borrowed, price, lltv }) {
  if (collateral <= 0n || borrowed <= 0n || price <= 0n || lltv <= 0n) return null;
  const collateralValue = (collateral * price) / ORACLE_PRICE_SCALE;
  if (collateralValue <= 0n) return null;
  const currentLtvWad = (borrowed * WAD) / collateralValue;
  const healthFactorWad = (collateralValue * lltv) / borrowed;
  const maxBorrow = (collateralValue * lltv) / WAD;
  const liquidationPrice = (borrowed * ORACLE_PRICE_SCALE * WAD) / (collateral * lltv);
  const priceMoveToLiquidationWad = ((liquidationPrice - price) * WAD) / price;
  return {
    collateralValue,
    currentLtvWad,
    healthFactorWad,
    maxBorrow,
    liquidationBuffer: maxBorrow - borrowed,
    liquidationPrice,
    priceMoveToLiquidationWad,
    liquidatable: healthFactorWad < WAD,
  };
}

function buildScenario(base, shockBps) {
  const shockedPrice = (base.price * BigInt(10_000 + shockBps)) / 10_000n;
  const risk = computeRisk({ ...base, price: shockedPrice });
  return {
    collateralPriceShockPct: shockBps / 100,
    oraclePriceRaw: shockedPrice.toString(),
    healthFactor: risk ? wadNumber(risk.healthFactorWad) : null,
    currentLtvPct: risk ? wadNumber(risk.currentLtvWad) * 100 : null,
    liquidatable: risk?.liquidatable ?? null,
  };
}

async function fetchGraphql({ endpoint, fetchImpl, where, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "SameDayDesk-Morpho-Risk/0.1 (contact@samedaydesk.com)",
      },
      body: JSON.stringify({ query: POSITION_QUERY, variables: { where } }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Morpho API HTTP ${response.status}`);
    }
    if (!payload || payload.errors?.length) {
      throw new Error(`Morpho API error: ${payload?.errors?.[0]?.message || "invalid response"}`);
    }
    return payload.data?.marketPositions;
  } finally {
    clearTimeout(timeout);
  }
}

async function directRpcCrossCheck({ address, positions, fetchImpl, timeoutMs, rpcUrls = BASE_RPCS }) {
  const selected = positions.slice(0, 8);
  if (!selected.length) {
    return { blockNumber: null, checkedPositions: 0, verdict: "not_applicable", rpcUrl: null };
  }
  const calls = [{ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }];
  const oracleCallIds = new Map();
  selected.forEach((position, index) => {
    calls.push({
      jsonrpc: "2.0",
      id: 100 + index,
      method: "eth_call",
      params: [{
        to: MORPHO_BLUE,
        data: encodeFunctionData({ abi: POSITION_ABI, functionName: "position", args: [position.marketId, address] }),
      }, "latest"],
    });
    const oracleKey = String(position.oracle.address).toLowerCase();
    if (!oracleCallIds.has(oracleKey)) {
      const id = 200 + oracleCallIds.size;
      oracleCallIds.set(oracleKey, id);
      calls.push({
        jsonrpc: "2.0",
        id,
        method: "eth_call",
        params: [{
          to: position.oracle.address,
          data: encodeFunctionData({ abi: ORACLE_ABI, functionName: "price" }),
        }, "latest"],
      });
    }
  });

  let lastError;
  for (const rpcUrl of rpcUrls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(calls),
        signal: controller.signal,
      });
      const replies = await response.json();
      if (!response.ok || !Array.isArray(replies)) throw new Error(`Base RPC HTTP ${response.status}`);
      const byId = new Map(replies.map((reply) => [reply.id, reply]));
      const blockHex = byId.get(1)?.result;
      const blockNumber = blockHex ? Number(BigInt(blockHex)) : null;
      let exact = 0;
      for (let index = 0; index < selected.length; index += 1) {
        const positionReply = byId.get(100 + index);
        const oracleReply = byId.get(oracleCallIds.get(String(selected[index].oracle.address).toLowerCase()));
        if (positionReply?.error || oracleReply?.error || !positionReply?.result || !oracleReply?.result) {
          selected[index].directRpc = { verified: false, reason: "rpc_call_failed", blockNumber };
          continue;
        }
        const [, borrowShares, collateral] = decodeFunctionResult({
          abi: POSITION_ABI,
          functionName: "position",
          data: positionReply.result,
        });
        const oraclePrice = decodeFunctionResult({
          abi: ORACLE_ABI,
          functionName: "price",
          data: oracleReply.result,
        });
        const collateralMatches = collateral.toString() === selected[index]._raw.collateral;
        const borrowSharesMatches = borrowShares.toString() === selected[index]._raw.borrowShares;
        const oraclePriceMatches = oraclePrice.toString() === selected[index]._raw.price;
        const verified = collateralMatches && borrowSharesMatches && oraclePriceMatches;
        if (verified) exact += 1;
        selected[index].directRpc = {
          verified,
          blockNumber,
          collateralMatches,
          borrowSharesMatches,
          oraclePriceMatches,
        };
      }
      return {
        blockNumber,
        checkedPositions: selected.length,
        exactPositions: exact,
        verdict: exact === selected.length ? "exact_match" : "mismatch",
        rpcUrl,
      };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  for (const position of selected) {
    position.directRpc = { verified: false, reason: "rpc_unavailable", blockNumber: null };
  }
  return {
    blockNumber: null,
    checkedPositions: selected.length,
    exactPositions: 0,
    verdict: "unavailable",
    rpcUrl: null,
    error: String(lastError?.message || lastError || "RPC unavailable"),
  };
}

export async function morphoPosition(rawAddress, {
  chainId = BASE_CHAIN_ID,
  shocks = [-10, -20, -30],
  endpoint = MORPHO_GRAPHQL,
  fetchImpl = fetch,
  timeoutMs = 8_000,
  rpcCheck = true,
  rpcUrls = BASE_RPCS,
} = {}) {
  const address = String(rawAddress || "").trim();
  if (!isAddress(address)) {
    throw new Error("invalid address: expected a 0x-prefixed 40-hex EVM address");
  }
  if (Number(chainId) !== BASE_CHAIN_ID) {
    throw new Error("this canary supports Base mainnet only (chainId 8453)");
  }
  const shockBps = [...new Set((Array.isArray(shocks) ? shocks : [shocks]).map(parseShockBps))]
    .sort((a, b) => b - a)
    .slice(0, 8);

  const page = await fetchGraphql({
    endpoint,
    fetchImpl,
    timeoutMs,
    where: {
      userAddress_in: [address],
      chainId_in: [BASE_CHAIN_ID],
      borrowShares_gte: "1",
    },
  });
  if (!page || !Array.isArray(page.items)) {
    throw new Error("Morpho API returned no position collection");
  }

  const fetchedAt = new Date().toISOString();
  const positions = page.items.flatMap((item) => {
    const market = item?.market;
    const state = item?.state;
    if (!market || !state || !market.state) return [];
    const collateral = toBig(state.collateral, "collateral amount");
    const borrowed = toBig(state.borrowAssets, "borrow amount");
    const price = toBig(market.state.price, "oracle price");
    const lltv = toBig(market.lltv, "LLTV");
    const risk = computeRisk({ collateral, borrowed, price, lltv });
    if (!risk) return [];
    const loanDecimals = Number(market.loanAsset?.decimals ?? 0);
    const collateralDecimals = Number(market.collateralAsset?.decimals ?? 0);
    const indexedAt = new Date(Number(state.timestamp || market.state.timestamp) * 1000).toISOString();
    const apiHealth = Number.isFinite(Number(item.healthFactor)) ? Number(item.healthFactor) : null;
    const computedHealth = wadNumber(risk.healthFactorWad);

    return [{
      marketId: market.marketId,
      assets: {
        collateral: {
          address: market.collateralAsset?.address || null,
          symbol: market.collateralAsset?.symbol || null,
          decimals: collateralDecimals,
          amount: formatUnits(collateral, collateralDecimals),
          amountRaw: collateral.toString(),
          usd: nullableNumber(state.collateralUsd),
        },
        loan: {
          address: market.loanAsset?.address || null,
          symbol: market.loanAsset?.symbol || null,
          decimals: loanDecimals,
          borrowed: formatUnits(borrowed, loanDecimals),
          borrowedRaw: borrowed.toString(),
          borrowedUsd: nullableNumber(state.borrowAssetsUsd),
        },
      },
      oracle: {
        address: market.oracle?.address || null,
        priceRaw: price.toString(),
        scale: ORACLE_PRICE_SCALE.toString(),
        indexedAt,
      },
      risk: {
        currentLtvPct: wadNumber(risk.currentLtvWad) * 100,
        liquidationLtvPct: wadNumber(lltv) * 100,
        healthFactor: computedHealth,
        apiHealthFactor: apiHealth,
        healthFactorDifference: apiHealth === null ? null : Math.abs(computedHealth - apiHealth),
        liquidationBufferLoanAsset: formatUnits(risk.liquidationBuffer, loanDecimals),
        liquidationPriceRaw: risk.liquidationPrice.toString(),
        collateralPriceMoveToLiquidationPct: wadNumber(risk.priceMoveToLiquidationWad) * 100,
        liquidatableAtIndexedState: risk.liquidatable,
      },
      scenarios: shockBps.map((shock) => buildScenario({ collateral, borrowed, price, lltv }, shock)),
      _raw: {
        collateral: collateral.toString(),
        borrowShares: toBig(state.borrowShares, "borrow shares").toString(),
        price: price.toString(),
      },
    }];
  });

  const directRpc = rpcCheck
    ? await directRpcCrossCheck({ address, positions, fetchImpl, timeoutMs, rpcUrls })
    : { blockNumber: null, checkedPositions: 0, verdict: "disabled", rpcUrl: null };
  for (const position of positions) delete position._raw;

  const indexedTimes = positions
    .map((position) => Date.parse(position.oracle.indexedAt))
    .filter(Number.isFinite);
  const latestIndexedAt = indexedTimes.length ? new Date(Math.max(...indexedTimes)).toISOString() : null;

  return {
    ok: true,
    address: address.toLowerCase(),
    chain: { id: BASE_CHAIN_ID, name: "Base mainnet" },
    fetchedAt,
    latestIndexedAt,
    positionCount: positions.length,
    truncated: Number(page.pageInfo?.countTotal || 0) > 100,
    positions,
    source: {
      provider: "Morpho GraphQL API",
      endpoint,
      authority: "indexed observation, not execution-time chain truth",
      directRpc,
    },
    boundary: "Read-only deterministic calculations. Shock scenarios are not probabilities or financial advice. The Morpho API has no execution SLA; re-read the oracle and protocol state over direct RPC before any transaction.",
  };
}

export const MORPHO_POSITION_CONSTANTS = {
  BASE_CHAIN_ID,
  MORPHO_BLUE,
  WAD: WAD.toString(),
  ORACLE_PRICE_SCALE: ORACLE_PRICE_SCALE.toString(),
};
