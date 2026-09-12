import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { normalizeAuthorization } from "../../../../examples/customer-x402/src/authorization.mjs";
import { assertReceiptReadyForReconcile } from "../../../../examples/customer-x402/src/reconcile.mjs";
import { classifyPaidResponse } from "../../../../examples/customer-x402/src/outcome.mjs";
import { LIVE_BATCH_SCHEMA_VERSION } from "../../../../examples/customer-x402/src/constants.mjs";

export const EXPORT_SCHEMA = "samedaydesk.outcome-evidence-export.v2";
export const FEEDBACK_SCHEMA = "samedaydesk.buyer-feedback.v1";
export const MAX_INPUT_BYTES = 1_000_000;

const USEFULNESS = new Set(["useful", "not_useful", "unknown"]);
const ATTRIBUTION = new Set(["attributed", "unattributed", "unknown"]);
const INTENDED_USE = new Set(["evaluation", "production", "benchmark", "other", "undisclosed"]);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REDACTED = new Set(["[redacted]", "[opaque-redacted]", "[payment-header-redacted]"]);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const has = (value, key) => isObject(value) && Object.hasOwn(value, key);
const uint = value => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value);
const numericSame = (a, b) => uint(a) && uint(b) && BigInt(a) === BigInt(b);
const networkKey = value => `eip155:${BigInt(value.slice(7))}`;
const joinedRecords = new WeakMap();

function freezeRecord(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeRecord(child);
    Object.freeze(value);
  }
  return value;
}

function hasRedactedContent(value) {
  const pending = [value];
  const seen = new Set();
  while (pending.length) {
    const child = pending.pop();
    if (typeof child === "string" && [...REDACTED].some(marker => child.includes(marker))) return true;
    if (child && typeof child === "object" && !seen.has(child)) {
      seen.add(child);
      for (const value of Object.values(child)) pending.push(value);
    }
  }
  return false;
}

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

// No content-key blacklist: customer output may legitimately contain a revenue
// field. The export is an allowlist and never copies raw bodies or claim keys.
export function readBoundedJson(path, { maxBytes = MAX_INPUT_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_INPUT_BYTES) fail("invalid byte limit");
  const absolute = resolve(path);
  for (let parent = dirname(absolute); ; parent = dirname(parent)) {
    if (lstatSync(parent).isSymbolicLink()) fail("symlink directories are refused", "path", "unsafe_input");
    if (parent === dirname(parent)) break;
  }
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) fail("input must be a regular file", "path", "unsafe_input");
    if (stat.size > maxBytes) fail("input exceeds byte limit", "path", "oversized_input");
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length <= maxBytes) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (!n) break;
      length += n;
    }
    if (length > maxBytes) fail("input exceeds byte limit", "path", "oversized_input");
    bytes = buffer.subarray(0, length);
  } finally { closeSync(fd); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail("input is not valid JSON", "path", "malformed_json"); }
}

export function validateFeedback(input) {
  const value = object(input, "feedback");
  exactKeys(value, ["schema", "recordedAt", "usefulness", "returnAttribution", "intendedUse", "statement", "evidenceId"], "feedback");
  if (value.schema !== FEEDBACK_SCHEMA) fail(`feedback.schema must be ${FEEDBACK_SCHEMA}`, "feedback.schema");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.recordedAt) || !Number.isFinite(Date.parse(value.recordedAt))) {
    fail("feedback.recordedAt must be an ISO-8601 UTC timestamp", "feedback.recordedAt");
  }
  if (!USEFULNESS.has(value.usefulness)) fail("feedback.usefulness is unsupported", "feedback.usefulness");
  if (!ATTRIBUTION.has(value.returnAttribution)) fail("feedback.returnAttribution is unsupported", "feedback.returnAttribution");
  if (!INTENDED_USE.has(value.intendedUse)) fail("feedback.intendedUse is unsupported", "feedback.intendedUse");
  if (typeof value.statement !== "string" || value.statement.length > 1_000) fail("feedback.statement must be a string of at most 1000 characters", "feedback.statement");
  if (has(value, "evidenceId") && !DIGEST.test(value.evidenceId)) fail("feedback.evidenceId is invalid", "feedback.evidenceId");
  if (new Date(value.recordedAt).toISOString().slice(0, 19) !== value.recordedAt.slice(0, 19)) fail("feedback timestamp is invalid", "feedback.recordedAt");
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
    if (typeof entry.label !== "string" || !entry.label || entry.label.length > 200) fail("catalog label is required", `catalog.entries[${index}].label`);
    if (!["GET", "POST"].includes(entry.method)) fail("catalog method is invalid", `catalog.entries[${index}].method`);
    const request = { method: entry.method, url: entry.url, bodyDigest: entry.bodyDigest ?? null };
    if (typeof request.url !== "string" || request.url.length > 2048) fail("catalog URL is invalid");
    let url;
    try { url = new URL(request.url); } catch { fail("catalog URL is invalid"); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) fail("catalog URL is invalid");
    if (request.method === "POST" ? !DIGEST.test(request.bodyDigest) : request.bodyDigest !== null) fail("catalog body digest is invalid");
    return { ...entry, ...request, url: url.toString() };
  });
}

