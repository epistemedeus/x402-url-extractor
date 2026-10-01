import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { digestOf } from "../task-linked-delivery/experiments/delivery-outcome-100173/src/canonical.mjs";
import { hasDisallowedKey } from "../task-linked-delivery/experiments/delivery-outcome-100173/src/privacy.mjs";
import { transactionReceipt } from "../transaction-receipt.mjs";
import { ACCOUNTING_SCHEMA, CLOSED_SPONSORED_REF, KNOWLEDGE_SCHEMA } from "./constants.mjs";

const PIN_URL = new URL(
  "../task-linked-delivery/tools/ops/three-site-settlement-join/measure/pins/sponsored-outflow.json",
  import.meta.url,
);
const ADDRESS = /(^|[^0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

export const RECEIPT_OPERATION = "normalized-transaction-receipt";
export const RECEIPT_METHOD = "GET";
export const RECEIPT_ROUTE = "/chain/transaction-receipt";
export const RECEIPT_SCHEMA_NAME = "samedaydesk-transaction-receipt";
export const RECEIPT_SCHEMA_VERSION = "1.0.0";
export const IMPLEMENTATION = "transaction-receipt.mjs#transactionReceipt";
export const KNOWLEDGE_SOURCE = "public-historical-base-receipt";
export const CAPTURED_RECEIPT = new URL("./fixtures/h15-base-receipt.json", import.meta.url);
export { ACCOUNTING_SCHEMA, KNOWLEDGE_SCHEMA };

export class ReceiptUseError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReceiptUseError";
    this.code = code;
  }
}

function fail(code) {
  throw new ReceiptUseError(code);
}

function dec(value) {
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value ?? "");
  if (text.startsWith("0x") || text.startsWith("0X")) return BigInt(text).toString(10);
  return text;
}

function lower(value) {
  return String(value || "").toLowerCase();
}

export function containsAccount(value) {
  return ADDRESS.test(JSON.stringify(value ?? null));
}

export function loadPin() {
  let pin;
  try {
    pin = JSON.parse(readFileSync(PIN_URL, "utf8"));
  } catch {
    fail("sponsored_pin_mismatch");
  }
  if (
    pin?.schema !== "pilot.s17.sponsored-outflow-pin.v1"
    || pin.network !== "eip155:8453"
    || pin.asset !== "base-native-usdc"
    || pin.direction !== "out"
    || pin.atomic !== "200000"
    || String(pin.blockNumber) !== "52009071"
    || pin.claim !== "closed"
    || pin.secondPay !== false
    || pin.recognizedRevenue !== false
    || pin.class !== "sponsored_evaluation_expense"
    || lower(pin.movementRef) !== CLOSED_SPONSORED_REF
  ) {
    fail("sponsored_pin_mismatch");
  }
  return {
    asset: pin.asset,
    atomic: pin.atomic,
    blockNumber: String(pin.blockNumber),
    claim: "closed",
    class: pin.class,
    direction: pin.direction,
    movementRef: CLOSED_SPONSORED_REF,
    network: pin.network,
    recognizedRevenue: false,
    secondPay: false,
  };
}

export function canonicalReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") fail("receipt_rejected");
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  return {
    blockHash: lower(receipt.blockHash),
    blockNumber: dec(receipt.blockNumber),
    effectiveGasPrice: dec(receipt.effectiveGasPrice),
    from: lower(receipt.from),
    gasUsed: dec(receipt.gasUsed),
    logs: logs.map((log) => ({
      address: lower(log.address),
      data: lower(log.data),
      logIndex: dec(log.logIndex),
      topics: (log.topics || []).map((topic) => lower(topic)),
    })),
    status: normalizeStatus(receipt.status),
    to: lower(receipt.to),
    transactionIndex: dec(receipt.transactionIndex),
  };
}

export function sourceShaOfReceipt(receipt) {
  return digestOf(canonicalReceipt(receipt));
}

function normalizeStatus(status) {
  const text = String(status || "");
  if (text === "0x1" || text === "success") return "success";
  if (text === "0x0" || text === "reverted") return "reverted";
  return text || "unknown";
}

function toExecutedReceipt(receipt) {
  const canonical = canonicalReceipt(receipt);
  return {
    blockHash: canonical.blockHash,
    blockNumber: BigInt(canonical.blockNumber),
    effectiveGasPrice: BigInt(canonical.effectiveGasPrice),
    from: canonical.from,
    gasUsed: BigInt(canonical.gasUsed),
    logs: canonical.logs.map((log) => ({
      address: log.address,
      data: log.data,
      logIndex: Number(log.logIndex),
      topics: log.topics,
    })),
    status: canonical.status,
    to: canonical.to,
    transactionIndex: Number(canonical.transactionIndex),
    type: "eip1559",
  };
}

