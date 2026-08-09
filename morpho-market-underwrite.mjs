import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
} from "viem";

const MORPHO_GRAPHQL = "https://api.morpho.org/graphql";
const MORPHO_REST = "https://api.morpho.org/v0/blue/markets";
const BASE_CHAIN_ID = 8453;
const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const WAD = 10n ** 18n;
const BASE_RPCS = (process.env.MORPHO_BASE_RPC_URLS || "https://mainnet.base.org,https://base-rpc.publicnode.com,https://base.llamarpc.com")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const MARKET_PARAMS_COMPONENTS = [
  { name: "loanToken", type: "address" },
  { name: "collateralToken", type: "address" },
  { name: "oracle", type: "address" },
  { name: "irm", type: "address" },
  { name: "lltv", type: "uint256" },
];

const MARKET_ABI = [{
  type: "function",
  name: "market",
  stateMutability: "view",
  inputs: [{ name: "id", type: "bytes32" }],
  outputs: [
    { name: "totalSupplyAssets", type: "uint128" },
    { name: "totalSupplyShares", type: "uint128" },
    { name: "totalBorrowAssets", type: "uint128" },
    { name: "totalBorrowShares", type: "uint128" },
    { name: "lastUpdate", type: "uint128" },
    { name: "fee", type: "uint128" },
  ],
}];

const ORACLE_ABI = [{
  type: "function",
  name: "price",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "uint256" }],
}];

const MARKET_QUERY = `
  query SameDayDeskMorphoMarket($marketId: String!) {
    marketById(marketId: $marketId, chainId: 8453) {
      marketId
      lltv
      listed
      creationBlockNumber
      creationTimestamp
      irmAddress
      collateralAsset { address name symbol decimals isListed price { usd timestamp } }
      loanAsset { address name symbol decimals isListed price { usd timestamp } }
      oracle { address type }
      badDebt { underlying usd }
      realizedBadDebt { underlying usd }
      state {
        blockNumber timestamp price
        borrowAssets borrowAssetsUsd borrowShares
        supplyAssets supplyAssetsUsd supplyShares
        collateralAssets collateralAssetsUsd
        liquidityAssets liquidityAssetsUsd
        utilization borrowApy supplyApy fee
      }
      preLiquidations {
        items { address preLltv preLCF1 preLCF2 preLIF1 preLIF2 preLiquidationOracle }
        pageInfo { count countTotal limit skip }
      }
    }
    marketPositions(
      first: 100
      orderBy: BorrowShares
      orderDirection: Desc
      where: { marketUniqueKey_in: [$marketId], borrowShares_gte: 1 }
    ) {
      items {
        healthFactor
        user { address }
        state { timestamp borrowAssets borrowAssetsUsd borrowShares collateral collateralUsd }
      }
      pageInfo { count countTotal limit skip }
    }
  }
`;

function isMarketId(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(value || "").trim());
}

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

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ratioNumber(numerator, denominator, scale = 1_000_000n) {
  if (denominator === 0n) return null;
  return Number((numerator * scale) / denominator) / Number(scale);
}