function receiptBinding(receipt) {
  return {
    network: networkKey(receipt.network), asset: receipt.asset.toLowerCase(), payer: receipt.payer.toLowerCase(),
    payee: receipt.payee.toLowerCase(), amountAtomic: BigInt(receipt.amountAtomic).toString(),
    nonce: receipt.nonce.toLowerCase(), paymentIdentifier: receipt.paymentIdentifier,
    validAfter: receipt.validAfter, validBefore: receipt.validBefore,
    assetName: receipt.assetName, assetVersion: receipt.assetVersion, request: receipt.request,
  };
}

function bindingConflicts(receipt, authorization, purchase, reconcile) {
  const conflicts = [];
  const check = (condition, field) => { if (!condition) conflicts.push(field); };
  for (const key of ["method", "url", "bodyDigest"]) check(receipt.request[key] === authorization[key], `request.${key}`);
  check(receipt.network === authorization.network, "network");
  check(same(receipt.asset, authorization.asset), "asset");
  check(same(receipt.payee, authorization.recipient), "payee");
  check(receipt.assetName === authorization.assetName, "assetName");
  check(receipt.assetVersion === authorization.assetVersion, "assetVersion");
  check(BigInt(receipt.amountAtomic) > 0n && BigInt(receipt.amountAtomic) <= BigInt(authorization.amountCapAtomic), "amountAtomic");
  check(receipt.stage === "paid_response_observed", "receipt.stage");
  check(purchase.paymentSent === true, "purchase.paymentSent");
  check(purchase.attemptReceiptWritten === true, "purchase.attemptReceiptWritten");
  const evidence = isObject(purchase.evidence) ? purchase.evidence : {};
  for (const [key, value] of Object.entries({ bodyDigest: receipt.request.bodyDigest, selectedNetwork: receipt.network,
    selectedAsset: receipt.asset, selectedRecipient: receipt.payee })) {
    check(key === "selectedAsset" || key === "selectedRecipient" ? same(evidence[key], value) : evidence[key] === value, `purchase.evidence.${key}`);
  }
  check(numericSame(evidence.authorizedAmountCapAtomic, authorization.amountCapAtomic), "purchase.evidence.authorizedAmountCapAtomic");
  // The current producer persists the selected authorization in matched, not
  // in evidence.selectedAmountAtomic. Do not invent another purchase schema.
  if (isObject(purchase.matched)) {
    for (const key of ["method", "url", "network", "assetName", "assetVersion", "bodyDigest", "maxTimeoutSeconds"]) {
      check(purchase.matched[key] === authorization[key], `purchase.matched.${key}`);
    }
    for (const key of ["asset", "recipient"]) check(same(purchase.matched[key], authorization[key]), `purchase.matched.${key}`);
    check(numericSame(purchase.matched.amountCapAtomic, authorization.amountCapAtomic), "purchase.matched.amountCapAtomic");
    check(numericSame(purchase.matched.selectedAmountAtomic, receipt.amountAtomic), "purchase.matched.selectedAmountAtomic");
    check(stable(purchase.matched.requiredOutput) === stable(authorization.requiredOutput), "purchase.matched.requiredOutput");
    // bodyRaw and body are private and can be redacted by the producer. Their
    // digest is the persisted join key; revalidation uses the original auth.
  } else check(false, "purchase.matched");
  if (reconcile != null) {
    check(isObject(reconcile) && reconcile.schema === "samedaydesk.customer-x402.attempt-reconcile.v1", "reconcile.schema");
    const joined = reconcile.receipt;
    check(isObject(joined) && stable(joined.request) === stable(receipt.request), "reconcile.receipt.request");
    for (const key of ["schema", "network", "paymentIdentifier"]) check(joined?.[key] === receipt[key], `reconcile.receipt.${key}`);
    for (const key of ["asset", "payer", "payee", "nonce"]) check(same(joined?.[key], receipt[key]), `reconcile.receipt.${key}`);
    for (const key of ["amountAtomic", "validAfter", "validBefore"]) check(numericSame(joined?.[key], receipt[key]), `reconcile.receipt.${key}`);
  }
  return conflicts;
}

