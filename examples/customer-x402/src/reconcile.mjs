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
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const DEFAULT_CONFIRMATION_DEPTH = 12;
const MAX_LOG_RANGE = 5_000n;
const MAX_RPC_RESPONSE_BYTES = 1_000_000;

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
  return Number(match[1]);
}

function chainForId(chainId) {
  if (chainId === base.id) return base;
  // Minimal chain descriptor for offline fixtures / non-Base CAIP ids.
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

function expiryState(receipt, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  const validAfter = Number(receipt.validAfter);
  const validBefore = Number(receipt.validBefore);
  if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore)) {
    return { expiry: "unknown", expired: null, activeWindow: null };
  }
  if (nowSec < validAfter) {
    return { expiry: "not_yet_valid", expired: false, activeWindow: false };
  }
  if (nowSec >= validBefore) {
    return { expiry: "expired", expired: true, activeWindow: false };
  }
  return { expiry: "within_window", expired: false, activeWindow: true };
}

function finalityFor(blockNumber, head, safe, finalized) {
  const confirmations = head >= blockNumber ? head - blockNumber : 0n;
  return {
    observedBlock: blockNumber.toString(),
    headBlock: head.toString(),
    confirmations: confirmations.toString(),
    confirmationDepthRequired: String(DEFAULT_CONFIRMATION_DEPTH),
    confirmed: confirmations >= BigInt(DEFAULT_CONFIRMATION_DEPTH),
    safeBlock: safe == null ? null : safe.toString(),
    finalizedBlock: finalized == null ? null : finalized.toString(),
    safe: safe != null && blockNumber <= safe,
    finalized: finalized != null && blockNumber <= finalized,
  };
}

async function readHeadTags(client) {
  const head = await client.getBlockNumber();
  let safe = null;
  let finalized = null;
  try {
    const block = await client.getBlock({ blockTag: "safe" });
    safe = block.number;
  } catch {
    safe = null;
  }
  try {
    const block = await client.getBlock({ blockTag: "finalized" });
    finalized = block.number;
  } catch {
    finalized = null;
  }
  return { head, safe, finalized };
}

async function findAuthorizationUsed(client, receipt, head) {
  const fromBlock = head > MAX_LOG_RANGE ? head - MAX_LOG_RANGE + 1n : 0n;
  try {
    const logs = await client.getLogs({
      address: getAddress(receipt.asset),
      event: AUTHORIZATION_USED_EVENT,
      args: {
        authorizer: getAddress(receipt.payer),
        nonce: receipt.nonce,
      },
      fromBlock,
      toBlock: head,
    });
    if (!logs.length) {
      return {
        found: false,
        truncatedRange: fromBlock > 0n,
        fromBlock: fromBlock.toString(),
        toBlock: head.toString(),
        matches: [],
      };
    }
    return {
      found: true,
      truncatedRange: fromBlock > 0n,
      fromBlock: fromBlock.toString(),
      toBlock: head.toString(),
      matches: logs.map((log) => ({
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber?.toString?.() ?? String(log.blockNumber),
        logIndex: log.logIndex == null ? null : String(log.logIndex),
      })),
    };
  } catch (error) {
    return {
      found: null,
      truncatedRange: fromBlock > 0n,
      fromBlock: fromBlock.toString(),
      toBlock: head.toString(),
      error: error instanceof Error ? error.message : String(error),
      matches: [],
    };
  }
}

