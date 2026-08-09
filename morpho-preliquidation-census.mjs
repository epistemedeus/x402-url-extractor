import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  stringToHex,
} from "viem";

const GRAPHQL_URL = "https://api.morpho.org/graphql";
const BLOCKSCOUT_URL = "https://base.blockscout.com/api/v2";
const BASE_RPCS = (process.env.MORPHO_BASE_RPC_URLS || "https://mainnet.base.org,https://base.drpc.org,https://base-rpc.publicnode.com")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const BASE_CHAIN_ID = 8453;
const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const PRE_LIQUIDATE_TOPIC = keccak256(stringToHex("PreLiquidate(bytes32,address,address,uint256,uint256,uint256)"));

const MARKETS_QUERY = `
  query SameDayDeskPreLiquidationMarkets($skip: Int!) {
    markets(
      first: 100
      skip: $skip
      orderBy: UniqueKey
      orderDirection: Asc
      where: { chainId_in: [8453] }
    ) {
      items {
        marketId listed creationBlockNumber creationTimestamp lltv
        loanAsset { address symbol decimals price { usd timestamp } }
        collateralAsset { address symbol decimals price { usd timestamp } }
        state { timestamp borrowAssetsUsd supplyAssetsUsd liquidityAssetsUsd utilization }
        preLiquidations {
          items { address preLltv preLCF1 preLCF2 preLIF1 preLIF2 preLiquidationOracle }
          pageInfo { count countTotal limit skip }
        }
      }
      pageInfo { count countTotal limit skip }
    }
  }
`;

