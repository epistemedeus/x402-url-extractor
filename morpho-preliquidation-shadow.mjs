import { createHash } from "node:crypto";
import { mkdir, readFile, rename, chmod, writeFile, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  stringToHex,
} from "viem";
import { morphoPreLiquidationReplay } from "./morpho-preliquidation-replay.mjs";

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
const MIN_OBSERVED_DEBT_USD = 1;

export const SHADOW_MARKETS = [
  {
    pair: "cbBTC/USDC",
    marketId: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836",
    preLiquidation: "0xa7272aFc21f9C321024ED93892a1abfeb621C374",
  },
  {
    pair: "cbETH/USDC",
    marketId: "0x1c21c59df9db44bf6f645d854ee710a8ca17b479451447e9f56758aee10a2fad",
    preLiquidation: "0x9231dB26A7a7A2BC81Abb13331eDaE458b2871B6",
  },
  {
    pair: "WETH/USDC",
    marketId: "0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda",
    preLiquidation: "0x9ca1Dad919221D920B889AAcf3023a5cEa23165f",
  },
  {
    pair: "WETH/EURC",
    marketId: "0xa9b5142fa687a24c275faf731f13b52faa9873252bb4e1cb6077aa1f412edb0b",
    preLiquidation: "0x742d1C11c9cf4c84f1DdA7b5C8AD8FC7bC708493",
  },
  {
    pair: "AERO/USDC",
    marketId: "0xdaa04f6819210b11fe4e3b65300c725c32e55755e3598671559b9ae3bac453d7",
    preLiquidation: "0xa517FE2CF559e1c37D4BB844770B089ab9227Ae7",
  },
];