function validateServerOutput(authorization, purchase, conflicts) {
  const evidence = isObject(purchase.evidence) ? purchase.evidence : {};
  const validator = "customer-x402.classifyPaidResponse";
  const unknown = reason => ({ validated: false, delivery: "unknown", reason, report: null, validator,
    scope: "retained_body_revalidation", originalWireVerified: false,
    redactionPresent: hasRedactedContent(evidence.retainedBody) });
  if (!has(evidence, "retainedBody") || evidence.retainedBody === null || REDACTED.has(evidence.retainedBody)) {
    return unknown("retained_body_unavailable");
  }
  // The real serializer redacts diagnostic boundary keys containing
  // "authorization". Check buyer-requested content separately from metadata.
  // Metadata redaction remains visible without inventing original wire proof.
  const buyerValues = authorization.batch
    ? evidence.retainedBody?.sources?.map?.(row => authorization.batch.fields.map(field => row?.data?.[field]))
    : authorization.requiredOutput.requiredFields.map(path => path.split(".").reduce((value, key) => value?.[key], evidence.retainedBody));
  if (hasRedactedContent(buyerValues)) return unknown("buyer_fields_redacted");
  if (authorization.batch && has(evidence.retainedBody, "schemaVersion") && evidence.retainedBody.schemaVersion !== LIVE_BATCH_SCHEMA_VERSION) {
    return unknown("unsupported_historical_output_schema");
  }
  if (authorization.method === "GET") {
    // requestedUrl is the original source identity. finalUrl/url may change
    // after a legitimate redirect, so they are not substitute join keys.
    if (!has(evidence.retainedBody, "requestedUrl") || REDACTED.has(evidence.retainedBody.requestedUrl)) return unknown("source_identity_unavailable");
    const target = new URL(authorization.url).searchParams.get("url");
    let sourceMatches = false;
    try { sourceMatches = new URL(evidence.retainedBody.requestedUrl).href === new URL(target).href; } catch { /* conflicting source */ }
    if (!sourceMatches) conflicts.push("purchase.evidence.retainedBody.requestedUrl");
  }
  if (!Number.isInteger(evidence.httpStatus) || evidence.httpStatus < 200 || evidence.httpStatus > 599) return unknown("http_status_unavailable");
  // Reuse the owning classifier, including partial GET source refusals and
  // transport/settlement precedence. Media type wasn't saved: this checks the
  // retained JSON only, and does not claim original wire Content-Type proof.
  const headers = { "content-type": authorization.requiredOutput.mediaType };
  if (evidence.settlementPresent === true && typeof evidence.settlementSuccess === "boolean") {
    headers["PAYMENT-RESPONSE"] = Buffer.from(JSON.stringify({ success: evidence.settlementSuccess })).toString("base64");
  }
  const classified = classifyPaidResponse({ response: new Response(null, { status: evidence.httpStatus, headers }),
    body: evidence.retainedBody, requiredOutput: authorization.requiredOutput, authorization });
  const output = classified.evidence;
  if (purchase.outcome !== classified.outcome) conflicts.push("purchase.outcome");
  if (evidence.outputValid !== output.outputValid) conflicts.push("purchase.evidence.outputValid");
  if (evidence.outputDelivery !== output.outputDelivery) conflicts.push("purchase.evidence.outputDelivery");
  const valid = output.outputValid === true && purchase.outcome === classified.outcome &&
    evidence.outputValid === output.outputValid && evidence.outputDelivery === output.outputDelivery &&
    evidence.httpStatus >= 200 && evidence.httpStatus < 300 && evidence.settlementSuccess !== false;
  const report = authorization.batch && isObject(output.outputReport) ? Object.fromEntries(
    ["usefulRows", "failedOrPartialRows", "rowCount"].filter(key => Number.isSafeInteger(output.outputReport[key])).map(key => [key, output.outputReport[key]])) : null;
  return { validated: valid, delivery: output.outputDelivery ?? "invalid",
    reason: valid ? null : "retained_output_or_outcome_inconsistent", report, validator,
    scope: "retained_body_revalidation", originalWireVerified: false,
    redactionPresent: hasRedactedContent(evidence.retainedBody) };
}

