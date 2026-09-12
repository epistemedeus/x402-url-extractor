import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { normalizeAuthorization } from "../../../../examples/customer-x402/src/authorization.mjs";
import { validateAttemptReceipt } from "../../../../examples/customer-x402/src/attempt-receipt.mjs";
import { validateBatchBuyerOutput } from "../../../../examples/customer-x402/src/batch-output.mjs";
import { validateBuyerOutput } from "../../../../examples/customer-x402/src/output.mjs";

export const EXPORT_SCHEMA = "samedaydesk.outcome-evidence-export.v1";
export const FEEDBACK_SCHEMA = "samedaydesk.buyer-feedback.v1";
export const MAX_INPUT_BYTES = 1_000_000;

const OUTCOME_DELIVERY = Object.freeze({
  useful_delivered: "useful",
  valid_delivered: "useful",
  partial_delivered: "partial",
  paid_invalid_output: "invalid",
});
const USEFULNESS = new Set(["useful", "not_useful", "unknown"]);
const ATTRIBUTION = new Set(["attributed", "unattributed", "unknown"]);
const INTENDED_USE = new Set(["evaluation", "production", "benchmark", "other", "undisclosed"]);
const FORBIDDEN_CLAIMS = /^(?:revenue|roi|returnOnInvestment|organicUse|customerIdentity|customerName)$/i;

export class EvidenceError extends Error {
  constructor(message, { code = "invalid_evidence", field = null } = {}) {
    super(message);
    this.name = "EvidenceError";
    this.code = code;
    this.field = field;
  }
}

function fail(message, field = null, code = "invalid_evidence") {
  throw new EvidenceError(message, { field, code });
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`, field);
  return value;
}

function exactKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${field}.${key} is not supported`, `${field}.${key}`);
  }
}

function same(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function findForbiddenClaim(value, path = "input") {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_CLAIMS.test(key)) return `${path}.${key}`;
    const nested = findForbiddenClaim(child, `${path}.${key}`);
    if (nested) return nested;
  }
  return null;
}

export function readBoundedJson(path, { maxBytes = MAX_INPUT_BYTES } = {}) {
  const absolute = resolve(path);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("input must be a regular non-symlink file", "path", "unsafe_input");
  if (stat.size > maxBytes) fail("input exceeds byte limit", "path", "oversized_input");
  let value;
  try { value = JSON.parse(readFileSync(absolute, "utf8")); }
  catch { fail("input is not valid JSON", "path", "malformed_json"); }
  const forbidden = findForbiddenClaim(value);
  if (forbidden) fail(`unsupported inferred claim field: ${forbidden}`, forbidden, "unsupported_claim");
  return value;
}

export function validateFeedback(input) {
  const value = object(input, "feedback");
  exactKeys(value, ["schema", "recordedAt", "usefulness", "returnAttribution", "intendedUse", "statement"], "feedback");
  if (value.schema !== FEEDBACK_SCHEMA) fail(`feedback.schema must be ${FEEDBACK_SCHEMA}`, "feedback.schema");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.recordedAt) || !Number.isFinite(Date.parse(value.recordedAt))) {
    fail("feedback.recordedAt must be an ISO-8601 UTC timestamp", "feedback.recordedAt");
  }
  if (!USEFULNESS.has(value.usefulness)) fail("feedback.usefulness is unsupported", "feedback.usefulness");
  if (!ATTRIBUTION.has(value.returnAttribution)) fail("feedback.returnAttribution is unsupported", "feedback.returnAttribution");
  if (!INTENDED_USE.has(value.intendedUse)) fail("feedback.intendedUse is unsupported", "feedback.intendedUse");
  if (typeof value.statement !== "string" || value.statement.length > 1_000) fail("feedback.statement must be a string of at most 1000 characters", "feedback.statement");
  return Object.freeze({ ...value, recordedAt: new Date(value.recordedAt).toISOString() });
}

function validateCatalog(input) {
  if (input == null) return [];
  const value = object(input, "catalog");
  exactKeys(value, ["schema", "entries"], "catalog");
  if (value.schema !== "samedaydesk.published-request-catalog.v1" || !Array.isArray(value.entries)) {
    fail("catalog schema or entries are invalid", "catalog");
  }
  return value.entries.map((entry, index) => {
    object(entry, `catalog.entries[${index}]`);
    exactKeys(entry, ["label", "method", "url", "bodyDigest"], `catalog.entries[${index}]`);
    if (typeof entry.label !== "string" || !entry.label) fail("catalog label is required", `catalog.entries[${index}].label`);
    if (!["GET", "POST"].includes(entry.method)) fail("catalog method is invalid", `catalog.entries[${index}].method`);
    return entry;
  });
}