export function clientFromCapture(capture) {
  if (!capture || capture.schema !== "samedaydesk.public-historical-base-receipt.v1") fail("receipt_rejected");
  if (lower(capture.blockHash) !== lower(capture.receipt?.blockHash)) fail("receipt_rejected");
  const receipt = toExecutedReceipt(capture.receipt);
  const calls = { receipt: 0, block: 0, paid: 0, model: 0 };
  return {
    calls,
    sourceSha: sourceShaOfReceipt(capture.receipt),
    async getTransactionReceipt({ hash } = {}) {
      calls.receipt += 1;
      if (lower(hash) !== CLOSED_SPONSORED_REF) {
        const error = new Error("could not be found");
        error.name = "TransactionReceiptNotFoundError";
        throw error;
      }
      return receipt;
    },
    async getBlock() {
      calls.block += 1;
      return { timestamp: BigInt(capture.blockTimestamp) };
    },
  };
}

export async function readCapture(file) {
  const capture = JSON.parse(await readFile(file, "utf8"));
  clientFromCapture(capture);
  return capture;
}

export function projectExecution(executed, pin = loadPin()) {
  const transfers = Array.isArray(executed?.canonicalUsdcTransfers) ? executed.canonicalUsdcTransfers : [];
  const matched = transfers.find((entry) => entry.amountAtomic === pin.atomic) || null;
  const chain = {
    blockNumber: String(executed?.transaction?.blockNumber || ""),
    decision: executed?.decision || "unavailable",
    matchedAtomic: matched ? pin.atomic : "0",
    movementRef: pin.movementRef,
    network: executed?.chain?.network || "",
    receiptFound: executed?.receipt?.found === true,
    status: executed?.transaction?.status || "unavailable",
    transactionFeeWei: String(executed?.transaction?.transactionFeeWei || "0"),
  };
  const pinMatch = chain.decision === "found"
    && chain.receiptFound === true
    && chain.status === "success"
    && chain.network === pin.network
    && chain.blockNumber === pin.blockNumber
    && chain.matchedAtomic === pin.atomic
    && lower(executed?.transaction?.hash) === pin.movementRef
    && lower(executed?.request?.transactionHash) === pin.movementRef;
  const evidence = { ...chain, evidenceDigest: digestOf(chain) };
  if (containsAccount(evidence) || hasDisallowedKey(evidence)) fail("restricted_field");
  return {
    ...evidence,
    pinMatch,
    qualification: pinMatch ? "pin_match" : (chain.decision === "found" ? "pin_mismatch" : chain.decision),
  };
}

export function accountingFrom(projection, pin = loadPin()) {
  if (!projection?.pinMatch) return null;
  const accounting = {
    schema: ACCOUNTING_SCHEMA,
    asset: pin.asset,
    blockNumber: projection.blockNumber,
    claim: "closed",
    classification: pin.class,
    expenseAtomic: projection.matchedAtomic,
    movementRef: pin.movementRef,
    paymentPermitted: false,
    recognizedRevenueAtomic: "0",
    secondPay: false,
    transactionFeeWei: projection.transactionFeeWei,
  };
  if (containsAccount(accounting) || hasDisallowedKey(accounting)) fail("restricted_field");
  if (accounting.recognizedRevenueAtomic !== "0" || accounting.secondPay !== false) fail("revenue_claim");
  return accounting;
}

function callsOf(client, fallbackReceipt) {
  if (client?.calls) return { ...client.calls, paid: 0, model: 0 };
  return { receipt: fallbackReceipt, block: fallbackReceipt, paid: 0, model: 0 };
}

export async function executeClosedSettlement({ client, now = () => new Date() } = {}) {
  if (!client || typeof client.getTransactionReceipt !== "function") fail("not_execution");
  const pin = loadPin();
  const started = performance.now();
  const clock = typeof now === "function" ? now : () => now;
  const executed = await transactionReceipt(
    { transactionHash: pin.movementRef, network: "base" },
    { client, now: () => new Date(clock()) },
  );
  const projection = projectExecution(executed, pin);
  return {
    accounting: accountingFrom(projection, pin),
    currentAuthority: false,
    elapsedMs: Math.max(0, Math.round(performance.now() - started)),
    evidenceClass: "server_executed_output",
    executionSaved: false,
    modelCalls: 0,
    paymentPermitted: false,
    projection,
    providerCalls: callsOf(client, 1),
    tokenCost: null,
    usefulTransferred: false,
  };
}