async function matchExactTransfer(client, receipt, txHash) {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { matched: false, reason: "missing_or_invalid_transaction_hash" };
  }
  let txReceipt;
  try {
    txReceipt = await client.getTransactionReceipt({ hash: txHash });
  } catch (error) {
    return {
      matched: false,
      reason: "transaction_receipt_unavailable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!txReceipt) return { matched: false, reason: "transaction_receipt_unavailable" };
  const expectedAsset = getAddress(receipt.asset).toLowerCase();
  const expectedFrom = getAddress(receipt.payer).toLowerCase();
  const expectedTo = getAddress(receipt.payee).toLowerCase();
  const expectedValue = BigInt(receipt.amountAtomic);
  const transfers = [];
  for (const log of txReceipt.logs || []) {
    if (String(log.address || "").toLowerCase() !== expectedAsset) continue;
    try {
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      transfers.push({
        from: getAddress(decoded.args.from),
        to: getAddress(decoded.args.to),
        value: BigInt(decoded.args.value).toString(),
      });
    } catch {
      // ignore unrelated logs
    }
  }
  const exact = transfers.find((entry) => (
    entry.from.toLowerCase() === expectedFrom &&
    entry.to.toLowerCase() === expectedTo &&
    BigInt(entry.value) === expectedValue
  ));
  if (!exact) {
    return {
      matched: false,
      reason: "no_exact_matching_transfer",
      transactionHash: txHash,
      blockNumber: txReceipt.blockNumber?.toString?.() ?? null,
      observedTransfers: transfers.length,
    };
  }
  return {
    matched: true,
    transactionHash: txHash,
    blockNumber: txReceipt.blockNumber?.toString?.() ?? null,
    transfer: exact,
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
  const expiry = expiryState(validated, nowDate.getTime());
  const chainId = chainIdFromNetwork(validated.network);
  const normalizedRpc = client ? null : normalizeRpcUrl(rpcUrl);

  const publicClient = client || createPublicClient({
    chain: chainForId(chainId),
    transport: http(normalizedRpc, {
      timeout: timeoutMs,
      fetchOptions: {
        // Bound response size where the runtime cooperates; fixtures enforce separately.
        duplex: undefined,
      },
    }),
  });

  const out = baseResult(validated, nowIso);
  out.expiry = expiry;
  out.rpc = {
    url: normalizedRpc,
    timeoutMs,
    maxResponseBytes: MAX_RPC_RESPONSE_BYTES,
  };

  let authorizationUsed;
  try {
    authorizationUsed = await publicClient.readContract({
      address: getAddress(validated.asset),
      abi: eip3009ABI,
      functionName: "authorizationState",
      args: [getAddress(validated.payer), validated.nonce],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unavailable = /timeout|timed out|fetch failed|econnrefused|enotfound|403|429|503|rpc/i.test(message);
    return {
      ...out,
      decision: unavailable ? "rpc_unavailable" : "rpc_error",
      authorization: { state: "unknown", used: null },
      settlement: { matched: false, status: "unknown", reason: "authorizationState unavailable" },
      finality: null,
      uncertainty: [
        "authorizationState could not be read from the provided RPC",
        "absence of evidence here is not proof of non-settlement",
      ],
      message,
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

  let headTags;
  try {
    headTags = await readHeadTags(publicClient);
  } catch (error) {
    return {
      ...out,
      decision: authorizationUsed ? "used_head_unavailable" : (expiry.expired ? "unused_expired_head_unavailable" : "unused_head_unavailable"),
      authorization: {
        state: authorizationUsed ? "used" : "unused",
        used: authorizationUsed,
      },
      settlement: {
        matched: false,
        status: authorizationUsed ? "used_without_proven_settlement_match" : "not_used",
        reason: "block head/finality tags unavailable",
      },
      finality: null,
      uncertainty: [
        "could not separate confirmation from finality without head tags",
        ...(authorizationUsed
          ? ["used authorization is not delivered output and not retry authorization"]
          : ["unused without head context still does not authorize another purchase"]),
      ],
      message: error instanceof Error ? error.message : String(error),
      boundary: reconcileBoundary(),
    };
  }

  if (!authorizationUsed) {
    const decision = expiry.expired ? "unused_expired" : "unused_within_window";
    return {
      ...out,
      decision,
      authorization: { state: "unused", used: false },
      settlement: {
        matched: false,
        status: "not_used",
        reason: expiry.expired
          ? "authorizationState is unused and validBefore has passed"
          : "authorizationState is unused; window may still be open",
      },
      finality: {
        headBlock: headTags.head.toString(),
        safeBlock: headTags.safe == null ? null : headTags.safe.toString(),
        finalizedBlock: headTags.finalized == null ? null : headTags.finalized.toString(),
        note: "no settlement block to confirm or finalize",
      },
      uncertainty: expiry.expired
        ? ["unused+expired does not prove the paid HTTP attempt was never accepted by a facilitator before expiry"]
        : ["unused within window is not permission to retry with the same or a new authorization"],
      claims: out.claims,
      boundary: reconcileBoundary(),
    };
  }

  // Used path: optional exact settlement match via AuthorizationUsed + Transfer.
  const usedLogs = await findAuthorizationUsed(publicClient, validated, headTags.head);
  let settlement = {
    matched: false,
    status: "used_without_proven_settlement_match",
    reason: "authorizationState=true without an exact matched Transfer in the bounded evidence set",
    authorizationUsedLogs: usedLogs,
  };
  let finality = null;
  const uncertainty = [
    "used authorization is not delivered output and not permission to retry or respend",
  ];

  if (usedLogs.found === false && usedLogs.truncatedRange) {
    uncertainty.push(
      "AuthorizationUsed was absent from a truncated recent log range; absence there is not final no-settlement proof beyond authorizationState",
    );
  }
  if (usedLogs.found === null) {
    uncertainty.push("AuthorizationUsed log query failed; settlement match remains unproven");
  }

  if (usedLogs.found && usedLogs.matches.length === 1) {
    const match = await matchExactTransfer(publicClient, validated, usedLogs.matches[0].transactionHash);
    if (match.matched) {
      const blockNumber = BigInt(match.blockNumber);
      finality = finalityFor(blockNumber, headTags.head, headTags.safe, headTags.finalized);
      settlement = {
        matched: true,
        status: "exact_transfer_matched",
        transactionHash: match.transactionHash,
        blockNumber: match.blockNumber,
        transfer: match.transfer,
        authorizationUsedLogs: usedLogs,
      };
    } else {
      settlement = {
        matched: false,
        status: "used_without_proven_settlement_match",
        reason: match.reason,
        detail: match.detail ?? null,
        authorizationUsedLogs: usedLogs,
        observedTransfers: match.observedTransfers ?? null,
      };
      uncertainty.push("AuthorizationUsed was observed but an exact payer/payee/amount Transfer match was not proven");
    }
  } else if (usedLogs.found && usedLogs.matches.length > 1) {
    settlement = {
      matched: false,
      status: "used_ambiguous_authorization_logs",
      reason: "multiple AuthorizationUsed logs matched the identity in range",
      authorizationUsedLogs: usedLogs,
    };
    uncertainty.push("multiple AuthorizationUsed matches prevent exact settlement binding");
  }

  return {
    ...out,
    decision: settlement.matched
      ? (finality?.finalized ? "used_settlement_finalized" : finality?.confirmed ? "used_settlement_confirmed" : "used_settlement_matched_unfinalized")
      : "used_unmatched_settlement",
    authorization: { state: "used", used: true },
    settlement,
    finality,
    uncertainty,
    claims: out.claims,
    boundary: reconcileBoundary(),
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

export function createFakeReconcileClient(handlers = {}) {
  return {
    async readContract(args) {
      if (handlers.readContract) return handlers.readContract(args);
      throw new Error("fake readContract not configured");
    },
    async getBlockNumber() {
      if (handlers.getBlockNumber) return handlers.getBlockNumber();
      return 1000n;
    },
    async getBlock(args) {
      if (handlers.getBlock) return handlers.getBlock(args);
      const number = await this.getBlockNumber();
      return { number, timestamp: 1_700_000_000n };
    },
    async getLogs(args) {
      if (handlers.getLogs) return handlers.getLogs(args);
      return [];
    },
    async getTransactionReceipt(args) {
      if (handlers.getTransactionReceipt) return handlers.getTransactionReceipt(args);
      return null;
    },
  };
}