function receiptBinding(receipt) {
  return {
    network: receipt.network, asset: receipt.asset, payer: receipt.payer, payee: receipt.payee,
    amountAtomic: receipt.amountAtomic, nonce: receipt.nonce, paymentIdentifier: receipt.paymentIdentifier,
    request: receipt.request,
  };
}

function bindingConflicts(receipt, authorization, purchase, reconcile) {
  const conflicts = [];
  const check = (condition, field) => { if (!condition) conflicts.push(field); };
  check(receipt.request.method === authorization.method, "request.method");
  check(receipt.request.url === authorization.url, "request.url");
  check(receipt.request.bodyDigest === authorization.bodyDigest, "request.bodyDigest");
  check(receipt.network === authorization.network, "network");
  check(same(receipt.asset, authorization.asset), "asset");
  check(same(receipt.payee, authorization.recipient), "payee");
  check(BigInt(receipt.amountAtomic) <= BigInt(authorization.amountCapAtomic), "amountAtomic");
  check(receipt.stage === "paid_response_observed", "receipt.stage");
  check(purchase.paymentSent === true, "purchase.paymentSent");
  check(purchase.attemptReceiptWritten === true, "purchase.attemptReceiptWritten");
  const evidence = object(purchase.evidence, "purchase.evidence");
  check(evidence.bodyDigest === receipt.request.bodyDigest, "purchase.evidence.bodyDigest");
  check(evidence.selectedNetwork === receipt.network, "purchase.evidence.selectedNetwork");
  check(same(evidence.selectedAsset, receipt.asset), "purchase.evidence.selectedAsset");
  check(same(evidence.selectedRecipient, receipt.payee), "purchase.evidence.selectedRecipient");
  if (reconcile != null) {
    if (reconcile.schema !== "samedaydesk.customer-x402.attempt-reconcile.v1") conflicts.push("reconcile.schema");
    const joined = reconcile.receipt;
    if (!joined || stable(joined.request) !== stable(receipt.request)) conflicts.push("reconcile.receipt.request");
    for (const key of ["network", "asset", "payer", "payee", "amountAtomic", "nonce", "paymentIdentifier"]) {
      if (!joined || !same(joined[key], receipt[key])) conflicts.push(`reconcile.receipt.${key}`);
    }
  }
  return conflicts;
}

function validateServerOutput(authorization, purchase) {
  const evidence = object(purchase.evidence, "purchase.evidence");
  const validation = authorization.batch
    ? validateBatchBuyerOutput(evidence.retainedBody, authorization)
    : validateBuyerOutput(evidence.retainedBody, authorization.requiredOutput);
  const claimed = OUTCOME_DELIVERY[purchase.outcome] ?? null;
  const actual = validation.delivery || (validation.valid ? "useful" : "invalid");
  const claimConsistent = claimed === actual;
  return {
    validated: validation.valid === true && claimConsistent,
    delivery: actual,
    reason: claimConsistent ? (validation.reason ?? null) : `purchase outcome ${purchase.outcome} conflicts with validator delivery ${actual}`,
    report: validation.report ?? null,
    validator: authorization.batch ? "customer-x402.validateBatchBuyerOutput" : "customer-x402.validateBuyerOutput",
  };
}

function settlementEvidence(receipt, purchase, reconcile) {
  const observedTx = purchase.evidence?.settlementTransaction ?? null;
  const exact = reconcile?.settlement?.matched === true && reconcile.settlement.status === "exact_transfer_matched";
  const reconciledTx = exact ? reconcile.settlement.transactionHash : null;
  const transactionConflict = Boolean(observedTx && reconciledTx && !same(observedTx, reconciledTx));
  return {
    status: transactionConflict ? "conflicting_receipt" : exact ? "exact_transfer_matched" : "unverified",
    exactMatched: exact && !transactionConflict,
    transactionHash: transactionConflict ? null : (reconciledTx || observedTx),
    httpHeaderPresent: purchase.evidence?.settlementPresent === true,
    httpHeaderSuccess: purchase.evidence?.settlementSuccess ?? null,
    finality: exact && !transactionConflict ? {
      confirmed: reconcile.finality?.confirmed ?? null,
      finalized: reconcile.finality?.finalized ?? null,
    } : null,
    key: `${receipt.network}|${receipt.asset.toLowerCase()}|${receipt.payer.toLowerCase()}|${receipt.nonce.toLowerCase()}`,
  };
}

