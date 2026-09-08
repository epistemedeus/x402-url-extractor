import { createPublicClient, decodeEventLog, getAddress, http, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { eip3009ABI } from "@x402/evm";

import {
  AttemptReceiptError,
  validateAttemptReceipt,
} from "./attempt-receipt.mjs";

const AUTHORIZATION_USED_EVENT = parseAbiItem(
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
);
const AUTHORIZATION_CANCELED_EVENT = parseAbiItem(
  "event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)",
);
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const DEFAULT_CONFIRMATION_DEPTH = 12;
const MAX_LOG_RANGE = 5_000n;
export const MAX_RPC_RESPONSE_BYTES = 1_000_000;
export const MAX_RPC_REQUESTS = 24;

export class ReconcileError extends Error {
  constructor(message, { code = "reconcile_error", field = null } = {}) {
    super(message);
    this.name = "ReconcileError";
    this.code = code;
    this.field = field;
  }
}

function fail(message, field = null, code = "invalid_reconcile_request") {
  throw new ReconcileError(message, { code, field });
}

function chainIdFromNetwork(network) {
  const match = /^eip155:(\d+)$/.exec(String(network || ""));
  if (!match) fail("network must look like eip155:<id>", "network");
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) fail("network chain id is invalid", "network");
  return id;
}