function percentOf(value, total) {
  const numerator = finiteNumber(value);
  const denominator = finiteNumber(total);
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

function sumNumbers(values) {
  return values.reduce((sum, value) => sum + (finiteNumber(value) || 0), 0);
}

function formatUnits(raw, decimals) {
  const places = Math.max(0, Math.min(36, Number(decimals) || 0));
  const padded = raw.toString().padStart(places + 1, "0");
  const integer = places ? padded.slice(0, -places) || "0" : padded;
  const fraction = places ? padded.slice(-places).replace(/0+$/, "").slice(0, 12) : "";
  return `${integer}${fraction ? `.${fraction}` : ""}`;
}

function isoFromUnix(value) {
  const seconds = finiteNumber(value);
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

async function fetchJson(url, { fetchImpl, timeoutMs, init = {} }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Morpho upstream HTTP ${response.status} at ${url}`);
    if (!payload) throw new Error(`Morpho upstream returned invalid JSON at ${url}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGraphql({ endpoint, fetchImpl, marketId, timeoutMs }) {
  const payload = await fetchJson(endpoint, {
    fetchImpl,
    timeoutMs,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "SameDayDesk-Morpho-Underwrite/1.0 (contact@samedaydesk.com)",
      },
      body: JSON.stringify({ query: MARKET_QUERY, variables: { marketId } }),
    },
  });
  if (payload.errors?.length) {
    throw new Error(`Morpho API error: ${payload.errors[0]?.message || "invalid response"}`);
  }
  const market = payload.data?.marketById;
  const positions = payload.data?.marketPositions;
  if (!market || !positions || !Array.isArray(positions.items)) {
    throw new Error("Morpho GraphQL returned no market or borrower collection");
  }
  return { market, positions };
}

async function fetchRest({ restBase, fetchImpl, marketId, timeoutMs }) {
  const root = `${restBase}/${BASE_CHAIN_ID}:${marketId}`;
  const [config, state, apy, history] = await Promise.all([
    fetchJson(root, { fetchImpl, timeoutMs }),
    fetchJson(`${root}/state`, { fetchImpl, timeoutMs }),
    fetchJson(`${root}/apy-averages`, { fetchImpl, timeoutMs }),
    fetchJson(`${root}/state/history?lookback=thirty_days`, { fetchImpl, timeoutMs }),
  ]);
  for (const [label, payload] of Object.entries({ config, state, apy, history })) {
    if (!payload.data) throw new Error(`Morpho REST ${label} response did not contain data`);
  }
  return {
    config: config.data,
    state: state.data,
    apy: apy.data,
    history: history.data,
    indexedBlocks: {
      config: config.data.creation_block_number || null,
      state: state.data.last_indexed_block || state.last_indexed_block || null,
      apy: apy.data.last_indexed_block || apy.last_indexed_block || null,
      history: history.last_indexed_block || null,
    },
  };
}

function verifyParams(config, marketId) {
  const values = [config.loan_token, config.collateral_token, config.oracle_address, config.irm_address];
  if (values.some((value) => !isAddress(value))) {
    throw new Error("Morpho REST returned incomplete market parameters");
  }
  const params = {
    loanToken: config.loan_token,
    collateralToken: config.collateral_token,
    oracle: config.oracle_address,
    irm: config.irm_address,
    lltv: toBig(config.lltv_wad, "LLTV"),
  };
  const derivedMarketId = keccak256(encodeAbiParameters(
    [{ type: "tuple", components: MARKET_PARAMS_COMPONENTS }],
    [params],
  ));
  return {
    params,
    derivedMarketId,
    matches: derivedMarketId.toLowerCase() === marketId.toLowerCase(),
  };
}

async function directRpcCrossCheck({ marketId, oracle, restState, fetchImpl, timeoutMs, rpcUrls }) {
  const marketCall = encodeFunctionData({ abi: MARKET_ABI, functionName: "market", args: [marketId] });
  const oracleCall = isAddress(oracle)
    ? encodeFunctionData({ abi: ORACLE_ABI, functionName: "price" })
    : null;
  const calls = [
    { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_call", params: [{ to: MORPHO_BLUE, data: marketCall }, "latest"] },
  ];
  if (oracleCall) {
    calls.push({ jsonrpc: "2.0", id: 3, method: "eth_call", params: [{ to: oracle, data: oracleCall }, "latest"] });
  }

  let lastError;
  for (const rpcUrl of rpcUrls) {
    try {
      const payload = await fetchJson(rpcUrl, {
        fetchImpl,
        timeoutMs,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(calls),
        },
      });
      if (!Array.isArray(payload)) throw new Error("Base RPC did not return a batch response");
      const byId = new Map(payload.map((reply) => [reply.id, reply]));
      if (byId.get(2)?.error || !byId.get(2)?.result) throw new Error("Base RPC market read failed");
      const [supplyAssets, supplyShares, borrowAssets, borrowShares, lastUpdate, fee] = decodeFunctionResult({
        abi: MARKET_ABI,
        functionName: "market",
        data: byId.get(2).result,
      });
      const oraclePrice = byId.get(3)?.result
        ? decodeFunctionResult({ abi: ORACLE_ABI, functionName: "price", data: byId.get(3).result })
        : null;
      const checks = {
        supplyShares: supplyShares.toString() === String(restState.total_supply_shares),
        borrowShares: borrowShares.toString() === String(restState.total_borrow_shares),
        lastUpdate: lastUpdate.toString() === String(restState.last_accrual_timestamp),
        fee: fee.toString() === String(restState.fee_wad),
      };
      return {
        available: true,
        rpcUrl,
        blockNumber: Number(BigInt(byId.get(1)?.result || 0)),
        verdict: Object.values(checks).every(Boolean) ? "stored_state_exact_match" : "stored_state_mismatch_or_index_lag",
        checks,
        storedMarket: {
          supplyAssetsRaw: supplyAssets.toString(),
          supplySharesRaw: supplyShares.toString(),
          borrowAssetsRaw: borrowAssets.toString(),
          borrowSharesRaw: borrowShares.toString(),
          lastUpdate: lastUpdate.toString(),
          feeRaw: fee.toString(),
        },
        oraclePriceRaw: oraclePrice?.toString() || null,
        note: "Stored asset totals can differ from indexed accrued totals without a state-integrity failure; shares, lastUpdate, and fee are the exact storage checks.",
      };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    available: false,
    rpcUrl: null,
    blockNumber: null,
    verdict: "unavailable",
    checks: {},
    error: String(lastError?.message || lastError || "RPC unavailable"),
  };
}

function summarizeBorrowers(positionPage, totalBorrowUsd) {
  const items = positionPage.items.map((item) => ({
    address: String(item.user?.address || "").toLowerCase(),
    healthFactor: finiteNumber(item.healthFactor),
    borrowAssetsRaw: String(item.state?.borrowAssets || "0"),
    borrowAssetsUsd: finiteNumber(item.state?.borrowAssetsUsd),
    collateralAssetsRaw: String(item.state?.collateral || "0"),
    collateralAssetsUsd: finiteNumber(item.state?.collateralUsd),
    indexedAt: isoFromUnix(item.state?.timestamp),
  }));
  const concentration = {};
  for (const count of [1, 5, 10]) {
    concentration[`top${count}BorrowPct`] = percentOf(
      sumNumbers(items.slice(0, count).map((item) => item.borrowAssetsUsd)),
      totalBorrowUsd,
    );
  }
  const healthFactors = items.map((item) => item.healthFactor).filter((value) => value !== null);
  return {
    totalCount: Number(positionPage.pageInfo?.countTotal || items.length),
    observedCount: items.length,
    truncated: Number(positionPage.pageInfo?.countTotal || 0) > items.length,
    concentration,
    healthBands: {
      liquidatableBelow1: healthFactors.filter((value) => value < 1).length,
      below1_05: healthFactors.filter((value) => value < 1.05).length,
      below1_10: healthFactors.filter((value) => value < 1.10).length,
      below1_25: healthFactors.filter((value) => value < 1.25).length,
      missingHealthFactor: items.length - healthFactors.length,
    },
    largest: items.slice(0, 10),
  };
}

function summarizeSeries(points, field, decimals) {
  const values = points
    .map((point) => ({ timestamp: Number(point.timestamp), raw: toBig(point[field], field) }))
    .filter((point) => point.timestamp > 0);
  if (!values.length) return null;
  const nonZero = values.filter((point) => point.raw > 0n);
  const start = nonZero[0] || values[0];
  const end = values.at(-1);
  const minimum = values.reduce((best, point) => point.raw < best ? point.raw : best, values[0].raw);
  const maximum = values.reduce((best, point) => point.raw > best ? point.raw : best, values[0].raw);
  const changePct = start.raw === 0n
    ? null
    : ratioNumber((end.raw - start.raw) * 100n, start.raw);
  return {
    start: { at: isoFromUnix(start.timestamp), raw: start.raw.toString(), amount: formatUnits(start.raw, decimals) },
    end: { at: isoFromUnix(end.timestamp), raw: end.raw.toString(), amount: formatUnits(end.raw, decimals) },
    minimum: { raw: minimum.toString(), amount: formatUnits(minimum, decimals) },
    maximum: { raw: maximum.toString(), amount: formatUnits(maximum, decimals) },
    changePct,
  };
}

function check(id, status, evidence, implication) {
  return { id, status, evidence, implication };
}

function buildDecisionChecks({ market, borrowers, verification, preLiquidationCount, nowMs }) {
  const state = market.state;
  const utilization = finiteNumber(state.utilization);
  const liquidityUsd = finiteNumber(state.liquidityAssetsUsd);
  const badDebtUsd = finiteNumber(market.badDebt?.usd) || 0;
  const realizedBadDebtUsd = finiteNumber(market.realizedBadDebt?.usd) || 0;
  const top1 = borrowers.concentration.top1BorrowPct;
  const top5 = borrowers.concentration.top5BorrowPct;
  const priceTimestamps = [market.loanAsset?.price?.timestamp, market.collateralAsset?.price?.timestamp]
    .map(finiteNumber)
    .filter((value) => value !== null);
  const oldestPriceAgeSeconds = priceTimestamps.length
    ? Math.max(...priceTimestamps.map((value) => Math.max(0, Math.floor(nowMs / 1000) - value)))
    : null;
  return [
    check(
      "market_params_integrity",
      verification.marketParamsHashMatches && verification.restMatchesGraphql ? "pass" : "fail",
      { marketParamsHashMatches: verification.marketParamsHashMatches, restMatchesGraphql: verification.restMatchesGraphql },
      "A fail means the requested ID is not bound to one consistent set of Morpho parameters.",
    ),
    check(
      "direct_chain_state",
      verification.directRpc.verdict === "stored_state_exact_match" ? "pass" : verification.directRpc.available ? "watch" : "unknown",
      { verdict: verification.directRpc.verdict, blockNumber: verification.directRpc.blockNumber, checks: verification.directRpc.checks },
      "Use direct-chain state immediately before capital allocation or execution.",
    ),
    check(
      "market_listing",
      market.listed ? "pass" : "watch",
      { listed: market.listed, loanAssetListed: market.loanAsset?.isListed, collateralAssetListed: market.collateralAsset?.isListed },
      "Unlisted does not prove unsafe, but it raises discovery, curation, and diligence requirements.",
    ),
    check(
      "available_liquidity",
      liquidityUsd === null ? "unknown" : liquidityUsd <= 0 ? "fail" : liquidityUsd < 25_000 ? "watch" : "pass",
      { liquidityUsd, utilizationPct: utilization === null ? null : utilization * 100 },
      "Thin liquidity can prevent exits or make a new borrow impossible even when headline APY looks attractive.",
    ),
    check(
      "utilization",
      utilization === null ? "unknown" : utilization >= 0.95 ? "fail" : utilization >= 0.85 ? "watch" : "pass",
      { utilizationPct: utilization === null ? null : utilization * 100 },
      "High utilization reduces withdrawal and borrowing headroom and can steepen rates.",
    ),
    check(
      "borrower_concentration",
      top1 === null ? "unknown" : top1 >= 40 || (top5 !== null && top5 >= 80) ? "fail" : top1 >= 25 || (top5 !== null && top5 >= 60) ? "watch" : "pass",
      { top1BorrowPct: top1, top5BorrowPct: top5, observedBorrowers: borrowers.observedCount, totalBorrowers: borrowers.totalCount },
      "Concentration makes liquidity and bad-debt outcomes depend on a small number of borrowers.",
    ),
    check(
      "borrower_health",
      borrowers.healthBands.liquidatableBelow1 > 0 ? "fail" : borrowers.healthBands.below1_05 > 0 ? "watch" : "pass",
      borrowers.healthBands,
      "Near-liquidation positions can create liquidation flow, bad-debt exposure, and rapid utilization changes.",
    ),
    check(
      "bad_debt",
      badDebtUsd > 0 || realizedBadDebtUsd > 0 ? "fail" : "pass",
      { currentBadDebtUsd: badDebtUsd, realizedBadDebtUsd },
      "Observed bad debt is direct evidence that collateral and liquidation mechanics have already failed to cover debt.",
    ),
    check(
      "price_freshness",
      oldestPriceAgeSeconds === null ? "unknown" : oldestPriceAgeSeconds > 3_600 ? "fail" : oldestPriceAgeSeconds > 900 ? "watch" : "pass",
      { oldestAssetUsdPriceAgeSeconds: oldestPriceAgeSeconds, oracleAddress: market.oracle?.address, oracleType: market.oracle?.type },
      "Stale asset metadata weakens USD comparisons; execution must use a fresh protocol-oracle read.",
    ),
    check(
      "pre_liquidation_supply",
      preLiquidationCount > 0 ? "pass" : "not_available",
      { configuredContracts: preLiquidationCount },
      "A configured PreLiquidation contract can create an earlier protection and liquidation path, subject to borrower authorization and contract parameters.",
    ),
  ];
}

export async function morphoMarketUnderwrite(rawMarketId, {
  chainId = BASE_CHAIN_ID,
  endpoint = MORPHO_GRAPHQL,
  restBase = MORPHO_REST,
  fetchImpl = fetch,
  timeoutMs = 8_000,
  rpcCheck = true,
  rpcUrls = BASE_RPCS,
  now = () => Date.now(),
} = {}) {
  const marketId = String(rawMarketId || "").trim().toLowerCase();
  if (!isMarketId(marketId)) throw new Error("invalid marketId: expected a 0x-prefixed 32-byte hex value");
  if (Number(chainId) !== BASE_CHAIN_ID) throw new Error("this product supports Base mainnet only (chainId 8453)");

  const [{ market, positions }, rest] = await Promise.all([
    fetchGraphql({ endpoint, fetchImpl, marketId, timeoutMs }),
    fetchRest({ restBase, fetchImpl, marketId, timeoutMs }),
  ]);
  const paramsVerification = verifyParams(rest.config, marketId);
  const graphqlParams = {
    loanToken: market.loanAsset?.address,
    collateralToken: market.collateralAsset?.address,
    oracle: market.oracle?.address,
    irm: market.irmAddress,
    lltv: String(market.lltv),
  };
  const restMatchesGraphql = [
    [rest.config.loan_token, graphqlParams.loanToken],
    [rest.config.collateral_token, graphqlParams.collateralToken],
    [rest.config.oracle_address, graphqlParams.oracle],
    [rest.config.irm_address, graphqlParams.irm],
  ].every(([left, right]) => String(left).toLowerCase() === String(right).toLowerCase())
    && String(rest.config.lltv_wad) === graphqlParams.lltv;

  const directRpc = rpcCheck
    ? await directRpcCrossCheck({
      marketId,
      oracle: rest.config.oracle_address,
      restState: rest.state,
      fetchImpl,
      timeoutMs,
      rpcUrls,
    })
    : { available: false, verdict: "disabled", blockNumber: null, checks: {} };

  const borrowers = summarizeBorrowers(positions, market.state?.borrowAssetsUsd);
  const historyPoints = Array.isArray(rest.history) ? rest.history : [];
  const loanDecimals = Number(market.loanAsset?.decimals || 0);
  const preLiquidations = market.preLiquidations?.items || [];
  const verification = {
    marketParamsHashMatches: paramsVerification.matches,
    derivedMarketId: paramsVerification.derivedMarketId,
    restMatchesGraphql,
    directRpc,
    indexedStateBlocks: {
      graphql: Number(market.state?.blockNumber || 0) || null,
      rest: Number(rest.state.last_indexed_block || 0) || null,
      history: Number(rest.indexedBlocks.history || 0) || null,
    },
  };
  const fetchedAtMs = now();
  const decisionChecks = buildDecisionChecks({
    market,
    borrowers,
    verification,
    preLiquidationCount: preLiquidations.length,
    nowMs: fetchedAtMs,
  });

  return {
    ok: true,
    product: "morpho-market-underwrite",
    version: "1.0.0",
    marketId,
    chain: { id: BASE_CHAIN_ID, name: "Base mainnet" },
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    market: {
      listed: Boolean(market.listed),
      createdAt: isoFromUnix(market.creationTimestamp),
      creationBlockNumber: Number(market.creationBlockNumber),
      params: {
        loanToken: rest.config.loan_token,
        collateralToken: rest.config.collateral_token,
        oracle: rest.config.oracle_address,
        oracleType: market.oracle?.type || null,
        irm: rest.config.irm_address,
        lltvRaw: String(rest.config.lltv_wad),
        lltvPct: ratioNumber(toBig(rest.config.lltv_wad, "LLTV") * 100n, WAD),
      },
      assets: {
        loan: market.loanAsset,
        collateral: market.collateralAsset,
      },
      state: {
        indexedAt: isoFromUnix(market.state?.timestamp),
        indexedBlock: Number(market.state?.blockNumber),
        supplyAssetsRaw: String(market.state?.supplyAssets),
        supplyAssets: formatUnits(toBig(market.state?.supplyAssets, "supply assets"), loanDecimals),
        supplyAssetsUsd: finiteNumber(market.state?.supplyAssetsUsd),
        borrowAssetsRaw: String(market.state?.borrowAssets),
        borrowAssets: formatUnits(toBig(market.state?.borrowAssets, "borrow assets"), loanDecimals),
        borrowAssetsUsd: finiteNumber(market.state?.borrowAssetsUsd),
        collateralAssetsRaw: String(market.state?.collateralAssets || 0),
        collateralAssetsUsd: finiteNumber(market.state?.collateralAssetsUsd),
        liquidityAssetsRaw: String(market.state?.liquidityAssets),
        liquidityAssets: formatUnits(toBig(market.state?.liquidityAssets, "liquidity assets"), loanDecimals),
        liquidityAssetsUsd: finiteNumber(market.state?.liquidityAssetsUsd),
        liquidityToSupplyPct: percentOf(market.state?.liquidityAssetsUsd, market.state?.supplyAssetsUsd),
        utilizationPct: finiteNumber(market.state?.utilization) === null ? null : Number(market.state.utilization) * 100,
        supplyApyPct: finiteNumber(market.state?.supplyApy) === null ? null : Number(market.state.supplyApy) * 100,
        borrowApyPct: finiteNumber(market.state?.borrowApy) === null ? null : Number(market.state.borrowApy) * 100,
        feePct: finiteNumber(market.state?.fee) === null ? null : Number(market.state.fee) * 100,
        badDebt: market.badDebt,
        realizedBadDebt: market.realizedBadDebt,
      },
    },
    trailingApy: {
      supply: rest.apy.supply_apy_averages || {},
      borrow: rest.apy.borrow_apy_averages || {},
      units: "decimal; multiply by 100 for percent",
    },
    history: {
      lookback: "thirty_days",
      observedPoints: historyPoints.length,
      supply: summarizeSeries(historyPoints, "total_supply_assets", loanDecimals),
      borrow: summarizeSeries(historyPoints, "total_borrow_assets", loanDecimals),
      boundary: "REST history is sampled indexed protocol state. A zero initial sample is skipped for percentage-change baselines when later non-zero observations exist.",
    },
    borrowers,
    preLiquidation: {
      configuredCount: preLiquidations.length,
      totalCount: Number(market.preLiquidations?.pageInfo?.countTotal || preLiquidations.length),
      configurations: preLiquidations.map((item) => ({
        address: item.address,
        oracle: item.preLiquidationOracle,
        preLltvRaw: String(item.preLltv),
        preLltvPct: ratioNumber(toBig(item.preLltv, "preLLTV") * 100n, WAD),
        closeFactorStartRaw: String(item.preLCF1),
        closeFactorEndRaw: String(item.preLCF2),
        incentiveStartRaw: String(item.preLIF1),
        incentiveEndRaw: String(item.preLIF2),
      })),
      boundary: "A deployed configuration is supply, not proof of borrower authorization, use, profitability, or independent demand.",
    },
    verification,
    decisionChecks,
    source: {
      graphql: { endpoint, authority: "indexed metadata, USD values, and borrower observations" },
      rest: { endpoint: `${restBase}/${BASE_CHAIN_ID}:${marketId}`, authority: "indexed canonical market configuration, state, APY averages, and history" },
      rpc: { authority: "fresh direct Base read of Morpho stored market state and oracle" },
    },
    boundary: "Deterministic read-only evidence for machine underwriting. No opaque aggregate score, wallet access, signing, broadcast, custody, capital allocation, or financial advice. Re-read direct chain state, simulate any action, and apply caller policy before moving value.",
  };
}

export const MORPHO_MARKET_UNDERWRITE_CONSTANTS = {
  BASE_CHAIN_ID,
  MORPHO_BLUE,
  MORPHO_GRAPHQL,
  MORPHO_REST,
  WAD: WAD.toString(),
};