const POSITIONS_QUERY = `
  query SameDayDeskPreLiquidationPositions($marketId: String!) {
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

const AUTH_ABI = [{
  type: "function",
  name: "isAuthorized",
  stateMutability: "view",
  inputs: [{ name: "authorizer", type: "address" }, { name: "authorized", type: "address" }],
  outputs: [{ name: "", type: "bool" }],
}];
const ID_ABI = [{ type: "function", name: "ID", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bytes32" }] }];
const MORPHO_ABI = [{ type: "function", name: "MORPHO", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] }];
const MULTICALL3_ABI = [{
  type: "function",
  name: "aggregate3",
  stateMutability: "payable",
  inputs: [{
    name: "calls",
    type: "tuple[]",
    components: [
      { name: "target", type: "address" },
      { name: "allowFailure", type: "bool" },
      { name: "callData", type: "bytes" },
    ],
  }],
  outputs: [{
    name: "returnData",
    type: "tuple[]",
    components: [
      { name: "success", type: "bool" },
      { name: "returnData", type: "bytes" },
    ],
  }],
}];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url, init = {}, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "user-agent": "SameDayDesk-PreLiquidation-Census/1.0 (contact@samedaydesk.com)",
          ...(init.headers || {}),
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
      if (!payload) throw new Error(`Invalid JSON from ${url}`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await wait(250 * (attempt + 1));
    }
  }
  throw lastError;
}

async function graphql(query, variables) {
  const payload = await fetchJson(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (payload.errors?.length) throw new Error(`Morpho GraphQL: ${payload.errors[0]?.message || "unknown error"}`);
  return payload.data;
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

async function enumerateMarkets() {
  const markets = [];
  let skip = 0;
  let total = Infinity;
  while (skip < total) {
    const data = await graphql(MARKETS_QUERY, { skip });
    const page = data?.markets;
    if (!page || !Array.isArray(page.items)) throw new Error("Morpho markets page was missing");
    total = Number(page.pageInfo?.countTotal || page.items.length);
    markets.push(...page.items);
    if (!page.items.length) break;
    skip += page.items.length;
  }
  return { markets, total };
}

async function positionsForMarket(marketId) {
  const data = await graphql(POSITIONS_QUERY, { marketId });
  const page = data?.marketPositions;
  if (!page || !Array.isArray(page.items)) throw new Error(`Morpho positions missing for ${marketId}`);
  return page;
}

function nextBlockscoutUrl(address, nextPageParams) {
  const url = new URL(`${BLOCKSCOUT_URL}/addresses/${address}/logs`);
  for (const [key, value] of Object.entries(nextPageParams || {})) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function eventsForContract(address) {
  const events = [];
  let nextPageParams = null;
  do {
    const payload = await fetchJson(nextBlockscoutUrl(address, nextPageParams));
    for (const item of payload.items || []) {
      if (String(item.topics?.[0] || "").toLowerCase() !== PRE_LIQUIDATE_TOPIC.toLowerCase()) continue;
      const decoded = Object.fromEntries((item.decoded?.parameters || []).map((parameter) => [parameter.name, parameter.value]));
      events.push({
        transactionHash: item.transaction_hash,
        blockNumber: Number(item.block_number),
        blockTimestamp: item.block_timestamp,
        marketId: decoded.id || item.topics?.[1] || null,
        liquidator: decoded.liquidator || `0x${String(item.topics?.[2] || "").slice(-40)}`,
        borrower: decoded.borrower || `0x${String(item.topics?.[3] || "").slice(-40)}`,
        repaidAssetsRaw: decoded.repaidAssets || null,
        repaidSharesRaw: decoded.repaidShares || null,
        seizedAssetsRaw: decoded.seizedAssets || null,
      });
    }
    nextPageParams = payload.next_page_params || null;
  } while (nextPageParams);
  return events;
}

async function rpcBatch(calls, rpcUrls = BASE_RPCS) {
  const replies = [];
  let lastError;
  for (let offset = 0; offset < calls.length; offset += 10) {
    const chunk = calls.slice(offset, offset + 10).map((call, index) => ({
          jsonrpc: "2.0",
          id: offset + index + 1,
          ...call,
    }));
    let chunkPayload = null;
    let selectedRpc = null;
    for (let round = 0; round < 6 && !chunkPayload; round += 1) {
      for (const rpcUrl of rpcUrls) {
        try {
        const payload = await fetchJson(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(chunk),
        }, 1);
        if (!Array.isArray(payload)) throw new Error(`RPC ${rpcUrl} rejected batch`);
          if (payload.length !== chunk.length) throw new Error(`RPC ${rpcUrl} returned an incomplete batch`);
          chunkPayload = payload.sort((a, b) => a.id - b.id);
          selectedRpc = rpcUrl;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!chunkPayload) await wait(1_000 * (round + 1));
    }
    if (!chunkPayload) throw lastError || new Error("No Base RPC available for a verification batch");
    replies.push(...chunkPayload);
    if (offset + 10 < calls.length) await wait(250);
    lastError = null;
  }
  return { rpcUrl: "paced per-chunk failover across configured Base RPCs", replies };
}

async function rpcSingle(call, rpcUrls = BASE_RPCS) {
  let lastError;
  for (let round = 0; round < 6; round += 1) {
    for (const rpcUrl of rpcUrls) {
      try {
        const payload = await fetchJson(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...call }),
        }, 1);
        if (payload.error || !payload.result) throw new Error(payload.error?.message || `RPC ${rpcUrl} returned no result`);
        return { rpcUrl, result: payload.result };
      } catch (error) {
        lastError = error;
      }
    }
    await wait(1_000 * (round + 1));
  }
  throw lastError || new Error("No Base RPC available");
}

async function multicallRead(calls, rpcUrls = BASE_RPCS) {
  const results = [];
  const rpcSources = new Set();
  for (let offset = 0; offset < calls.length; offset += 100) {
    const chunk = calls.slice(offset, offset + 100);
    const data = encodeFunctionData({
      abi: MULTICALL3_ABI,
      functionName: "aggregate3",
      args: [chunk.map((call) => ({ target: call.target, allowFailure: true, callData: call.data }))],
    });
    const response = await rpcSingle({ method: "eth_call", params: [{ to: MULTICALL3, data }, "latest"] }, rpcUrls);
    rpcSources.add(response.rpcUrl);
    const decoded = decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: response.result });
    decoded.forEach((result, index) => results.push({
      ...chunk[index],
      success: result.success,
      returnData: result.returnData,
    }));
    if (offset + 100 < calls.length) await wait(250);
  }
  return { rpcUrls: [...rpcSources], results };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).toLowerCase()))];
}

function decodeBool(data) {
  return Boolean(decodeFunctionResult({ abi: AUTH_ABI, functionName: "isAuthorized", data }));
}

async function directVerify(configurations, authorizationPairs, events, rpcUrls) {
  const calls = [];
  for (const config of configurations) {
    calls.push({ target: config.address, data: encodeFunctionData({ abi: ID_ABI, functionName: "ID" }), kind: "id", config });
    calls.push({ target: config.address, data: encodeFunctionData({ abi: MORPHO_ABI, functionName: "MORPHO" }), kind: "morpho", config });
  }
  for (const pair of authorizationPairs) {
    calls.push({
      target: MORPHO_BLUE,
      data: encodeFunctionData({ abi: AUTH_ABI, functionName: "isAuthorized", args: [pair.borrower, pair.preLiquidation] }),
      kind: "authorization",
      pair,
    });
  }
  const multicall = await multicallRead(calls, rpcUrls);
  const configChecks = new Map(configurations.map((config) => [config.address.toLowerCase(), {
    address: config.address,
    callableContract: false,
    idMatchesMarket: false,
    morphoMatches: false,
  }]));
  const authorizations = [];
  multicall.results.forEach((result) => {
    if (!result.success || !result.returnData || result.returnData === "0x") return;
    if (result.kind === "id") {
      const observed = decodeFunctionResult({ abi: ID_ABI, functionName: "ID", data: result.returnData });
      configChecks.get(result.config.address.toLowerCase()).callableContract = true;
      configChecks.get(result.config.address.toLowerCase()).idMatchesMarket = observed.toLowerCase() === result.config.marketId.toLowerCase();
    } else if (result.kind === "morpho") {
      const observed = decodeFunctionResult({ abi: MORPHO_ABI, functionName: "MORPHO", data: result.returnData });
      configChecks.get(result.config.address.toLowerCase()).callableContract = true;
      configChecks.get(result.config.address.toLowerCase()).morphoMatches = observed.toLowerCase() === MORPHO_BLUE.toLowerCase();
    } else if (result.kind === "authorization") {
      authorizations.push({ ...result.pair, authorized: decodeBool(result.returnData) });
    }
  });

  const sampleTransactions = unique(configurations.flatMap((config) => {
    const transactions = unique(events
      .filter((event) => event.contract.toLowerCase() === config.address.toLowerCase())
      .sort((a, b) => a.blockNumber - b.blockNumber)
      .map((event) => event.transactionHash));
    if (transactions.length <= 3) return transactions;
    return [transactions[0], transactions[Math.floor(transactions.length / 2)], transactions.at(-1)];
  }));
  const receiptCalls = sampleTransactions.map((transactionHash) => ({ method: "eth_getTransactionReceipt", params: [transactionHash] }));
  const receiptBatch = receiptCalls.length ? await rpcBatch(receiptCalls, rpcUrls) : { rpcUrl: null, replies: [] };
  const receipts = [];
  receiptBatch.replies.forEach((reply, index) => {
    const transactionHash = sampleTransactions[index];
    if (reply.error || !reply.result) return;
    const matchingLogs = (reply.result.logs || []).filter((log) =>
      configurations.some((config) => config.address.toLowerCase() === String(log.address).toLowerCase())
        && String(log.topics?.[0] || "").toLowerCase() === PRE_LIQUIDATE_TOPIC.toLowerCase());
    receipts.push({
      transactionHash,
      status: Number(BigInt(reply.result.status || "0x0")),
      blockNumber: Number(BigInt(reply.result.blockNumber || "0x0")),
      matchingPreLiquidateLogs: matchingLogs.length,
      verified: Number(BigInt(reply.result.status || "0x0")) === 1 && matchingLogs.length > 0,
    });
  });
  return {
    rpcUrl: [...multicall.rpcUrls, receiptBatch.rpcUrl].filter(Boolean).join(", "),
    configChecks: [...configChecks.values()],
    authorizations,
    receipts,
    receiptSample: { selectedTransactions: sampleTransactions.length, totalCandidateTransactions: unique(events.map((event) => event.transactionHash)).length },
  };
}

function summarizeConfiguration(config, market, positionPage, events, direct) {
  const positions = positionPage.items || [];
  const auth = direct.authorizations.filter((item) => item.preLiquidation.toLowerCase() === config.address.toLowerCase());
  const configEvents = events.filter((event) => event.contract.toLowerCase() === config.address.toLowerCase());
  const check = direct.configChecks.find((item) => item.address.toLowerCase() === config.address.toLowerCase());
  const eventBorrowers = unique(configEvents.map((event) => event.borrower));
  const currentBorrowers = unique(positions.map((position) => position.user?.address));
  return {
    address: config.address,
    marketId: market.marketId,
    marketListed: Boolean(market.listed),
    pair: `${market.collateralAsset?.symbol || "?"}/${market.loanAsset?.symbol || "?"}`,
    marketState: {
      borrowAssetsUsd: finiteNumber(market.state?.borrowAssetsUsd),
      supplyAssetsUsd: finiteNumber(market.state?.supplyAssetsUsd),
      liquidityAssetsUsd: finiteNumber(market.state?.liquidityAssetsUsd),
      utilizationPct: finiteNumber(market.state?.utilization) === null ? null : Number(market.state.utilization) * 100,
    },
    parameters: {
      marketLltvRaw: String(market.lltv),
      preLltvRaw: String(config.preLltv),
      closeFactorStartRaw: String(config.preLCF1),
      closeFactorEndRaw: String(config.preLCF2),
      incentiveStartRaw: String(config.preLIF1),
      incentiveEndRaw: String(config.preLIF2),
      oracle: config.preLiquidationOracle,
    },
    deploymentVerification: check,
    currentPositions: {
      total: Number(positionPage.pageInfo?.countTotal || currentBorrowers.length),
      observed: currentBorrowers.length,
      truncated: Number(positionPage.pageInfo?.countTotal || 0) > currentBorrowers.length,
      authorizedObserved: auth.filter((item) => item.authorized).length,
      authorizedBorrowers: auth.filter((item) => item.authorized).map((item) => item.borrower),
      nearPreLiquidation: positions.filter((position) => {
        const hf = finiteNumber(position.healthFactor);
        return hf !== null && hf < 1.10;
      }).length,
    },
    executionHistory: {
      eventCount: configEvents.length,
      sampledVerifiedReceiptCount: unique(configEvents.map((event) => event.transactionHash))
        .filter((hash) => direct.receipts.some((receipt) => receipt.transactionHash.toLowerCase() === hash && receipt.verified)).length,
      uniqueBorrowers: eventBorrowers.length,
      uniqueLiquidators: unique(configEvents.map((event) => event.liquidator)).length,
      firstAt: configEvents.map((event) => event.blockTimestamp).sort()[0] || null,
      lastAt: configEvents.map((event) => event.blockTimestamp).sort().at(-1) || null,
      recentTransactions: unique(configEvents
        .sort((a, b) => b.blockNumber - a.blockNumber)
        .map((event) => event.transactionHash)).slice(0, 5),
    },
  };
}

export async function runPreLiquidationCensus({ rpcUrls = BASE_RPCS, progress = () => {} } = {}) {
  const startedAt = new Date().toISOString();
  const { markets, total } = await enumerateMarkets();
  const relevantMarkets = markets.filter((market) => Number(market.preLiquidations?.pageInfo?.countTotal || 0) > 0);
  progress({ stage: "markets", total, relevantMarkets: relevantMarkets.length });
  const marketPositions = await mapLimit(relevantMarkets, 6, async (market) => ({
    marketId: market.marketId,
    page: await positionsForMarket(market.marketId),
  }));
  const positionByMarket = new Map(marketPositions.map((item) => [item.marketId.toLowerCase(), item.page]));
  const configurations = relevantMarkets.flatMap((market) => (market.preLiquidations?.items || []).map((config) => ({
    ...config,
    marketId: market.marketId,
  })));
  progress({ stage: "positions", configurations: configurations.length, activeBorrowerMarkets: marketPositions.length });
  const eventsByConfig = await mapLimit(configurations, 4, async (config) => ({
    address: config.address,
    events: (await eventsForContract(config.address)).map((event) => ({ ...event, contract: config.address })),
  }));
  const events = eventsByConfig.flatMap((item) => item.events);
  progress({ stage: "events", events: events.length, uniqueTransactions: unique(events.map((event) => event.transactionHash)).length });
  const authorizationPairs = relevantMarkets.flatMap((market) => {
    const borrowers = unique((positionByMarket.get(market.marketId.toLowerCase())?.items || []).map((position) => position.user?.address));
    return (market.preLiquidations?.items || []).flatMap((config) => borrowers.map((borrower) => ({
      marketId: market.marketId,
      borrower,
      preLiquidation: config.address,
    })));
  });
  progress({ stage: "direct_verification", authorizationPairs: authorizationPairs.length, receipts: unique(events.map((event) => event.transactionHash)).length });
  const direct = await directVerify(configurations, authorizationPairs, events, rpcUrls);
  const configurationSummaries = configurations.map((config) => {
    const market = relevantMarkets.find((item) => item.marketId.toLowerCase() === config.marketId.toLowerCase());
    return summarizeConfiguration(config, market, positionByMarket.get(config.marketId.toLowerCase()), events, direct);
  });
  const authorizedBorrowers = unique(direct.authorizations.filter((item) => item.authorized).map((item) => item.borrower));
  const verifiedReceipts = direct.receipts.filter((receipt) => receipt.verified);

  return {
    ok: true,
    product: "morpho-preliquidation-census",
    version: "1.0.0",
    chain: { id: BASE_CHAIN_ID, name: "Base mainnet" },
    startedAt,
    completedAt: new Date().toISOString(),
    summary: {
      baseMarketsEnumerated: total,
      marketsWithPreLiquidation: relevantMarkets.length,
      configurationsObserved: configurations.length,
      configurationsFullyVerifiedOnchain: direct.configChecks.filter((item) => item.callableContract && item.idMatchesMarket && item.morphoMatches).length,
      currentBorrowerAuthorizationPairsChecked: direct.authorizations.length,
      currentAuthorizedPairs: direct.authorizations.filter((item) => item.authorized).length,
      currentAuthorizedBorrowers: authorizedBorrowers.length,
      preLiquidateEventsObserved: events.length,
      uniqueExecutionTransactions: unique(events.map((event) => event.transactionHash)).length,
      executionTransactionsSelectedForDirectReceiptSample: direct.receiptSample.selectedTransactions,
      executionTransactionsVerifiedByDirectReceiptSample: verifiedReceipts.length,
      uniqueHistoricalBorrowers: unique(events.map((event) => event.borrower)).length,
      uniqueHistoricalLiquidators: unique(events.map((event) => event.liquidator)).length,
    },
    configurations: configurationSummaries.sort((a, b) => b.executionHistory.eventCount - a.executionHistory.eventCount),
    evidence: {
      supply: "Morpho GraphQL Base-market enumeration and nested PreLiquidation configurations.",
      authorization: `Fresh direct ${MORPHO_BLUE} isAuthorized(borrower, preLiquidation) reads for the first 100 active borrowers per market.`,
      executionDiscovery: "Base Blockscout address-log index used to locate candidate events.",
      executionVerification: "A deterministic first, midpoint, and last transaction sample per active contract is checked by direct Base RPC receipt for successful status and the exact PreLiquidate topic from the reported contract.",
      rpcUrl: direct.rpcUrl,
      eventTopic: PRE_LIQUIDATE_TOPIC,
      officialImplementation: "https://github.com/morpho-org/pre-liquidation",
    },
    boundaries: [
      "The Morpho market list and position list are indexed observations; current authorization and receipt checks are direct-chain reads.",
      "Borrower observation is capped at the first 100 active borrowers per market and is explicitly marked when truncated.",
      "A deployed contract is supply, authorization is adoption, and a verified event is execution. None alone proves current profitability or independent demand for our service.",
      `Execution discovery covers all ${events.length} indexed candidate events; direct receipt verification is a disclosed ${direct.receiptSample.selectedTransactions}-transaction systematic sample across configurations, not all ${direct.receiptSample.totalCandidateTransactions} candidate transactions.`,
      "No transaction was prepared, signed, broadcast, or funded.",
    ],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPreLiquidationCensus({ progress: (status) => process.stderr.write(`[census] ${JSON.stringify(status)}\n`) })
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error)}\n`);
      process.exitCode = 1;
    });
}