function chainForId(chainId) {
  if (chainId === base.id) return base;
  // Explicit authorized EIP-3009 assets may live on non-Base CAIP ids; do not
  // pretend they use Base's USDC contract descriptor.
  return {
    id: chainId,
    name: `eip155:${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [] } },
  };
}

/**
 * Validate receipt structure, scheme/chain/asset consistency before any RPC.
 * Does not load wallets or signatures.
 */
export function assertReceiptReadyForReconcile(receipt) {
  const validated = validateAttemptReceipt(receipt);
  if (validated.scheme !== "exact" || validated.assetTransferMethod !== "eip3009") {
    fail("receipt scheme/assetTransferMethod is unsupported for reconcile", "scheme", "unsupported_receipt");
  }
  if (validated.x402Version !== 2) {
    fail("only x402 v2 EIP-3009 receipts can be reconciled", "x402Version", "unsupported_receipt");
  }
  chainIdFromNetwork(validated.network);
  return validated;
}

function normalizeRpcUrl(rpcUrl) {
  const raw = String(rpcUrl || "").trim();
  if (!raw) fail("explicit rpcUrl is required", "rpcUrl");
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("rpcUrl must be an absolute URL", "rpcUrl");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail("rpcUrl must be http(s)", "rpcUrl");
  }
  if (url.username || url.password) {
    fail("rpcUrl must not contain credentials", "rpcUrl");
  }
  return url.toString();
}

export function safeRpcEndpoint(rpcUrl) {
  if (!rpcUrl) return null;
  try {
    const url = new URL(rpcUrl);
    return {
      origin: url.origin,
      protocol: url.protocol.replace(/:$/, ""),
    };
  } catch {
    return { origin: null, protocol: null };
  }
}

function sanitizeTransportMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  if (
    /response.?too.?large|ResponseBodyTooLarge|maxResponseBodySize|payload too large|413|size limit|exceeded the size/i
      .test(raw)
  ) {
    return "rpc_response_too_large";
  }
  if (/timeout|timed out|TimeoutError|transport_timeout|AbortError|aborted|rpc_timeout/i.test(raw)) {
    return "rpc_timeout";
  }
  if (/rpc_request_budget|request budget|too many rpc/i.test(raw)) {
    return "rpc_request_budget_exceeded";
  }
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network|ECONNRESET/i.test(raw)) {
    return "rpc_unavailable";
  }
  if (/JSON|Unexpected token|invalid json|malformed/i.test(raw)) {
    return "rpc_malformed_response";
  }
  return "rpc_error";
}

function wallClockExpiry(receipt, nowMs) {
  return windowState(receipt, Math.floor(nowMs / 1000));
}

function chainTimeExpiry(receipt, blockTimestampSec) {
  return windowState(receipt, Number(blockTimestampSec));
}

function windowState(receipt, nowSec) {
  const validAfter = Number(receipt.validAfter);
  const validBefore = Number(receipt.validBefore);
  if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore) || !Number.isFinite(nowSec)) {
    return { status: "unknown", expired: null, activeWindow: null, observedAtSec: null };
  }
  if (nowSec < validAfter) {
    return { status: "not_yet_valid", expired: false, activeWindow: false, observedAtSec: String(nowSec) };
  }
  if (nowSec >= validBefore) {
    return { status: "expired", expired: true, activeWindow: false, observedAtSec: String(nowSec) };
  }
  return { status: "within_window", expired: false, activeWindow: true, observedAtSec: String(nowSec) };
}

function finalityFor(blockNumber, blockHash, head, safe, finalized, canonicalHash) {
  const confirmations = head >= blockNumber ? head - blockNumber : 0n;
  const hashMatched = Boolean(blockHash) && Boolean(canonicalHash) &&
    String(blockHash).toLowerCase() === String(canonicalHash).toLowerCase();
  return {
    observedBlock: blockNumber.toString(),
    observedBlockHash: blockHash || null,
    canonicalBlockHash: canonicalHash || null,
    hashMatched,
    headBlock: head.toString(),
    confirmations: confirmations.toString(),
    confirmationDepthRequired: String(DEFAULT_CONFIRMATION_DEPTH),
    confirmed: hashMatched && confirmations >= BigInt(DEFAULT_CONFIRMATION_DEPTH),
    safeBlock: safe == null ? null : safe.toString(),
    finalizedBlock: finalized == null ? null : finalized.toString(),
    // A past block number below a finalized height alone is not canonicality proof.
    safe: hashMatched && safe != null ? blockNumber <= safe : null,
    finalized: hashMatched && finalized != null ? blockNumber <= finalized : null,
    note: hashMatched
      ? "finality tags apply only after the observed block hash still matches the canonical hash at that height"
      : "missing or mismatched canonical block hash; finality remains unknown",
  };
}

/**
 * Official viem HTTP transport with enforced byte, per-request timeout,
 * total-time, finite request count, and zero automatic retries.
 */
export function createBoundedRpcTransport(rpcUrl, {
  timeoutMs = 10_000,
  maxResponseBytes = MAX_RPC_RESPONSE_BYTES,
  maxRequests = MAX_RPC_REQUESTS,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const started = now();
  let requests = 0;
  const fetchFn = async (input, init = {}) => {
    if (now() - started >= timeoutMs) {
      throw new Error("rpc_timeout");
    }
    requests += 1;
    if (requests > maxRequests) {
      throw new Error("rpc_request_budget_exceeded");
    }
    const remaining = Math.max(1, timeoutMs - (now() - started));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    const abort = () => controller.abort();
    if (init.signal) {
      if (init.signal.aborted) controller.abort();
      else init.signal.addEventListener("abort", abort, { once: true });
    }
    try {
      const response = await fetchImpl(input, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
      // Keep the shared deadline alive through body consumption, not only headers.
      const reader = response.body?.getReader();
      if (!reader) return response;
      const chunks = [];
      let bytes = 0;
      try {
        if (Number(response.headers.get("content-length")) > maxResponseBytes) {
          throw new Error("rpc_response_too_large");
        }
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxResponseBytes) throw new Error("rpc_response_too_large");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (controller.signal.aborted || now() - started >= timeoutMs) throw new Error("rpc_timeout");
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(Buffer.concat(chunks, bytes), {
        status: response.status, statusText: response.statusText, headers,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && /abort/i.test(error.message))) {
        throw new Error("rpc_timeout");
      }
      throw error;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  };

  return http(rpcUrl, {
    timeout: timeoutMs,
    retryCount: 0,
    retryDelay: 0,
    maxResponseBodySize: maxResponseBytes,
    fetchFn,
  });
}

function createReconcileClient({ rpcUrl, chainId, timeoutMs, fetchImpl, now }) {
  return createPublicClient({
    chain: chainForId(chainId),
    transport: createBoundedRpcTransport(rpcUrl, {
      timeoutMs,
      maxResponseBytes: MAX_RPC_RESPONSE_BYTES,
      maxRequests: MAX_RPC_REQUESTS,
      fetchImpl,
      now,
    }),
  });
}

async function readCanonicalBlock(client, { blockNumber = null, blockTag = null } = {}) {
  if (blockNumber != null) {
    return client.getBlock({ blockNumber, includeTransactions: false });
  }
  if (blockTag) {
    return client.getBlock({ blockTag, includeTransactions: false });
  }
  return client.getBlock({ blockTag: "latest", includeTransactions: false });
}

async function readHeadTags(client) {
  const headBlock = await readCanonicalBlock(client, { blockTag: "latest" });
  let safe = null;
  let finalized = null;
  try {
    const block = await readCanonicalBlock(client, { blockTag: "safe" });
    safe = block?.number ?? null;
  } catch {
    safe = null;
  }
  try {
    const block = await readCanonicalBlock(client, { blockTag: "finalized" });
    finalized = block?.number ?? null;
  } catch {
    finalized = null;
  }
  return {
    head: headBlock.number,
    headHash: headBlock.hash,
    safe,
    finalized,
  };
}

async function findAuthorizationEvents(client, receipt, fromBlock, toBlock, event) {
  try {
    const logs = await client.getLogs({
      address: getAddress(receipt.asset),
      event,
      args: {
        authorizer: getAddress(receipt.payer),
        nonce: receipt.nonce,
      },
      fromBlock,
      toBlock,
    });
    return {
      found: logs.length > 0,
      truncatedRange: fromBlock > 0n,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      matches: logs.map((log) => ({
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber?.toString?.() ?? String(log.blockNumber),
        blockHash: log.blockHash ?? null,
        logIndex: log.logIndex == null ? null : String(log.logIndex),
        removed: Boolean(log.removed),
      })),
      error: null,
    };
  } catch (error) {
    return {
      found: null,
      truncatedRange: fromBlock > 0n,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      matches: [],
      error: sanitizeTransportMessage(error),
    };
  }
}

function decodeTransfer(log, expectedAsset) {
  if (String(log.address || "").toLowerCase() !== expectedAsset) return null;
  try {
    const decoded = decodeEventLog({
      abi: [TRANSFER_EVENT],
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    return {
      from: getAddress(decoded.args.from),
      to: getAddress(decoded.args.to),
      value: BigInt(decoded.args.value).toString(),
    };
  } catch {
    return null;
  }
}

function decodeAuthorizationUsed(log, receipt, event = AUTHORIZATION_USED_EVENT) {
  if (String(log.address || "").toLowerCase() !== getAddress(receipt.asset).toLowerCase()) {
    return null;
  }
  try {
    const decoded = decodeEventLog({
      abi: [event],
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    const authorizer = getAddress(decoded.args.authorizer);
    const nonce = String(decoded.args.nonce).toLowerCase();
    if (authorizer.toLowerCase() !== getAddress(receipt.payer).toLowerCase()) return null;
    if (nonce !== receipt.nonce.toLowerCase()) return null;
    return { authorizer, nonce };
  } catch {
    return null;
  }
}

async function matchExactSettlement(client, receipt, candidate, observedBlockNumber, { cancellation = false } = {}) {
  const txHash = candidate.transactionHash;
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { matched: false, reason: "missing_or_invalid_transaction_hash" };
  }
  if (candidate.removed) {
    return { matched: false, reason: "authorization_log_removed" };
  }
  let txReceipt;
  try {
    txReceipt = await client.getTransactionReceipt({ hash: txHash });
  } catch (error) {
    return {
      matched: false,
      reason: "transaction_receipt_unavailable",
      detail: sanitizeTransportMessage(error),
    };
  }
  if (!txReceipt) return { matched: false, reason: "transaction_receipt_unavailable" };
  if (txReceipt.status !== "success") {
    return {
      matched: false,
      reason: "transaction_not_successful",
      transactionHash: txHash,
      status: txReceipt.status ?? null,
    };
  }
  if (!txReceipt.blockHash || txReceipt.blockNumber == null || !txReceipt.transactionHash) {
    return { matched: false, reason: "missing_block_identifiers" };
  }
  if (String(txReceipt.transactionHash).toLowerCase() !== txHash.toLowerCase()) {
    return { matched: false, reason: "transaction_hash_mismatch" };
  }
  if (
    candidate.blockNumber != null &&
    BigInt(candidate.blockNumber) !== BigInt(txReceipt.blockNumber)
  ) {
    return { matched: false, reason: "log_block_number_mismatch" };
  }
  if (
    candidate.blockHash &&
    String(candidate.blockHash).toLowerCase() !== String(txReceipt.blockHash).toLowerCase()
  ) {
    return { matched: false, reason: "log_block_hash_mismatch" };
  }
  // Do not promote evidence observed at an earlier snapshot into a later head.
  if (BigInt(txReceipt.blockNumber) > observedBlockNumber) {
    return { matched: false, reason: "settlement_block_after_observed_snapshot" };
  }

  let canonical;
  try {
    canonical = await readCanonicalBlock(client, { blockNumber: BigInt(txReceipt.blockNumber) });
  } catch (error) {
    return {
      matched: false,
      reason: "canonical_block_unavailable",
      detail: sanitizeTransportMessage(error),
    };
  }
  if (!canonical?.hash) {
    return { matched: false, reason: "canonical_block_unavailable" };
  }
  if (String(canonical.hash).toLowerCase() !== String(txReceipt.blockHash).toLowerCase()) {
    return {
      matched: false,
      reason: "canonical_block_hash_mismatch",
      transactionHash: txHash,
      blockNumber: txReceipt.blockNumber.toString(),
      receiptBlockHash: txReceipt.blockHash,
      canonicalBlockHash: canonical.hash,
    };
  }

  const expectedAsset = getAddress(receipt.asset).toLowerCase();
  const expectedFrom = getAddress(receipt.payer).toLowerCase();
  const expectedTo = getAddress(receipt.payee).toLowerCase();
  const expectedValue = BigInt(receipt.amountAtomic);

  const usedInReceipt = [];
  const canceledInReceipt = [];
  const transfers = [];
  for (const log of txReceipt.logs || []) {
    if (log.removed) {
      return { matched: false, reason: "receipt_contains_removed_log" };
    }
    const used = decodeAuthorizationUsed(log, receipt);
    if (used) usedInReceipt.push(used);
    const canceled = decodeAuthorizationUsed(log, receipt, AUTHORIZATION_CANCELED_EVENT);
    if (canceled) canceledInReceipt.push(canceled);
    const transfer = decodeTransfer(log, expectedAsset);
    if (transfer) transfers.push(transfer);
  }
  if (cancellation) {
    if (canceledInReceipt.length !== 1 || usedInReceipt.length !== 0) {
      return { matched: false, reason: "cancellation_not_uniquely_proven_in_receipt" };
    }
    return { matched: true, transactionHash: txHash, blockNumber: txReceipt.blockNumber.toString(),
      blockHash: txReceipt.blockHash, canonicalBlockHash: canonical.hash };
  }
  if (canceledInReceipt.length > 0) return { matched: false, reason: "conflicting_cancellation_in_receipt" };
  if (usedInReceipt.length !== 1) {
    return {
      matched: false,
      reason: usedInReceipt.length === 0
        ? "authorization_used_missing_in_receipt"
        : "ambiguous_authorization_used_in_receipt",
      transactionHash: txHash,
      authorizationUsedCount: usedInReceipt.length,
    };
  }

  const exact = transfers.filter((entry) => (
    entry.from.toLowerCase() === expectedFrom &&
    entry.to.toLowerCase() === expectedTo &&
    BigInt(entry.value) === expectedValue
  ));
  if (exact.length !== 1) {
    return {
      matched: false,
      reason: exact.length === 0 ? "no_exact_matching_transfer" : "ambiguous_matching_transfers",
      transactionHash: txHash,
      blockNumber: txReceipt.blockNumber.toString(),
      observedTransfers: transfers.length,
      matchingTransfers: exact.length,
    };
  }

  return {
    matched: true,
    transactionHash: txHash,
    blockNumber: txReceipt.blockNumber.toString(),
    blockHash: txReceipt.blockHash,
    transfer: exact[0],
    canonicalBlockHash: canonical.hash,
  };
}

function baseResult(receipt, nowIso) {
  return {
    schema: "samedaydesk.customer-x402.attempt-reconcile.v1",
    checkedAt: nowIso,
    receipt: {
      schema: receipt.schema,
      stage: receipt.stage,
      network: receipt.network,
      asset: receipt.asset,
      payer: receipt.payer,
      payee: receipt.payee,
      amountAtomic: receipt.amountAtomic,
      nonce: receipt.nonce,
      validAfter: receipt.validAfter,
      validBefore: receipt.validBefore,
      paymentIdentifier: receipt.paymentIdentifier,
      request: receipt.request,
    },
    claims: Object.freeze({
      deliveredOutput: false,
      retryAuthorized: false,
      respendAuthorized: false,
      note: "authorizationState/chain usage never implies successful delivery or permission for another purchase",
    }),
  };
}

function reconcileBoundary() {
  return Object.freeze({
    walletAccessed: false,
    signatureCreated: false,
    paymentSent: false,
    retry: false,
    unlock: false,
    respend: false,
    funding: false,
    balanceMoved: false,
    note: "read-only authorizationState/log evidence only; confirmation and finality are reported separately",
  });
}

/**
 * Read-only EIP-3009 authorization reconcile against an explicit RPC.
 * No wallet load, signing, funding, retry, or mutation.
 */
export async function reconcileAttemptReceipt({
  receipt,
  rpcUrl,
  client = null,
  now = () => new Date(),
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  let validated;
  try {
    validated = assertReceiptReadyForReconcile(receipt);
  } catch (error) {
    if (error instanceof AttemptReceiptError || error instanceof ReconcileError) throw error;
    fail(error instanceof Error ? error.message : String(error));
  }

  const nowDate = now();
  const nowIso = nowDate.toISOString();
  const wallExpiry = wallClockExpiry(validated, nowDate.getTime());
  const chainId = chainIdFromNetwork(validated.network);
  const normalizedRpc = client ? (rpcUrl ? normalizeRpcUrl(rpcUrl) : null) : normalizeRpcUrl(rpcUrl);
  const endpoint = safeRpcEndpoint(normalizedRpc);

  const publicClient = client || createReconcileClient({
    rpcUrl: normalizedRpc,
    chainId,
    timeoutMs,
    fetchImpl,
    now: () => Date.now(),
  });

  const out = baseResult(validated, nowIso);
  out.expiry = {
    wallClock: wallExpiry,
    chainTime: null,
    note: "wall-clock expiry is separate from chain-time expiry derived from the observed block timestamp",
  };
  out.rpc = {
    endpoint,
    timeoutMs,
    maxResponseBytes: MAX_RPC_RESPONSE_BYTES,
    maxRequests: MAX_RPC_REQUESTS,
    retryCount: 0,
  };

  // Validate eth_chainId before authorizationState / eth_call.
  let remoteChainId;
  try {
    remoteChainId = await publicClient.getChainId();
  } catch (error) {
    return {
      ...out,
      decision: "rpc_unavailable",
      authorization: { state: "unknown", used: null },
      settlement: { matched: false, status: "unknown", reason: "eth_chainId unavailable" },
      finality: null,
      uncertainty: ["RPC chain id could not be read before authorizationState"],
      message: sanitizeTransportMessage(error),
      boundary: reconcileBoundary(),
    };
  }
  if (Number(remoteChainId) !== chainId) {
    return {
      ...out,
      decision: "chain_mismatch",
      authorization: { state: "unknown", used: null },
      settlement: { matched: false, status: "unknown", reason: "rpc chain id does not match receipt network" },
      finality: null,
      uncertainty: ["wrong-chain RPC cannot yield an authorizationState verdict"],
      message: "chain_mismatch",
      boundary: reconcileBoundary(),
    };
  }

  let observedBlock;
  try {
    observedBlock = await readCanonicalBlock(publicClient, { blockTag: "latest" });
  } catch (error) {
    return {
      ...out,
      decision: "rpc_unavailable",
      authorization: { state: "unknown", used: null },
      settlement: { matched: false, status: "unknown", reason: "observed block unavailable" },
      finality: null,
      uncertainty: ["could not pin authorizationState to an explicit observed block"],
      message: sanitizeTransportMessage(error),
      boundary: reconcileBoundary(),
    };
  }
  if (observedBlock?.number == null || !observedBlock.hash || observedBlock.timestamp == null) {
    return {
      ...out,
      decision: "unsupported_or_unknown",
      authorization: { state: "unknown", used: null },
      settlement: { matched: false, status: "unknown", reason: "observed block missing number/hash/timestamp" },
      finality: null,
      uncertainty: ["provider block format is not safely understood"],
      boundary: reconcileBoundary(),
    };
  }

  const chainExpiry = chainTimeExpiry(validated, observedBlock.timestamp);
  out.expiry.chainTime = chainExpiry;
  out.observedBlock = {
    number: observedBlock.number.toString(),
    hash: observedBlock.hash,
    timestamp: observedBlock.timestamp.toString(),
  };

  let authorizationUsed;
  try {
    authorizationUsed = await publicClient.readContract({
      address: getAddress(validated.asset),
      abi: eip3009ABI,
      functionName: "authorizationState",
      args: [getAddress(validated.payer), validated.nonce],
      blockNumber: observedBlock.number,
    });
  } catch (error) {
    return {
      ...out,
      decision: sanitizeTransportMessage(error) === "rpc_unavailable" ||
        sanitizeTransportMessage(error) === "rpc_timeout" ||
        sanitizeTransportMessage(error) === "rpc_response_too_large" ||
        sanitizeTransportMessage(error) === "rpc_request_budget_exceeded"
        ? "rpc_unavailable"
        : "rpc_error",
      authorization: { state: "unknown", used: null },
      settlement: { matched: false, status: "unknown", reason: "authorizationState unavailable" },
      finality: null,
      uncertainty: [
        "authorizationState could not be read at the observed block",
        "absence of evidence here is not proof of non-settlement",
      ],
      message: sanitizeTransportMessage(error),
      boundary: reconcileBoundary(),
    };
  }

  if (typeof authorizationUsed !== "boolean") {
    return {
      ...out,
      decision: "unsupported_or_unknown",
      authorization: { state: "unknown", used: null },
      settlement: { matched: false, status: "unknown", reason: "authorizationState returned a non-boolean value" },
      finality: null,
      uncertainty: ["provider format for authorizationState is not safely understood"],
      boundary: reconcileBoundary(),
    };
  }

  // eth_call uses a block number. Recheck that height before assigning its hash
  // to the returned state, including when later head-tag reads are unavailable.
  try {
    const canonical = await readCanonicalBlock(publicClient, { blockNumber: observedBlock.number });
    if (canonical?.hash !== observedBlock.hash || canonical?.number !== observedBlock.number) {
      return { ...out, decision: "observed_block_changed", authorization: { state: "unknown", used: null },
        settlement: { matched: false, status: "unknown", reason: "observed block changed during state read" },
        finality: null, uncertainty: ["reorg prevents binding state to the original snapshot"], boundary: reconcileBoundary() };
    }
  } catch (error) {
    return { ...out, decision: "rpc_unavailable", authorization: { state: "unknown", used: null },
      settlement: { matched: false, status: "unknown", reason: "observed block recheck unavailable" },
      finality: null, uncertainty: ["state-to-block binding remains unproven"],
      message: sanitizeTransportMessage(error), boundary: reconcileBoundary() };
  }

  let headTags;
  try {
    headTags = await readHeadTags(publicClient);
  } catch (error) {
    return {
      ...out,
      decision: authorizationUsed
        ? "used_head_unavailable"
        : (chainExpiry.expired ? "unused_expired_head_unavailable" : "unused_head_unavailable"),
      authorization: {
        state: authorizationUsed ? "consumed" : "unused",
        used: authorizationUsed,
        observedBlockNumber: observedBlock.number.toString(),
        observedBlockHash: observedBlock.hash,
      },
      settlement: {
        matched: false,
        status: authorizationUsed ? "consumed_without_proven_settlement_match" : "not_used",
        reason: "block head/finality tags unavailable",
      },
      finality: null,
      uncertainty: [
        "could not separate confirmation from finality without head tags",
        ...(authorizationUsed
          ? ["consumed authorization is not delivered output and not retry authorization"]
          : ["unused without head context still does not authorize another purchase"]),
      ],
      message: sanitizeTransportMessage(error),
      boundary: reconcileBoundary(),
    };
  }

  if (!authorizationUsed) {
    const decision = chainExpiry.expired ? "unused_expired" : "unused_within_window";
    return {
      ...out,
      decision,
      authorization: {
        state: "unused",
        used: false,
        observedBlockNumber: observedBlock.number.toString(),
        observedBlockHash: observedBlock.hash,
      },
      settlement: {
        matched: false,
        status: "not_used",
        reason: chainExpiry.expired
          ? "authorizationState is unused and chain-time validBefore has passed"
          : "authorizationState is unused; chain-time window may still be open",
      },
      finality: {
        headBlock: headTags.head.toString(),
        headBlockHash: headTags.headHash || null,
        safeBlock: headTags.safe == null ? null : headTags.safe.toString(),
        finalizedBlock: headTags.finalized == null ? null : headTags.finalized.toString(),
        note: "no settlement block to confirm or finalize; missing safe/finalized tags stay unknown",
      },
      uncertainty: chainExpiry.expired
        ? ["unused+expired does not prove the paid HTTP attempt was never accepted by a facilitator before expiry"]
        : ["unused within window is not permission to retry with the same or a new authorization"],
      claims: out.claims,
      boundary: reconcileBoundary(),
    };
  }

  // Consumed nonce: distinguish AuthorizationUsed settlement from cancellation.
  const fromBlock = observedBlock.number > MAX_LOG_RANGE
    ? observedBlock.number - MAX_LOG_RANGE + 1n
    : 0n;
  const toBlock = observedBlock.number;
  const usedLogs = await findAuthorizationEvents(
    publicClient, validated, fromBlock, toBlock, AUTHORIZATION_USED_EVENT,
  );
  const canceledLogs = await findAuthorizationEvents(
    publicClient, validated, fromBlock, toBlock, AUTHORIZATION_CANCELED_EVENT,
  );

  const uncertainty = [
    "authorizationState true alone is not payment, delivered output, or permission to retry or respend",
  ];
  if (usedLogs.found === false && usedLogs.truncatedRange) {
    uncertainty.push(
      "AuthorizationUsed was absent from a truncated recent log range; absence there is not final no-settlement proof beyond authorizationState",
    );
  }
  if (canceledLogs.found === false && canceledLogs.truncatedRange) {
    uncertainty.push(
      "AuthorizationCanceled was absent from a truncated recent log range; absence there remains unknown when the nonce is consumed",
    );
  }
  if (usedLogs.found === null) {
    uncertainty.push("AuthorizationUsed log query failed; settlement match remains unproven");
  }
  if (canceledLogs.found === null) {
    uncertainty.push("AuthorizationCanceled log query failed; cancellation remains unproven");
  }

  const liveUsed = (usedLogs.matches || []).filter((entry) => !entry.removed);
  const liveCanceled = (canceledLogs.matches || []).filter((entry) => !entry.removed);

  if (liveCanceled.length > 0 && liveUsed.length === 0) {
    const cancellation = liveCanceled.length === 1 && usedLogs.found === false
      ? await matchExactSettlement(publicClient, validated, liveCanceled[0], observedBlock.number, { cancellation: true })
      : { matched: false, reason: "incomplete_or_ambiguous_authorization_logs" };
    return {
      ...out,
      decision: cancellation.matched ? "canceled_unsettled" : "cancellation_unverified",
      authorization: {
        state: cancellation.matched ? "canceled" : "consumed",
        used: true,
        observedBlockNumber: observedBlock.number.toString(),
        observedBlockHash: observedBlock.hash,
      },
      settlement: {
        matched: false,
        status: cancellation.matched ? "canceled" : "unknown",
        reason: cancellation.matched
          ? "canonical successful receipt contains exact AuthorizationCanceled and no AuthorizationUsed"
          : cancellation.reason,
        cancellationEvidence: cancellation,
        authorizationCanceledLogs: canceledLogs,
        authorizationUsedLogs: usedLogs,
      },
      finality: {
        headBlock: headTags.head.toString(),
        safeBlock: headTags.safe == null ? null : headTags.safe.toString(),
        finalizedBlock: headTags.finalized == null ? null : headTags.finalized.toString(),
        note: "cancellation is not a settled Transfer",
      },
      uncertainty,
      claims: out.claims,
      boundary: reconcileBoundary(),
    };
  }

  if (liveCanceled.length > 0 && liveUsed.length > 0) {
    return {
      ...out,
      decision: "used_ambiguous_authorization_logs",
      authorization: {
        state: "consumed",
        used: true,
        observedBlockNumber: observedBlock.number.toString(),
        observedBlockHash: observedBlock.hash,
      },
      settlement: {
        matched: false,
        status: "used_ambiguous_authorization_logs",
        reason: "both AuthorizationUsed and AuthorizationCanceled matched in range",
        authorizationCanceledLogs: canceledLogs,
        authorizationUsedLogs: usedLogs,
      },
      finality: null,
      uncertainty: [...uncertainty, "conflicting used/canceled evidence prevents exact settlement binding"],
      claims: out.claims,
      boundary: reconcileBoundary(),
    };
  }

  let settlement = {
    matched: false,
    status: "used_without_proven_settlement_match",
    reason: "authorizationState=true without an exact matched Transfer in the bounded evidence set",
    authorizationUsedLogs: usedLogs,
    authorizationCanceledLogs: canceledLogs,
  };
  let finality = null;

  if (liveUsed.length === 1) {
    const match = await matchExactSettlement(
      publicClient,
      validated,
      liveUsed[0],
      observedBlock.number,
    );
    if (match.matched) {
      finality = finalityFor(
        BigInt(match.blockNumber),
        match.blockHash,
        headTags.head,
        headTags.safe,
        headTags.finalized,
        match.canonicalBlockHash,
      );
      settlement = {
        matched: true,
        status: "exact_transfer_matched",
        transactionHash: match.transactionHash,
        blockNumber: match.blockNumber,
        blockHash: match.blockHash,
        transfer: match.transfer,
        authorizationUsedLogs: usedLogs,
        authorizationCanceledLogs: canceledLogs,
      };
    } else {
      settlement = {
        matched: false,
        status: "used_without_proven_settlement_match",
        reason: match.reason,
        detail: match.detail ?? null,
        authorizationUsedLogs: usedLogs,
        authorizationCanceledLogs: canceledLogs,
        observedTransfers: match.observedTransfers ?? null,
        matchingTransfers: match.matchingTransfers ?? null,
        statusCode: match.status ?? null,
      };
      uncertainty.push("AuthorizationUsed was observed but an exact successful Transfer settlement was not proven");
    }
  } else if (liveUsed.length > 1) {
    settlement = {
      matched: false,
      status: "used_ambiguous_authorization_logs",
      reason: "multiple AuthorizationUsed logs matched the identity in range",
      authorizationUsedLogs: usedLogs,
      authorizationCanceledLogs: canceledLogs,
    };
    uncertainty.push("multiple AuthorizationUsed matches prevent exact settlement binding");
  }

  return {
    ...out,
    decision: settlement.matched
      ? (finality?.finalized ? "used_settlement_finalized"
        : finality?.confirmed ? "used_settlement_confirmed"
          : "used_settlement_matched_unfinalized")
      : "used_unmatched_settlement",
    authorization: {
      state: settlement.matched ? "used" : "consumed",
      used: true,
      observedBlockNumber: observedBlock.number.toString(),
      observedBlockHash: observedBlock.hash,
    },
    settlement,
    finality,
    uncertainty,
    claims: out.claims,
    boundary: reconcileBoundary(),
  };
}