const MARKET_QUERY = `
  query SameDayDeskShadowMarket($marketId: String!) {
    markets(first: 1, where: { chainId_in: [8453], uniqueKey_in: [$marketId] }) {
      items {
        marketId listed lltv
        state { timestamp borrowAssetsUsd liquidityAssetsUsd utilization }
        preLiquidations {
          items { address preLltv preLIF1 preLIF2 }
        }
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
        state { timestamp borrowAssetsUsd collateralUsd }
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
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function fetchJson(url, init = {}, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "user-agent": "SameDayDesk-PreLiquidation-Shadow/1.0 (contact@samedaydesk.com)",
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

async function rpcRequest(method, params, rpcUrls = BASE_RPCS) {
  let lastError;
  for (let round = 0; round < 4; round += 1) {
    for (const rpcUrl of rpcUrls) {
      try {
        const payload = await fetchJson(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }, 1);
        if (payload.error || payload.result === undefined || payload.result === null) {
          throw new Error(payload.error?.message || `RPC ${rpcUrl} returned no result`);
        }
        return { rpcUrl, result: payload.result };
      } catch (error) {
        lastError = error;
      }
    }
    await wait(500 * (round + 1));
  }
  throw lastError || new Error("No Base RPC available");
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

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ratioNumber(numerator, denominator, scale = 1_000_000n) {
  if (denominator === 0n) return null;
  return Number((numerator * scale) / denominator) / Number(scale);
}

function borrowerFingerprint(address) {
  return createHash("sha256").update(String(address).toLowerCase()).digest("hex").slice(0, 12);
}

export function classifyShadowPosition(healthFactor, preLiquidationHealthThreshold, authorized, borrowAssetsUsd = Number.POSITIVE_INFINITY) {
  const hf = finiteNumber(healthFactor);
  const threshold = finiteNumber(preLiquidationHealthThreshold);
  const debtUsd = finiteNumber(borrowAssetsUsd);
  let status = "unknown";
  if (debtUsd !== null && debtUsd < MIN_OBSERVED_DEBT_USD) {
    status = "dust_or_zero_debt";
  } else if (hf !== null && threshold !== null) {
    if (hf <= 1) status = "liquidation_or_worse";
    else if (hf <= threshold) status = "preliquidation_window";
    else if (hf <= threshold + 0.02) status = "near_preliquidation_window";
    else status = "outside_observed_window";
  }
  return {
    status,
    authorized: Boolean(authorized),
    priorityObservation: Boolean(authorized) && (status === "preliquidation_window" || status === "liquidation_or_worse"),
  };
}

async function readMarket(target) {
  const data = await graphql(MARKET_QUERY, { marketId: target.marketId });
  const market = data?.markets?.items?.[0];
  const positions = data?.marketPositions;
  if (!market || !positions?.items) throw new Error(`Morpho market state missing for ${target.marketId}`);
  const config = (market.preLiquidations?.items || []).find((item) =>
    String(item.address).toLowerCase() === target.preLiquidation.toLowerCase());
  if (!config) throw new Error(`PreLiquidation ${target.preLiquidation} no longer attached to ${target.marketId}`);
  const threshold = ratioNumber(BigInt(market.lltv), BigInt(config.preLltv));
  return { target, market, config, positions, threshold };
}

async function readAuthorizations(markets, blockTag, rpcUrls) {
  const calls = markets.flatMap((item) => item.positions.items.map((position) => ({
    target: MORPHO_BLUE,
    allowFailure: true,
    callData: encodeFunctionData({
      abi: AUTH_ABI,
      functionName: "isAuthorized",
      args: [position.user.address, item.target.preLiquidation],
    }),
    marketId: item.target.marketId,
    borrower: position.user.address,
  })));
  const output = [];
  const sources = new Set();
  for (let offset = 0; offset < calls.length; offset += 100) {
    const chunk = calls.slice(offset, offset + 100);
    const data = encodeFunctionData({
      abi: MULTICALL3_ABI,
      functionName: "aggregate3",
      args: [chunk.map(({ target, allowFailure, callData }) => ({ target, allowFailure, callData }))],
    });
    const response = await rpcRequest("eth_call", [{ to: MULTICALL3, data }, blockTag], rpcUrls);
    sources.add(response.rpcUrl);
    const decoded = decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: response.result });
    decoded.forEach((result, index) => {
      const call = chunk[index];
      let authorized = false;
      if (result.success && result.returnData !== "0x") {
        authorized = Boolean(decodeFunctionResult({ abi: AUTH_ABI, functionName: "isAuthorized", data: result.returnData }));
      }
      output.push({ marketId: call.marketId, borrower: call.borrower, authorized, directReadSucceeded: result.success });
    });
  }
  return { rows: output, rpcUrls: [...sources] };
}

function eventKey(item) {
  return `${String(item.transaction_hash).toLowerCase()}:${item.index ?? item.log_index ?? "?"}`;
}

function isPreLiquidateEvent(item) {
  return String(item.topics?.[0] || "").toLowerCase() === PRE_LIQUIDATE_TOPIC.toLowerCase();
}

async function newEventsForContract(address, previousCursor) {
  const events = [];
  let nextPageParams = null;
  let latestBlock = null;
  const previousBlock = Number(previousCursor?.blockNumber || 0);
  const previousKeys = new Set(previousCursor?.eventKeys || []);
  let complete = false;
  do {
    const url = new URL(`${BLOCKSCOUT_URL}/addresses/${address}/logs`);
    for (const [key, value] of Object.entries(nextPageParams || {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
    const payload = await fetchJson(url.toString());
    for (const item of payload.items || []) {
      if (!isPreLiquidateEvent(item)) continue;
      const blockNumber = Number(item.block_number || 0);
      if (latestBlock === null || blockNumber > latestBlock) latestBlock = blockNumber;
      if (!previousCursor) continue;
      if (blockNumber < previousBlock) {
        complete = true;
        break;
      }
      const key = eventKey(item);
      if (blockNumber > previousBlock || !previousKeys.has(key)) {
        events.push({
          key,
          transactionHash: item.transaction_hash,
          blockNumber,
          blockTimestamp: item.block_timestamp,
        });
      }
    }
    nextPageParams = complete ? null : payload.next_page_params || null;
    if (!previousCursor) nextPageParams = null;
  } while (nextPageParams);

  const firstPage = await fetchJson(`${BLOCKSCOUT_URL}/addresses/${address}/logs`);
  const latestItems = (firstPage.items || []).filter(isPreLiquidateEvent);
  const cursorBlock = latestItems.length ? Math.max(...latestItems.map((item) => Number(item.block_number || 0))) : previousBlock;
  const cursorKeys = latestItems.filter((item) => Number(item.block_number || 0) === cursorBlock).map(eventKey);
  return {
    events: events.filter((event, index, all) => all.findIndex((item) => item.key === event.key) === index),
    cursor: { blockNumber: cursorBlock || latestBlock || previousBlock, eventKeys: cursorKeys },
  };
}

function marketSummary(item, authRows, eventResult) {
  const authByBorrower = new Map(authRows
    .filter((row) => row.marketId.toLowerCase() === item.target.marketId.toLowerCase())
    .map((row) => [row.borrower.toLowerCase(), row]));
  const observedPositions = item.positions.items.map((position) => {
    const auth = authByBorrower.get(position.user.address.toLowerCase());
    const borrowAssetsUsd = finiteNumber(position.state?.borrowAssetsUsd);
    const classification = classifyShadowPosition(position.healthFactor, item.threshold, auth?.authorized, borrowAssetsUsd);
    return {
      borrower: position.user.address,
      borrowerFingerprint: borrowerFingerprint(position.user.address),
      healthFactor: finiteNumber(position.healthFactor),
      borrowAssetsUsd,
      collateralUsd: finiteNumber(position.state?.collateralUsd),
      directAuthorizationReadSucceeded: Boolean(auth?.directReadSucceeded),
      ...classification,
    };
  });
  return {
    pair: item.target.pair,
    marketId: item.target.marketId,
    preLiquidation: item.target.preLiquidation,
    listed: Boolean(item.market.listed),
    indexedAt: item.market.state?.timestamp ? new Date(Number(item.market.state.timestamp) * 1000).toISOString() : null,
    marketState: {
      borrowAssetsUsd: finiteNumber(item.market.state?.borrowAssetsUsd),
      liquidityAssetsUsd: finiteNumber(item.market.state?.liquidityAssetsUsd),
      utilizationPct: finiteNumber(item.market.state?.utilization) === null ? null : Number(item.market.state.utilization) * 100,
    },
    preLiquidationHealthThreshold: item.threshold,
    positions: {
      total: Number(item.positions.pageInfo?.countTotal || observedPositions.length),
      observed: observedPositions.length,
      truncated: Number(item.positions.pageInfo?.countTotal || 0) > observedPositions.length,
      authorizedObserved: observedPositions.filter((position) => position.authorized).length,
      preLiquidationWindowObserved: observedPositions.filter((position) => position.status === "preliquidation_window").length,
      liquidationOrWorseObserved: observedPositions.filter((position) => position.status === "liquidation_or_worse").length,
      priorityObservations: observedPositions.filter((position) => position.priorityObservation).length,
      nearWindowObserved: observedPositions.filter((position) => position.status === "near_preliquidation_window").length,
      dustOrZeroDebtObserved: observedPositions.filter((position) => position.status === "dust_or_zero_debt").length,
      observedPositions,
    },
    eventCursor: eventResult.cursor,
    newEvents: eventResult.events,
  };
}

export function compareShadowSnapshots(previous, current) {
  if (!previous) return [{ type: "baseline_created", severity: "info", markets: current.markets.length }];
  const changes = [];
  for (const market of current.markets) {
    const before = previous.markets.find((item) => item.marketId.toLowerCase() === market.marketId.toLowerCase());
    if (!before) {
      changes.push({ type: "market_added", severity: "info", pair: market.pair });
      continue;
    }
    const previousPositions = new Map(before.positions.observedPositions.map((item) => [item.borrower.toLowerCase(), item]));
    for (const position of market.positions.observedPositions) {
      const prior = previousPositions.get(position.borrower.toLowerCase());
      if (!prior) continue;
      if (prior.authorized !== position.authorized) {
        changes.push({
          type: position.authorized ? "authorization_added" : "authorization_removed",
          severity: position.authorized ? "watch" : "info",
          pair: market.pair,
          borrowerFingerprint: position.borrowerFingerprint,
        });
      }
      if (prior.status !== position.status) {
        changes.push({
          type: "risk_window_changed",
          severity: position.priorityObservation ? "watch" : "info",
          pair: market.pair,
          borrowerFingerprint: position.borrowerFingerprint,
          before: prior.status,
          after: position.status,
        });
      }
    }
    const oldUtilization = finiteNumber(before.marketState?.utilizationPct);
    const newUtilization = finiteNumber(market.marketState?.utilizationPct);
    if (oldUtilization !== null && newUtilization !== null && Math.abs(newUtilization - oldUtilization) >= 2) {
      changes.push({ type: "utilization_moved", severity: "watch", pair: market.pair, beforePct: oldUtilization, afterPct: newUtilization });
    }
    const oldLiquidity = finiteNumber(before.marketState?.liquidityAssetsUsd);
    const newLiquidity = finiteNumber(market.marketState?.liquidityAssetsUsd);
    if (oldLiquidity !== null && oldLiquidity > 0 && newLiquidity !== null && Math.abs(newLiquidity - oldLiquidity) / oldLiquidity >= 0.2) {
      changes.push({ type: "liquidity_moved", severity: "watch", pair: market.pair, beforeUsd: oldLiquidity, afterUsd: newLiquidity });
    }
    for (const event of market.newEvents) {
      changes.push({ type: "new_preliquidation_execution", severity: "material", pair: market.pair, transactionHash: event.transactionHash, blockNumber: event.blockNumber });
    }
  }
  return changes;
}

async function readState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writePrivateJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
  await chmod(filePath, 0o600);
}

async function appendPrivateJsonLine(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

function publicMarketSummary(market) {
  return {
    pair: market.pair,
    marketId: market.marketId,
    preLiquidation: market.preLiquidation,
    indexedAt: market.indexedAt,
    marketState: market.marketState,
    preLiquidationHealthThreshold: market.preLiquidationHealthThreshold,
    positions: {
      total: market.positions.total,
      observed: market.positions.observed,
      truncated: market.positions.truncated,
      authorizedObserved: market.positions.authorizedObserved,
      preLiquidationWindowObserved: market.positions.preLiquidationWindowObserved,
      liquidationOrWorseObserved: market.positions.liquidationOrWorseObserved,
      priorityObservations: market.positions.priorityObservations,
      nearWindowObserved: market.positions.nearWindowObserved,
      dustOrZeroDebtObserved: market.positions.dustOrZeroDebtObserved,
    },
    newEvents: market.newEvents,
  };
}

export async function runPreLiquidationShadow({
  statePath = resolve(tmpdir(), "samedaydesk-morpho-preliquidation-shadow-state.json"),
  historyPath = null,
  rpcUrls = BASE_RPCS,
  resetBaseline = false,
  progress = () => {},
} = {}) {
  const previous = resetBaseline ? null : await readState(statePath);
  const startedAt = new Date().toISOString();
  const block = await rpcRequest("eth_blockNumber", [], rpcUrls);
  const blockNumber = Number(BigInt(block.result));
  const blockTag = `0x${blockNumber.toString(16)}`;
  progress({ stage: "market_state", markets: SHADOW_MARKETS.length, blockNumber });
  const marketReads = await mapLimit(SHADOW_MARKETS, 3, readMarket);
  progress({ stage: "direct_authorization", observedPositions: marketReads.reduce((total, item) => total + item.positions.items.length, 0) });
  const authorizations = await readAuthorizations(marketReads, blockTag, rpcUrls);
  progress({ stage: "execution_delta" });
  const eventResults = await mapLimit(SHADOW_MARKETS, 3, async (target) => {
    const previousMarket = previous?.markets?.find((item) => item.marketId.toLowerCase() === target.marketId.toLowerCase());
    return newEventsForContract(target.preLiquidation, previousMarket?.eventCursor || null);
  });
  const markets = marketReads.map((item, index) => marketSummary(item, authorizations.rows, eventResults[index]));
  const snapshot = {
    version: 1,
    capturedAt: new Date().toISOString(),
    chain: { id: BASE_CHAIN_ID, name: "Base mainnet", blockNumber },
    evidence: {
      marketAndPositionState: "Morpho GraphQL indexed observations",
      authorization: `Direct ${MORPHO_BLUE} isAuthorized reads at explicit block ${blockNumber}`,
      authorizationRpcUrls: authorizations.rpcUrls,
      executionDiscovery: "Base Blockscout logs with a per-contract event cursor",
    },
    markets,
  };
  const changes = compareShadowSnapshots(previous, snapshot);
  const newTransactions = [...new Set(markets.flatMap((market) => market.newEvents.map((event) => event.transactionHash)))];
  const replays = [];
  for (const transactionHash of newTransactions.slice(0, 20)) {
    const discoveredEvent = markets.flatMap((market) => market.newEvents)
      .find((event) => event.transactionHash.toLowerCase() === transactionHash.toLowerCase());
    const detectionLatencySeconds = discoveredEvent?.blockTimestamp
      ? Math.max(0, (Date.parse(snapshot.capturedAt) - Date.parse(discoveredEvent.blockTimestamp)) / 1000)
      : null;
    try {
      const replay = await morphoPreLiquidationReplay(transactionHash, { rpcUrls });
      replays.push({
        transactionHash,
        status: "verified",
        blockNumber: replay.transaction.blockNumber,
        detectionLatencySeconds,
        gasCostEth: replay.transaction.gasCostEth,
        events: replay.events.map((event) => ({
          pair: `${event.assets.seized.symbol || "?"}/${event.assets.repaid.symbol || "?"}`,
          repaidAssets: event.assets.repaid.amount,
          grossIncentiveLoanAsset: event.grossEconomics.incentiveInLoanAmount,
          grossIncentiveSign: event.grossEconomics.incentiveSign,
          grossIncentivePct: event.grossEconomics.incentivePct,
        })),
      });
    } catch (error) {
      replays.push({ transactionHash, status: "verification_failed", detectionLatencySeconds, error: String(error?.message || error) });
    }
  }
  await writePrivateJson(statePath, snapshot);
  const result = {
    ok: true,
    product: "morpho-preliquidation-shadow",
    version: "1.0.0",
    startedAt,
    completedAt: new Date().toISOString(),
    baselineCreated: !previous,
    resetBaseline,
    chain: snapshot.chain,
    summary: {
      markets: markets.length,
      indexedPositionsObserved: markets.reduce((total, market) => total + market.positions.observed, 0),
      directAuthorizationReads: authorizations.rows.length,
      authorizedObserved: markets.reduce((total, market) => total + market.positions.authorizedObserved, 0),
      preLiquidationWindowObserved: markets.reduce((total, market) => total + market.positions.preLiquidationWindowObserved, 0),
      priorityObservations: markets.reduce((total, market) => total + market.positions.priorityObservations, 0),
      newExecutionEvents: markets.reduce((total, market) => total + market.newEvents.length, 0),
      newExecutionTransactions: newTransactions.length,
      directlyReplayedTransactions: replays.filter((item) => item.status === "verified").length,
      replayOverflowTransactions: Math.max(0, newTransactions.length - 20),
    },
    markets: markets.map(publicMarketSummary),
    changes,
    replays,
    statePath,
    boundary: `Read-only shadow evidence. Position health is an indexed observation; authorization is a direct read at the named Base block. Positions below the explicit ${MIN_OBSERVED_DEBT_USD} USD observation floor are classified as dust rather than opportunity. A priority observation is not a profitability claim. No wallet, signer, authorization, custody, lending, borrowing, liquidation, or principal is used.`,
  };
  if (historyPath) await appendPrivateJsonLine(historyPath, result);
  return result;
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--state") output.statePath = resolve(argv[++index]);
    else if (argv[index] === "--history") output.historyPath = resolve(argv[++index]);
    else if (argv[index] === "--reset-baseline") output.resetBaseline = true;
    else if (argv[index] === "--help") output.help = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: node morpho-preliquidation-shadow.mjs [--state FILE] [--history NDJSON] [--reset-baseline]\n");
    } else {
      const result = await runPreLiquidationShadow({
        ...options,
        progress: (status) => process.stderr.write(`[shadow] ${JSON.stringify(status)}\n`),
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    process.exitCode = 1;
  }
}