function settlementEvidence(receipt, purchase, reconcile, conflicts) {
  const evidence = isObject(purchase.evidence) ? purchase.evidence : {};
  const rawTx = evidence.settlementTransaction;
  const observedTx = HASH.test(rawTx) ? rawTx.toLowerCase() : null;
  const check = (condition, field) => { if (!condition) conflicts.push(field); };
  const start = conflicts.length;
  if (rawTx != null && !REDACTED.has(rawTx) && !observedTx) check(false, "purchase.evidence.settlementTransaction");
  if (has(evidence, "settlementPresent") && typeof evidence.settlementPresent !== "boolean") check(false, "purchase.evidence.settlementPresent");
  if (evidence.settlementSuccess != null && typeof evidence.settlementSuccess !== "boolean") check(false, "purchase.evidence.settlementSuccess");
  if (evidence.settlementPresent === false && (evidence.settlementSuccess != null || rawTx != null)) check(false, "purchase.evidence.settlementPresent");
  const settlement = reconcile?.settlement;
  const requestedExact = settlement?.matched === true || settlement?.status === "exact_transfer_matched";
  if (!requestedExact && /^used_settlement_/.test(reconcile?.decision)) check(false, "reconcile.decision");
  if (requestedExact && evidence.settlementSuccess === false) check(false, "settlement.httpHeaderSuccess");
  if (requestedExact) {
    check(settlement.matched === true && settlement.status === "exact_transfer_matched", "reconcile.settlement.status");
    check(reconcile.authorization?.used === true && reconcile.authorization?.state === "used", "reconcile.authorization");
    check(HASH.test(settlement.transactionHash), "reconcile.settlement.transactionHash");
    check(uint(settlement.blockNumber) && HASH.test(settlement.blockHash), "reconcile.settlement.block");
    check(same(settlement.transfer?.from, receipt.payer), "reconcile.settlement.transfer.from");
    check(same(settlement.transfer?.to, receipt.payee), "reconcile.settlement.transfer.to");
    check(numericSame(settlement.transfer?.value, receipt.amountAtomic), "reconcile.settlement.transfer.value");
    const f = reconcile.finality;
    check(isObject(f) && f.hashMatched === true && HASH.test(f.observedBlockHash) && HASH.test(f.canonicalBlockHash) &&
      same(f.observedBlockHash, settlement.blockHash) && same(f.canonicalBlockHash, settlement.blockHash) &&
      numericSame(f.observedBlock, settlement.blockNumber), "reconcile.finality.canonicalBlock");
    if (isObject(f) && uint(f.headBlock) && uint(settlement.blockNumber) && uint(f.confirmations) &&
        uint(f.confirmationDepthRequired) && BigInt(f.confirmationDepthRequired) > 0n) {
      const block = BigInt(settlement.blockNumber), head = BigInt(f.headBlock);
      check(head >= block && BigInt(f.confirmations) === head - block, "reconcile.finality.confirmations");
      check(typeof f.confirmed === "boolean" && f.confirmed === (head - block >= BigInt(f.confirmationDepthRequired)), "reconcile.finality.confirmed");
      for (const [tag, height] of [["safe", "safeBlock"], ["finalized", "finalizedBlock"]]) {
        check(f[height] === null ? f[tag] === null : uint(f[height]) && BigInt(f[height]) <= head &&
          typeof f[tag] === "boolean" && f[tag] === (block <= BigInt(f[height])), `reconcile.finality.${tag}`);
      }
      const expected = f.finalized === true ? "used_settlement_finalized" : f.confirmed === true ? "used_settlement_confirmed" : "used_settlement_matched_unfinalized";
      check(reconcile.decision === expected, "reconcile.decision");
    } else check(false, "reconcile.finality");
    check(uint(reconcile.authorization?.observedBlockNumber) && uint(settlement.blockNumber) &&
      BigInt(reconcile.authorization.observedBlockNumber) >= BigInt(settlement.blockNumber) &&
      HASH.test(reconcile.authorization?.observedBlockHash), "reconcile.authorization.observedBlock");
    check(reconcile.observedBlock?.number === reconcile.authorization?.observedBlockNumber &&
      same(reconcile.observedBlock?.hash, reconcile.authorization?.observedBlockHash), "reconcile.observedBlock");
    const used = settlement.authorizationUsedLogs;
    const canceled = settlement.authorizationCanceledLogs;
    check(used?.found === true && used.error === null && Array.isArray(used.matches) && used.matches.length === 1,
      "reconcile.settlement.authorizationUsedLogs");
    const log = Array.isArray(used?.matches) && used.matches.length === 1 ? used.matches[0] : null;
    check(log?.removed === false && uint(log.logIndex) && HASH.test(log.transactionHash) &&
      same(log.transactionHash, settlement.transactionHash) && same(log.blockHash, settlement.blockHash) &&
      numericSame(log.blockNumber, settlement.blockNumber), "reconcile.settlement.authorizationUsedLogs.match");
    check(canceled?.found === false && canceled.error === null && Array.isArray(canceled.matches) && canceled.matches.length === 0,
      "reconcile.settlement.authorizationCanceledLogs");
  }
  const reconciledTx = requestedExact && HASH.test(settlement?.transactionHash) ? settlement.transactionHash.toLowerCase() : null;
  const transactionConflict = Boolean(observedTx && reconciledTx && observedTx !== reconciledTx);
  if (transactionConflict) conflicts.push("settlement.transactionHash");
  const exact = requestedExact && !conflicts.some(field => field.startsWith("reconcile.") || field === "settlement.transactionHash");
  const bad = conflicts.length > start || conflicts.some(field => field.startsWith("reconcile."));
  return {
    status: bad ? "conflicting_receipt" : exact ? "exact_transfer_matched" : "unverified",
    exactMatched: exact,
    authority: "caller_saved_reconciliation",
    chainVerifiedByAdapter: false,
    transactionHash: bad ? null : (reconciledTx || observedTx),
    httpTransaction: observedTx ? "observed" : rawTx == null ? "absent" : REDACTED.has(rawTx) ? "redacted" : "invalid",
    httpHeaderPresent: evidence.settlementPresent === true,
    httpHeaderSuccess: typeof evidence.settlementSuccess === "boolean" ? evidence.settlementSuccess : null,
    finality: exact ? { confirmed: reconcile.finality.confirmed, finalized: reconcile.finality.finalized } : null,
    key: sha256(`${networkKey(receipt.network)}|${receipt.asset.toLowerCase()}|${receipt.payer.toLowerCase()}|${receipt.nonce.toLowerCase()}`),
    transactionKey: reconciledTx ? sha256(`${networkKey(receipt.network)}|${reconciledTx}`) : null,
  };
}