export async function directSolve({ client, now } = {}) {
  const executed = await executeClosedSettlement({ client, now });
  return {
    accounting: executed.accounting,
    continuedExecution: true,
    currentAuthority: false,
    elapsedMs: executed.elapsedMs,
    evidenceClass: executed.projection.pinMatch ? "server_executed_output" : null,
    executionSaved: false,
    knowledgeApplied: false,
    modelCalls: 0,
    paymentPermitted: false,
    projection: publicProjection(executed.projection),
    providerCalls: executed.providerCalls,
    reason: executed.projection.pinMatch ? "direct_solve" : executed.projection.qualification,
    solved: executed.projection.pinMatch === true,
    tokenCost: null,
    usefulTransferred: false,
  };
}

export function publicProjection(projection) {
  if (!projection) return null;
  return {
    blockNumber: projection.blockNumber,
    decision: projection.decision,
    evidenceDigest: projection.evidenceDigest,
    matchedAtomic: projection.matchedAtomic,
    movementRef: projection.movementRef,
    network: projection.network,
    receiptFound: projection.receiptFound,
    status: projection.status,
    transactionFeeWei: projection.transactionFeeWei,
  };
}

export function knowledgeView(row) {
  if (!row || row.schema !== KNOWLEDGE_SCHEMA || row.action === "revoke") return null;
  if (hasDisallowedKey(row)) return null;
  const evidence = publicProjection(row.evidence);
  if (!evidence) return null;
  const view = {
    attribution: "Copyright (c) 2026 SameDayDesk",
    claim: "closed",
    corrects: row.corrects || null,
    currentAuthority: false,
    evidence,
    evidenceClass: "server_executed_output",
    evidenceDigest: evidence.evidenceDigest,
    expiresAt: row.expiresAt,
    implementation: IMPLEMENTATION,
    license: "MIT",
    method: RECEIPT_METHOD,
    movementRef: CLOSED_SPONSORED_REF,
    operationId: RECEIPT_OPERATION,
    outcomeSchema: RECEIPT_SCHEMA_NAME,
    outcomeSchemaVersion: RECEIPT_SCHEMA_VERSION,
    paymentPermitted: false,
    recognizedRevenueAtomic: "0",
    route: RECEIPT_ROUTE,
    schema: KNOWLEDGE_SCHEMA,
    secondPay: false,
    shareId: row.shareId,
    source: KNOWLEDGE_SOURCE,
    sourceSha: row.sourceSha,
  };
  if (containsAccount(view) || hasDisallowedKey(view)) return null;
  if (typeof view.shareId !== "string" || typeof view.sourceSha !== "string" || typeof view.expiresAt !== "string") {
    return null;
  }
  return view;
}

function refused(reason, extra = {}) {
  return {
    accounting: null,
    applied: false,
    applyPrior: false,
    continuedExecution: false,
    currentAuthority: false,
    elapsedMs: extra.elapsedMs || 0,
    evidenceClass: null,
    executionSaved: false,
    knowledgeApplied: false,
    modelCalls: 0,
    observationAccepted: false,
    paymentPermitted: false,
    providerCalls: extra.providerCalls || { receipt: 0, block: 0, paid: 0, model: 0 },
    reason,
    suppliedFlagIgnored: extra.suppliedFlagIgnored === true,
    tokenCost: null,
    usefulTransferred: false,
    ...extra,
    applied: false,
    executionSaved: false,
    knowledgeApplied: extra.knowledgeApplied === true,
    paymentPermitted: false,
    currentAuthority: false,
    usefulTransferred: false,
  };
}