function catalogMatch(receipt, entries) {
  return entries.find(entry => entry.method === receipt.request.method && entry.url === receipt.request.url &&
    (entry.bodyDigest ?? null) === receipt.request.bodyDigest) ?? null;
}

export function joinOutcomeEvidence({ receipt: rawReceipt, authorization: rawAuthorization, purchase, reconcile = null,
  feedback: rawFeedback, catalog = null, sourceLabel = "local-run" } = {}) {
  const receipt = validateAttemptReceipt(rawReceipt);
  const authorization = normalizeAuthorization(rawAuthorization);
  object(purchase, "purchase");
  const feedback = validateFeedback(rawFeedback);
  const conflicts = bindingConflicts(receipt, authorization, purchase, reconcile);
  const serverContract = validateServerOutput(authorization, purchase);
  const settlement = settlementEvidence(receipt, purchase, reconcile);
  if (settlement.status === "conflicting_receipt") conflicts.push("settlement.transactionHash");
  const example = catalogMatch(receipt, validateCatalog(catalog));
  const receiptConsistency = conflicts.length === 0 ? "consistent" : "conflicting_receipt";
  const evidenceId = sha256(stable(receiptBinding(receipt)));
  return {
    evidenceId,
    sourceLabel,
    receiptConsistency,
    conflicts,
    request: { ...receipt.request },
    payment: {
      network: receipt.network,
      asset: receipt.asset,
      payee: receipt.payee,
      amountAtomic: receipt.amountAtomic,
    },
    serverContract,
    buyerAttestation: {
      attested: true,
      authority: "caller",
      recordedAt: feedback.recordedAt,
      usefulness: feedback.usefulness,
      returnAttribution: feedback.returnAttribution,
      intendedUse: feedback.intendedUse,
      statement: feedback.statement,
    },
    exampleReuse: example ? { reused: true, label: example.label } : { reused: false, label: null },
    settlement,
    duplicateSettlement: false,
    eligibleEvidence: conflicts.length === 0 && serverContract.validated && settlement.exactMatched,
  };
}

export function compilePortableEvidence(runs, { generatedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(runs) || runs.length === 0) fail("at least one run is required", "runs");
  const seen = new Set();
  const records = runs.map(run => {
    const duplicate = run.settlement.exactMatched && seen.has(run.settlement.key);
    if (run.settlement.exactMatched) seen.add(run.settlement.key);
    const { key, ...portableSettlement } = run.settlement;
    return {
      ...run,
      settlement: portableSettlement,
      duplicateSettlement: duplicate,
      eligibleEvidence: run.eligibleEvidence && !duplicate,
    };
  });
  const counts = records.reduce((out, record) => {
    out.total += 1;
    if (record.eligibleEvidence) out.eligible += 1;
    if (record.duplicateSettlement) out.duplicateSettlement += 1;
    if (record.receiptConsistency === "conflicting_receipt") out.conflictingReceipt += 1;
    if (record.exampleReuse.reused) out.reusedExample += 1;
    if (record.buyerAttestation.returnAttribution === "unattributed") out.unattributedReturn += 1;
    out.usefulness[record.buyerAttestation.usefulness] += 1;
    return out;
  }, { total: 0, eligible: 0, duplicateSettlement: 0, conflictingReceipt: 0, reusedExample: 0,
    unattributedReturn: 0, usefulness: { useful: 0, not_useful: 0, unknown: 0 } });
  return {
    schema: EXPORT_SCHEMA,
    generatedAt: new Date(generatedAt).toISOString(),
    summary: counts,
    records,
    claims: {
      revenue: false,
      organicUse: false,
      customerIdentity: false,
      roi: false,
      note: "Settlement, contract validation, buyer usefulness, attribution, example reuse, and deduplication are independent evidence dimensions.",
    },
  };
}

export function readRunDirectory(directory, { catalog = null } = {}) {
  const read = name => readBoundedJson(resolve(directory, name));
  let reconcile = null;
  try { reconcile = read("reconcile.json"); }
  catch (error) {
    if (!(error instanceof Error) || error.code !== "ENOENT") throw error;
  }
  return joinOutcomeEvidence({
    receipt: read("receipt.json"),
    authorization: read("authorization.json"),
    purchase: read("purchase-result.json"),
    feedback: read("feedback.json"),
    reconcile,
    catalog,
    sourceLabel: basename(resolve(directory)),
  });
}