function catalogMatch(receipt, entries) {
  return entries.find(entry => entry.method === receipt.request.method && entry.url === receipt.request.url &&
    (entry.bodyDigest ?? null) === receipt.request.bodyDigest) ?? null;
}

export function joinOutcomeEvidence({ receipt: rawReceipt, authorization: rawAuthorization, purchase, reconcile = null,
  feedback: rawFeedback = null, catalog = null, sourceLabel = "local-run" } = {}) {
  const receipt = assertReceiptReadyForReconcile(rawReceipt);
  const authorization = normalizeAuthorization(rawAuthorization);
  object(purchase, "purchase");
  const feedback = rawFeedback == null ? null : validateFeedback(rawFeedback);
  const conflicts = bindingConflicts(receipt, authorization, purchase, reconcile);
  const serverContract = validateServerOutput(authorization, purchase, conflicts);
  const settlement = settlementEvidence(receipt, purchase, reconcile, conflicts);
  const example = catalogMatch(receipt, validateCatalog(catalog));
  const evidenceId = sha256(stable(receiptBinding(receipt)));
  const feedbackBinding = !feedback ? "absent" : !feedback.evidenceId ? "unbound" : feedback.evidenceId === evidenceId ? "matched" : "conflicting";
  const { key, transactionKey, ...portableSettlement } = settlement;
  const record = {
    evidenceId,
    sourceLabelDigest: sha256(String(sourceLabel)),
    authority: "local_files_unverified",
    receiptConsistency: conflicts.length === 0 ? "consistent" : "conflicting_receipt",
    conflicts: [...new Set(conflicts)],
    request: { method: receipt.request.method, urlDigest: sha256(receipt.request.url), bodyDigest: receipt.request.bodyDigest },
    payment: {
      network: networkKey(receipt.network), asset: receipt.asset, payee: receipt.payee, amountAtomic: receipt.amountAtomic,
    },
    serverContract,
    buyerAttestation: {
      attested: feedback !== null, authority: "caller", authenticated: false, binding: feedbackBinding,
      recordedAt: feedback?.recordedAt ?? null, usefulness: feedback?.usefulness ?? "unknown",
      returnAttribution: feedback?.returnAttribution ?? "unknown", intendedUse: feedback?.intendedUse ?? "undisclosed",
      statementDigest: feedback ? sha256(feedback.statement) : null,
    },
    exampleReuse: { reused: example ? true : catalog == null ? null : false,
      labelDigest: example ? sha256(example.label) : null, authority: "caller_catalog" },
    settlement: portableSettlement,
    duplicateSettlement: false,
    // Eligibility means only locally consistent saved evidence. Feedback never
    // promotes it to authenticated demand, independent use, or revenue.
    eligibleEvidence: conflicts.length === 0 && serverContract.validated && settlement.exactMatched,
  };
  joinedRecords.set(record, { key, transactionKey });
  return freezeRecord(record);
}