export async function receiveKnowledge({
  derivative,
  client = null,
  method = RECEIPT_METHOD,
  route = RECEIPT_ROUTE,
  outcomeSchema = RECEIPT_SCHEMA_NAME,
  outcomeSchemaVersion = RECEIPT_SCHEMA_VERSION,
  correction = null,
  now = Date.now(),
} = {}) {
  const suppliedFlag = derivative?.useful === true
    || derivative?.usefulDelivery === "true"
    || derivative?.ok === true
    || derivative?.pinMatch === true;
  if (!derivative || typeof derivative !== "object" || derivative.schema !== KNOWLEDGE_SCHEMA) {
    return refused("not_receipt_knowledge", { suppliedFlagIgnored: suppliedFlag });
  }
  if (hasDisallowedKey(derivative) || containsAccount(derivative)) {
    return refused("restricted_field", { suppliedFlagIgnored: suppliedFlag });
  }
  if (method !== derivative.method) return refused("changed_method", { suppliedFlagIgnored: suppliedFlag });
  if (route !== derivative.route) return refused("changed_route", { suppliedFlagIgnored: suppliedFlag });
  if (outcomeSchema !== derivative.outcomeSchema || outcomeSchemaVersion !== derivative.outcomeSchemaVersion) {
    return refused("changed_schema", { suppliedFlagIgnored: suppliedFlag });
  }
  const foreign = derivative.route !== RECEIPT_ROUTE
    || derivative.method !== RECEIPT_METHOD
    || derivative.operationId !== RECEIPT_OPERATION
    || derivative.implementation !== IMPLEMENTATION
    || derivative.outcomeSchema !== RECEIPT_SCHEMA_NAME
    || derivative.outcomeSchemaVersion !== RECEIPT_SCHEMA_VERSION
    || derivative.source !== KNOWLEDGE_SOURCE
    || derivative.evidenceClass !== "server_executed_output";
  if (foreign) return refused("foreign_capability", { suppliedFlagIgnored: suppliedFlag });
  if (correction && correction.corrects === derivative.shareId && correction.schema === KNOWLEDGE_SCHEMA) {
    return refused("corrected", { applyPrior: false, suppliedFlagIgnored: suppliedFlag });
  }
  const expires = Date.parse(derivative.expiresAt || "");
  if (!Number.isFinite(expires) || expires <= now) return refused("expired_scope", { suppliedFlagIgnored: suppliedFlag });
  if (derivative.revoked === true) return refused("revoked", { suppliedFlagIgnored: suppliedFlag });
  if (!client || typeof client.getTransactionReceipt !== "function") {
    return refused("not_execution", { suppliedFlagIgnored: suppliedFlag });
  }
  let executed;
  try {
    executed = await executeClosedSettlement({ client, now: () => new Date(now) });
  } catch (error) {
    return refused(error.code || "not_execution", { suppliedFlagIgnored: suppliedFlag });
  }
  const providerCalls = executed.providerCalls;
  const elapsedMs = executed.elapsedMs;
  if (!executed.projection.pinMatch || !executed.accounting) {
    return refused("pin_mismatch", { providerCalls, elapsedMs, continuedExecution: true, suppliedFlagIgnored: suppliedFlag });
  }
  if (!client.sourceSha || client.sourceSha !== derivative.sourceSha) {
    return refused("source_changed", { providerCalls, elapsedMs, continuedExecution: true, suppliedFlagIgnored: suppliedFlag });
  }
  const evidence = derivative.evidence || {};
  const matches = evidence.evidenceDigest === executed.projection.evidenceDigest
    && evidence.matchedAtomic === executed.projection.matchedAtomic
    && evidence.blockNumber === executed.projection.blockNumber
    && evidence.status === executed.projection.status
    && evidence.transactionFeeWei === executed.projection.transactionFeeWei
    && evidence.decision === executed.projection.decision
    && evidence.receiptFound === true
    && evidence.network === executed.projection.network
    && lower(evidence.movementRef) === executed.projection.movementRef;
  if (!matches) {
    return refused("forged_supplied_success", {
      providerCalls,
      elapsedMs,
      continuedExecution: true,
      suppliedFlagIgnored: true,
    });
  }
  return {
    accounting: executed.accounting,
    adaptationChecks: ["method", "route", "schema", "implementation", "expiry", "correction", "source", "evidence"],
    applied: false,
    applyPrior: derivative.corrects ? false : null,
    continuedExecution: true,
    currentAuthority: false,
    elapsedMs,
    evidenceClass: "independently_replayed_utility",
    executionSaved: false,
    knowledgeApplied: true,
    modelCalls: 0,
    observationAccepted: false,
    paymentPermitted: false,
    providerCalls,
    reason: "independently_replayed",
    suppliedFlagIgnored: suppliedFlag,
    tokenCost: null,
    usefulTransferred: false,
  };
}

export function compareSolves(later, direct) {
  const laterAccounting = JSON.stringify(later?.accounting || null);
  const directAccounting = JSON.stringify(direct?.accounting || null);
  return {
    directElapsedMs: direct?.elapsedMs ?? null,
    directProviderCalls: direct?.providerCalls || null,
    executionSaved: false,
    laterElapsedMs: later?.elapsedMs ?? null,
    laterProviderCalls: later?.providerCalls || null,
    modelCalls: 0,
    observedSaving: false,
    sameAccounting: laterAccounting === directAccounting,
    tokenCost: null,
  };
}

export async function compareCapturedSolve(capture, derivative, now) {
  const directClient = clientFromCapture(capture);
  const laterClient = clientFromCapture(capture);
  const direct = await directSolve({ client: directClient, now });
  const later = await receiveKnowledge({ derivative, client: laterClient, now });
  return { compare: compareSolves(later, direct), direct, later };
}

export function emptyProviderCalls() {
  return { receipt: 0, block: 0, paid: 0, model: 0 };
}

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}