export function compilePortableEvidence(runs, { generatedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(runs) || runs.length === 0 || runs.length > 100) fail("one to 100 runs are required", "runs");
  const identities = new Map();
  for (const run of runs) {
    if (!joinedRecords.has(run)) fail("compile requires immutable joined records", "runs");
    const { key, transactionKey } = joinedRecords.get(run);
    const group = identities.get(key) ?? { evidenceIds: new Set(), transactions: new Set() };
    group.evidenceIds.add(run.evidenceId);
    if (transactionKey) group.transactions.add(transactionKey);
    identities.set(key, group);
  }
  const seen = new Set();
  const records = runs.map(run => {
    const { key, transactionKey } = joinedRecords.get(run);
    const group = identities.get(key);
    const conflictingIdentity = group.evidenceIds.size > 1 || group.transactions.size > 1;
    const eligible = run.eligibleEvidence && !conflictingIdentity;
    const keys = [key, transactionKey].filter(Boolean);
    // Invalid records cannot consume the only eligible slot for a later good
    // record. Deduplicate both EIP-3009 identity and chain-scoped transaction.
    const duplicate = eligible && keys.some(value => seen.has(value));
    if (eligible) for (const value of keys) seen.add(value);
    return { ...run,
      receiptConsistency: conflictingIdentity ? "conflicting_receipt" : run.receiptConsistency,
      conflicts: conflictingIdentity ? [...run.conflicts, "cross_run.authorization_identity"] : [...run.conflicts],
      duplicateSettlement: duplicate, eligibleEvidence: eligible && !duplicate };
  });
  const counts = records.reduce((out, record) => {
    out.total += 1;
    if (record.eligibleEvidence) out.eligible += 1;
    if (record.duplicateSettlement) out.duplicateSettlement += 1;
    if (record.receiptConsistency === "conflicting_receipt") out.conflictingReceipt += 1;
    if (record.exampleReuse.reused === true) out.reusedExample += 1;
    if (record.buyerAttestation.binding === "matched") out.boundCallerAttestations += 1;
    if (record.buyerAttestation.binding === "unbound") out.unboundCallerAttestations += 1;
    if (record.buyerAttestation.binding === "conflicting") out.conflictingCallerAttestations += 1;
    if (record.buyerAttestation.attested) out.callerAttestedUsefulness[record.buyerAttestation.usefulness] += 1;
    return out;
  }, { total: 0, eligible: 0, duplicateSettlement: 0, conflictingReceipt: 0, reusedExample: 0,
    boundCallerAttestations: 0, unboundCallerAttestations: 0, conflictingCallerAttestations: 0,
    callerAttestedUsefulness: { useful: 0, not_useful: 0, unknown: 0 } });
  return {
    schema: EXPORT_SCHEMA, generatedAt: new Date(generatedAt).toISOString(), summary: counts, records,
    claims: {
      revenue: false, organicUse: false, independentUse: false, customerIdentity: false, roi: false,
      note: "Local file consistency only. Unsigned saved artifacts and caller feedback do not authenticate payment, original output, a customer, or independent use. Fixture and owner QA can satisfy these checks. No RPC is performed.",
    },
  };
}

export function readRunDirectory(directory, { catalog = null } = {}) {
  const read = name => readBoundedJson(resolve(directory, name));
  const optional = name => {
    try { return read(name); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  };
  return joinOutcomeEvidence({ receipt: read("receipt.json"), authorization: read("authorization.json"),
    purchase: read("purchase-result.json"), feedback: optional("feedback.json"), reconcile: optional("reconcile.json"),
    catalog, sourceLabel: basename(resolve(directory)) });
}
