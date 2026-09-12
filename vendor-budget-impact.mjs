import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PAYMENT_IDENTIFIER, declarePaymentIdentifierExtension } from "@x402/extensions/payment-identifier";

import { BAZAAR_SERVICE_ICON_URL } from "./bazaar-resource-metadata.mjs";
import { declareDiscoveryContract } from "./discovery-contract.mjs";
import { hasMppPaymentAuthorizationForPreflight } from "./mpp-dual-stack.mjs";
import { comparePricingTables } from "./vendor/vendor-budget-impact/lib/compare.mjs";
import { buildImpact, looksLikeHtml, toMarkdown } from "./vendor/vendor-budget-impact/lib/impact.mjs";
import {
  DEFAULT_VENDOR_BUDGET_IMPACT_PRICE_USD,
  VENDOR_BUDGET_IMPACT_AMOUNT_ATOMIC,
  VENDOR_BUDGET_IMPACT_ARCHIVE_SHA256,
  VENDOR_BUDGET_IMPACT_CATALOG_SHA,
  VENDOR_BUDGET_IMPACT_DESCRIPTION,
  VENDOR_BUDGET_IMPACT_ENGINE_PATH,
  VENDOR_BUDGET_IMPACT_ENGINE_REPO,
  VENDOR_BUDGET_IMPACT_ENGINE_SCHEMA,
  VENDOR_BUDGET_IMPACT_ENGINE_SHA,
  VENDOR_BUDGET_IMPACT_MAX_ROWS,
  VENDOR_BUDGET_IMPACT_MAPPING_SHA,
  VENDOR_BUDGET_IMPACT_METHOD,
  VENDOR_BUDGET_IMPACT_PATH,
  VENDOR_BUDGET_IMPACT_PAYMENT_PROTOCOLS,
  VENDOR_BUDGET_IMPACT_PRICE_DISPLAY,
  VENDOR_BUDGET_IMPACT_PRICE_USD,
  VENDOR_BUDGET_IMPACT_PRODUCT,
  VENDOR_BUDGET_IMPACT_QUOTE_MEANING,
  VENDOR_BUDGET_IMPACT_SCHEMA_VERSION,
  VENDOR_BUDGET_IMPACT_WORKER_KILL_GRACE_MS,
  isVendorBudgetImpactEnabled,
  isVendorBudgetImpactPath,
  vendorBudgetImpactCostParameters,
  vendorBudgetImpactLimits,
  vendorBudgetImpactPrice,
} from "./vendor-budget-impact-config.mjs";

export {
  DEFAULT_VENDOR_BUDGET_IMPACT_PRICE_USD,
  VENDOR_BUDGET_IMPACT_AMOUNT_ATOMIC,
  VENDOR_BUDGET_IMPACT_DESCRIPTION,
  VENDOR_BUDGET_IMPACT_ENGINE_SHA,
  VENDOR_BUDGET_IMPACT_METHOD,
  VENDOR_BUDGET_IMPACT_PATH,
  VENDOR_BUDGET_IMPACT_PAYMENT_PROTOCOLS,
  VENDOR_BUDGET_IMPACT_PRICE_DISPLAY,
  VENDOR_BUDGET_IMPACT_PRICE_USD,
  VENDOR_BUDGET_IMPACT_PRODUCT,
  VENDOR_BUDGET_IMPACT_QUOTE_MEANING,
  VENDOR_BUDGET_IMPACT_SCHEMA_VERSION,
  isVendorBudgetImpactEnabled,
  isVendorBudgetImpactPath,
  vendorBudgetImpactCostParameters,
  vendorBudgetImpactLimits,
  vendorBudgetImpactPrice,
};

export const VENDOR_BUDGET_IMPACT_READ_ONLY_POST = Object.freeze({
  method: VENDOR_BUDGET_IMPACT_METHOD,
  path: VENDOR_BUDGET_IMPACT_PATH,
  paymentProtocols: VENDOR_BUDGET_IMPACT_PAYMENT_PROTOCOLS,
});

const ALLOWED_BODY_KEYS = Object.freeze(["before", "after"]);
const ALLOWED_SNAPSHOT_KEYS = Object.freeze(["rows", "label", "note"]);
const ALLOWED_ROW_KEYS = Object.freeze(["field", "value", "unit"]);
const LIMIT_RAISE_KEYS = Object.freeze([
  "maxBytes", "maxJsonDepth", "maxJsonNodes", "maxRows", "timeoutMs",
  "maxRequestBytes", "maxOutputBytes", "maxSnapshotBytes", "limits",
]);
const PATHISH_KEYS = Object.freeze(["path", "file", "filename", "filepath", "outDir", "out-dir", "cache", "cacheDir"]);
const merchantRoot = dirname(fileURLToPath(import.meta.url));
const defaultWorkerPath = join(merchantRoot, "vendor-budget-impact-worker.mjs");
const ownedWorkers = new Set();

function readVendorFixture(rel) {
  return Object.freeze(JSON.parse(readFileSync(join(merchantRoot, "vendor/vendor-budget-impact/fixtures", rel), "utf8")));
}
const JOURNEY_BEFORE = readVendorFixture("caller/before.json");
const JOURNEY_AFTER = readVendorFixture("caller/after.json");

export const VENDOR_BUDGET_IMPACT_DISCOVERY_INPUT = Object.freeze({
  before: JOURNEY_BEFORE,
  after: JOURNEY_AFTER,
});

export class VendorBudgetImpactInputError extends Error {
  constructor(message, { status = 400, code = "invalid_vendor_budget_input" } = {}) {
    super(message);
    this.name = "VendorBudgetImpactInputError";
    this.status = status;
    this.code = code;
  }
}

function inputError(message, status = 400, code = "invalid_vendor_budget_input") {
  throw new VendorBudgetImpactInputError(message, { status, code });
}

function extraKeys(object, allowed) {
  return Object.keys(object).filter((key) => !allowed.includes(key));
}

function walkJsonGraph(value, limits, role) {
  let nodes = 0;
  const visit = (node, depth) => {
    if (depth > limits.maxJsonDepth) inputError(`${role} json depth exceeds server limit ${limits.maxJsonDepth}`, 400, "json_depth_limit");
    nodes += 1;
    if (nodes > limits.maxJsonNodes) inputError(`${role} json nodes exceed server limit ${limits.maxJsonNodes}`, 400, "json_node_limit");
    if (node && typeof node === "object") {
      const children = Array.isArray(node) ? node : Object.values(node);
      for (const child of children) visit(child, depth + 1);
    }
  };
  visit(value, 0);
}

function looksLikePath(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (value.startsWith("{") || value.startsWith("[")) return false;
  return (
    /^[A-Za-z]:[\\/]/.test(value)
    || value.startsWith("/")
    || value.startsWith("./")
    || value.startsWith("../")
    || value.startsWith("file:")
    || /\.(json|html|lock)$/i.test(value)
  );
}

function looksLikeUrl(value) {
  if (typeof value === "string") {
    return /^(https?:|ftp:|git\+|github:)/i.test(value.trim());
  }
  if (value && typeof value === "object" && typeof value.href === "string") return true;
  return false;
}

function rejectControlSurface(object, role) {
  for (const key of LIMIT_RAISE_KEYS) {
    if (Object.hasOwn(object, key)) inputError("caller cannot raise admission limits", 400, "limit_raise_rejected");
  }
  for (const key of PATHISH_KEYS) {
    if (typeof object[key] === "string") inputError(`${role} filesystem input is not accepted`, 400, "filesystem_input");
  }
  if (typeof object.command === "string" || Array.isArray(object.argv) || typeof object.shell === "string" || typeof object.program === "string") {
    inputError("arbitrary commands are not accepted", 400, "command_input");
  }
  if (object.fetch === true || object.network === true || looksLikeUrl(object.url) || looksLikeUrl(object.href)) {
    inputError(`${role} URL dereference is not accepted`, 400, "url_input");
  }
}

function admitBoundedString(value, role, limits) {
  if (typeof value !== "string") inputError(`${role} must be a string`);
  if (value.length > limits.maxStringChars) inputError(`${role} exceeds ${limits.maxStringChars} characters`, 400, "string_limit");
  if (looksLikePath(value) || looksLikeUrl(value)) {
    inputError(`${role} must not be a filesystem path or URL`, 400, "filesystem_input");
  }
  return value;
}

function admitPricingRow(row, role, index, limits) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    inputError(`${role} row ${index} must be an object`);
  }
  const extra = extraKeys(row, ALLOWED_ROW_KEYS);
  if (extra.length) inputError(`${role} row ${index} unexpected field: ${extra[0]}`);
  if (typeof row.field !== "string" || !row.field.trim()) {
    inputError(`${role} row ${index} field must be a non-empty string`, 400, "input-schema-mismatch");
  }
  if (typeof row.value !== "number" || !Number.isFinite(row.value)) {
    inputError(`${role} row ${index} value must be a finite number`, 400, "input-schema-mismatch");
  }
  if (typeof row.unit !== "string" || !row.unit.trim()) {
    inputError(`${role} row ${index} unit must be a non-empty string`, 400, "input-schema-mismatch");
  }
  if (row.field.length > limits.maxStringChars || row.unit.length > limits.maxStringChars) {
    inputError(`${role} row ${index} field/unit exceeds ${limits.maxStringChars} characters`, 400, "string_limit");
  }
  return Object.freeze({
    field: row.field.trim(),
    value: row.value,
    unit: row.unit.trim(),
  });
}

function admitSnapshot(value, role, limits) {
  if (value === undefined || value === null) inputError(`${role} is required`);
  if (typeof value === "string") {
    if (looksLikeHtml(value)) inputError(`${role} is HTML, not pricing-row JSON`, 400, "html-input");
    if (looksLikePath(value) || looksLikeUrl(value)) {
      inputError(`${role} must be a supplied JSON pricing snapshot, not a filesystem path or URL`, 400, "filesystem_input");
    }
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      inputError(`${role} is not JSON: ${error.message}`, 400, "parse-error");
    }
    return admitSnapshot(parsed, role, limits);
  }
  if (typeof value !== "object" || Array.isArray(value) || Buffer.isBuffer(value)) {
    inputError(`${role} must be a JSON object with a rows array`);
  }
  rejectControlSurface(value, role);
  const extra = extraKeys(value, ALLOWED_SNAPSHOT_KEYS);
  if (extra.length) inputError(`${role} unexpected field: ${extra[0]}`);
  walkJsonGraph(value, limits, role);
  if (typeof value.label === "string" && value.label.trim().toUpperCase() === "SAMPLE") {
    inputError("SAMPLE pricing snapshot cannot be emitted as a customer budget impact", 400, "sample-as-customer-delta");
  }
  if (value.label !== undefined) admitBoundedString(value.label, `${role}.label`, limits);
  if (value.note !== undefined) admitBoundedString(value.note, `${role}.note`, limits);
  if (!Array.isArray(value.rows)) {
    inputError(`${role} must be a JSON object with a rows array`, 400, "input-schema-mismatch");
  }
  if (value.rows.length === 0) {
    inputError(`${role} has zero rows`, 400, "empty-pricing-rows");
  }
  if (value.rows.length > limits.maxRows) {
    inputError(`${role} exceeds server row ceiling ${limits.maxRows}`, 413, "row_limit");
  }
  const rows = value.rows.map((row, index) => admitPricingRow(row, role, index, limits));
  const snapshot = Object.freeze({
    ...(value.label !== undefined ? { label: value.label } : {}),
    ...(value.note !== undefined ? { note: value.note } : {}),
    rows,
  });
  const text = `${JSON.stringify(snapshot)}\n`;
  if (Buffer.byteLength(text, "utf8") > limits.maxSnapshotBytes) {
    inputError(`${role} exceeds server snapshot ceiling ${limits.maxSnapshotBytes}`, 413, "payload_too_large");
  }
  return Object.freeze({ snapshot, text });
}

const PAYMENT_CREDENTIAL_HEADERS = Object.freeze([
  "payment-signature",
  "x-payment",
  "x-payment-signature",
]);

function headerPresent(headers, name) {
  return Object.prototype.hasOwnProperty.call(headers || {}, name)
    || Object.prototype.hasOwnProperty.call(headers || {}, name.toLowerCase());
}

function requestHasPaymentCredential(req) {
  const headers = req?.headers || {};
  if (PAYMENT_CREDENTIAL_HEADERS.some((name) => headerPresent(headers, name))) return true;
  if (!headerPresent(headers, "authorization")) return false;
  const authorization = req.get?.("authorization") || headers.authorization || headers.Authorization || "";
  if (String(authorization).trim() === "") return true;
  return hasMppPaymentAuthorizationForPreflight(headers);
}

export function isVendorBudgetUnsignedDiscoveryProbe(req) {
  if (requestHasPaymentCredential(req)) return false;
  const body = req?.body;
  if (body === undefined) return true;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  return Object.keys(body).length === 0;
}

export function admitVendorBudgetImpactRequest(body, limits = vendorBudgetImpactLimits()) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    inputError("request body must be a JSON object");
  }
  rejectControlSurface(body, "request");
  const extra = extraKeys(body, ALLOWED_BODY_KEYS);
  if (extra.length) inputError(`unexpected field: ${extra[0]}`);
  const before = admitSnapshot(body.before, "before", limits);
  const after = admitSnapshot(body.after, "after", limits);
  return Object.freeze({ before, after, limits });
}

export function normalizeVendorBudgetImpactInput(body, limits = vendorBudgetImpactLimits()) {
  const admitted = admitVendorBudgetImpactRequest(body, limits);
  return Object.freeze({
    before: admitted.before.snapshot,
    after: admitted.after.snapshot,
  });
}

export function vendorBudgetImpactQuote(env = process.env) {
  const price = vendorBudgetImpactPrice(env);
  return Object.freeze({
    amountAtomic: price.amountAtomic,
    displayUsdc: price.displayUsdc,
    meaning: VENDOR_BUDGET_IMPACT_QUOTE_MEANING,
  });
}

export function vendorBudgetImpactBoundary() {
  return Object.freeze({
    filesystemInput: false,
    networkFetch: false,
    arbitraryCommand: false,
    writableCache: false,
    soldFlag: false,
    purchaseAuthority: false,
    liveMarketQuote: false,
  });
}

export function engineProvenance() {
  return Object.freeze({
    repo: VENDOR_BUDGET_IMPACT_ENGINE_REPO,
    sha: VENDOR_BUDGET_IMPACT_ENGINE_SHA,
    path: VENDOR_BUDGET_IMPACT_ENGINE_PATH,
    catalogSha: VENDOR_BUDGET_IMPACT_CATALOG_SHA,
    mappingSha: VENDOR_BUDGET_IMPACT_MAPPING_SHA,
    mappingPath: "server/paid-useful-jobs/release/apps/vendor-budget-impact/cli.mjs",
    archiveSha256: VENDOR_BUDGET_IMPACT_ARCHIVE_SHA256,
  });
}

function publicEngineReport(report, impact) {
  return {
    schema: VENDOR_BUDGET_IMPACT_ENGINE_SCHEMA,
    appId: impact.appId,
    ok: report.ok === true,
    status: impact.status,
    purchaseAuthority: false,
    paidValueClaim: false,
    settlement: "nonsettling-prototype",
    summary: impact.summary,
    actions: impact.actions,
    gaps: impact.gaps,
    scope: impact.scope,
    counts: report.counts,
    added: report.added,
    removed: report.removed,
    fieldChanges: report.fieldChanges,
    unitChanges: report.unitChanges,
    conflicting: report.conflicting,
    unknown: report.unknown,
  };
}

function sha256Json(value) {
  return createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex");
}

const FORBIDDEN_ENGINE_KEYS = Object.freeze([
  "payer", "wallet", "paymentSignature", "roi", "totalCost", "purchaseAdvice",
  "sold", "soldFlag", "demand", "liveQuote",
]);

function fieldKeyOf(row) {
  return String(row.field || "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function workerPayloadClaimsPurchaseAuthority(computed) {
  return computed?.impact?.purchaseAuthority === true
    || computed?.report?.purchaseAuthority === true
    || computed?.impact?.paidValueClaim === true
    || computed?.report?.paidValueClaim === true
    || computed?.impact?.sold === true
    || computed?.report?.sold === true;
}

export function reportsAgree(expected, computed) {
  if (!expected?.report || !computed?.report || !expected?.impact || !computed?.impact) return false;
  if (expected.impact.status !== computed.impact.status) return false;
  const left = publicEngineReport(expected.report, expected.impact);
  const right = publicEngineReport(computed.report, computed.impact);
  if (JSON.stringify(left.counts) !== JSON.stringify(right.counts)) return false;
  for (const key of ["fieldChanges", "unitChanges", "added", "removed", "conflicting", "unknown"]) {
    if (JSON.stringify(left[key] || []) !== JSON.stringify(right[key] || [])) return false;
  }
  return true;
}

export function validateComputedVendorBudgetImpact(engine, admitted) {
  if (!engine || engine.ok !== true) {
    return { ok: false, code: "output-schema-mismatch", error: "computed impact is not a successful report" };
  }
  if (engine.purchaseAuthority === true || engine.paidValueClaim === true) {
    return { ok: false, code: "output-authority-rejected", error: "computed impact claimed purchase authority" };
  }
  if (engine.appId && engine.appId !== "vendor-budget-impact") {
    return { ok: false, code: "output-schema-mismatch", error: "computed impact is not a vendor-budget report" };
  }
  for (const key of FORBIDDEN_ENGINE_KEYS) {
    if (Object.hasOwn(engine, key) && engine[key] !== false && engine[key] != null) {
      return { ok: false, code: "output-counterparty-leaked", error: `computed impact included ${key}` };
    }
  }
  const status = engine.status;
  if (!["actionable", "informational", "partial"].includes(status)) {
    return { ok: false, code: "output-status-invalid", error: `computed status ${status} is not a paid success class` };
  }
  const counts = engine.counts;
  if (!counts || typeof counts !== "object") {
    return { ok: false, code: "output-counts-missing", error: "computed impact omitted counts" };
  }
  for (const key of ["fieldChanges", "unitChanges", "added", "removed", "conflicting", "unknown"]) {
    if (!Number.isInteger(counts[key]) || counts[key] < 0) {
      return { ok: false, code: "output-counts-invalid", error: `computed count ${key} is not a non-negative integer` };
    }
  }
  if ((engine.fieldChanges || []).length !== counts.fieldChanges) {
    return { ok: false, code: "output-counts-invalid", error: "fieldChanges length does not match counts" };
  }
  if ((engine.unitChanges || []).length !== counts.unitChanges) {
    return { ok: false, code: "output-counts-invalid", error: "unitChanges length does not match counts" };
  }
  const beforeKeys = new Set(admitted.before.snapshot.rows.map(fieldKeyOf));
  const afterByKey = new Map(admitted.after.snapshot.rows.map((row) => [fieldKeyOf(row), row]));
  const beforeByKey = new Map(admitted.before.snapshot.rows.map((row) => [fieldKeyOf(row), row]));
  const unitChangedKeys = new Set();
  for (const change of engine.unitChanges || []) {
    if (change.beforeUnit === change.afterUnit) {
      return { ok: false, code: "output-delta-incoherent", error: `unitChange ${change.fieldKey} has identical units` };
    }
    if (change.numericComparison && change.numericComparison !== "not-applicable-across-units") {
      return { ok: false, code: "output-unit-economics", error: `unitChange ${change.fieldKey} fabricated numeric economics` };
    }
    unitChangedKeys.add(change.fieldKey);
  }
  for (const change of engine.fieldChanges || []) {
    if (unitChangedKeys.has(change.fieldKey)) {
      return { ok: false, code: "output-unit-economics", error: `fieldChange ${change.fieldKey} compared numbers across units` };
    }
    if (JSON.stringify(change.beforeValue) === JSON.stringify(change.afterValue)) {
      return { ok: false, code: "output-delta-incoherent", error: `fieldChange ${change.fieldKey} has identical values` };
    }
    const beforeRow = beforeByKey.get(change.fieldKey);
    const afterRow = afterByKey.get(change.fieldKey);
    if (!beforeRow || !afterRow) {
      return { ok: false, code: "output-delta-unbound", error: `fieldChange ${change.fieldKey} is not bound to admitted rows` };
    }
    if (beforeRow.value !== change.beforeValue || afterRow.value !== change.afterValue) {
      return { ok: false, code: "output-delta-unbound", error: `fieldChange ${change.fieldKey} does not match admitted values` };
    }
    if (beforeRow.unit !== afterRow.unit) {
      return { ok: false, code: "output-unit-economics", error: `fieldChange ${change.fieldKey} spans mismatched units` };
    }
  }
  for (const added of engine.added || []) {
    if (beforeKeys.has(added.fieldKey) || !afterByKey.has(added.fieldKey)) {
      return { ok: false, code: "output-delta-unbound", error: `added ${added.fieldKey} is not bound to admitted after rows` };
    }
  }
  const hasDelta = counts.fieldChanges + counts.unitChanges + counts.added + counts.removed > 0;
  if (status === "informational" && (hasDelta || counts.conflicting > 0 || counts.unknown > 0)) {
    return { ok: false, code: "output-status-invalid", error: "informational report is not a no-impact scan" };
  }
  if (status === "actionable" && !hasDelta) {
    return { ok: false, code: "output-status-invalid", error: "actionable report has no field/unit/membership delta" };
  }
  if (status === "actionable" && (counts.conflicting > 0 || counts.unknown > 0)) {
    return { ok: false, code: "output-status-invalid", error: "actionable report cannot include conflicting or unknown rows" };
  }
  const numericDeltaOverflow = (engine.fieldChanges || []).some(row => !Number.isFinite(row.afterValue - row.beforeValue));
  if (status === "actionable" && numericDeltaOverflow) {
    return { ok: false, code: "output-unit-economics", error: "non-finite price delta must remain partial" };
  }
  if (status === "partial" && counts.conflicting === 0 && counts.unknown === 0 && !numericDeltaOverflow) {
    return { ok: false, code: "output-status-invalid", error: "partial report requires conflicting or unknown rows" };
  }
  return { ok: true };
}

export function formatVendorBudgetImpactResult(report, impact, {
  charged = true,
  transport = "ok",
  wallMs = null,
  admittedBodyBytes = null,
  limits = vendorBudgetImpactLimits(),
  env = process.env,
} = {}) {
  const analysis = impact?.status && transport === "ok" && report?.ok === true
    ? impact.status
    : "not-run";
  const engine = report && impact && analysis !== "not-run" ? publicEngineReport(report, impact) : null;
  const markdown = engine ? toMarkdown(impact) : null;
  const markdownFits = markdown && Buffer.byteLength(markdown, "utf8") <= limits.maxMarkdownBytes;
  const quote = vendorBudgetImpactQuote(env);
  const result = {
    ok: charged && transport === "ok" && Boolean(engine) && engine.ok === true,
    product: VENDOR_BUDGET_IMPACT_PRODUCT,
    schemaVersion: VENDOR_BUDGET_IMPACT_SCHEMA_VERSION,
    quote,
    charged,
    analysis,
    transport,
    engine,
    markdown: markdownFits ? markdown : null,
    markdownOmitted: Boolean(engine) && !markdownFits,
    digest: engine ? sha256Json(engine) : null,
    engineProvenance: engineProvenance(),
    costInputs: {
      admittedBodyBytes,
      wallMs,
      hostingCosts: "unknown",
      facilitatorFees: "unknown",
      modelCosts: "none",
      liveExtractPriceUsd: "0.005",
      monetaryMargin: null,
      note: "Default price matches live GET /extract $0.005. Margin is not proven.",
    },
    boundary: vendorBudgetImpactBoundary(),
    limits: {
      maxRequestBytes: limits.maxRequestBytes,
      maxSnapshotBytes: limits.maxSnapshotBytes,
      timeoutMs: limits.timeoutMs,
      maxRows: limits.maxRows,
    },
  };
  // Reserve room for the settlement-unknown recovery envelope around this result.
  const deliveryCeiling = Math.max(0, limits.maxResponseBytes - 1024);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > deliveryCeiling) {
    // Markdown is redundant. Evidence arrays are the product and must never
    // be erased while counts, ok and charged still claim a complete report.
    result.markdown = null;
    result.markdownOmitted = true;
  }
  if (engine && Buffer.byteLength(JSON.stringify(result), "utf8") > deliveryCeiling) {
    inputError("complete comparison exceeds response ceiling; reduce rows", 413, "output_size_limit");
  }
  return result;
}

export function compareAdmittedSnapshots(before, after) {
  const report = comparePricingTables(before, after);
  const impact = buildImpact(report);
  return { report, impact };
}

export function resolveVendorBudgetWorkerPath(env = process.env) {
  const raw = String(env.VENDOR_BUDGET_IMPACT_WORKER_PATH || "").trim();
  if (!raw) return defaultWorkerPath;
  const resolved = resolve(raw);
  if (!resolved.startsWith(`${merchantRoot}${merchantRoot.endsWith("/") ? "" : "/"}`) && resolved !== merchantRoot) {
    throw new VendorBudgetImpactInputError("worker path must stay inside the merchant tree", { status: 500, code: "invalid_worker_path" });
  }
  return resolved;
}

function trackWorker(child) {
  ownedWorkers.add(child);
  const forget = () => ownedWorkers.delete(child);
  child.once("exit", forget);
  child.once("close", forget);
  return child;
}

export function ownedVendorBudgetWorkerCount() {
  return ownedWorkers.size;
}

export function reapVendorBudgetWorker(child, { graceMs = VENDOR_BUDGET_IMPACT_WORKER_KILL_GRACE_MS } = {}) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) {
    ownedWorkers.delete(child);
    return Promise.resolve();
  }
  return new Promise((resolveDone) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      ownedWorkers.delete(child);
      resolveDone();
    };
    child.once("exit", done);
    try { child.kill("SIGTERM"); } catch { done(); return; }
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      }
    }, graceMs).unref();
  });
}

export function runVendorBudgetCompareWorker({ before, after, env = process.env, timeoutMs } = {}) {
  const limits = vendorBudgetImpactLimits(env);
  const budget = Math.min(timeoutMs ?? limits.timeoutMs, limits.timeoutMs);
  const workerPath = resolveVendorBudgetWorkerPath(env);
  if (ownedWorkers.size >= limits.maxWorkers) {
    return Promise.reject(Object.assign(new Error("vendor-budget workers at capacity"), { code: "busy", transport: "busy" }));
  }
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = trackWorker(spawn(process.execPath, [workerPath], {
      cwd: merchantRoot,
      env: { ...process.env, ...env, VENDOR_BUDGET_IMPACT_WORKER: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    }));
    const stdout = [];
    let stdoutBytes = 0;
    let timeoutHandle;
    const maxStdoutBytes = limits.maxResponseBytes;
    const settle = (fn) => (value) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      fn(value);
    };
    const succeed = settle(resolvePromise);
    const fail = settle((error) => {
      reapVendorBudgetWorker(child).finally(() => reject(error));
    });
    child.stdin?.on("error", () => {});
    child.stderr?.resume();
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        fail(Object.assign(new Error("vendor-budget worker output exceeded bound"), {
          code: "engine-crash",
          transport: "engine-crash",
        }));
        return;
      }
      stdout.push(chunk);
    });
    child.once("error", (error) => fail(error));
    child.once("close", (code, signal) => {
      if (settled) {
        ownedWorkers.delete(child);
        return;
      }
      ownedWorkers.delete(child);
      const raw = Buffer.concat(stdout);
      if (signal === "SIGTERM" || signal === "SIGKILL") {
        fail(Object.assign(new Error("vendor-budget compare timeout"), { code: "timeout", transport: "timeout" }));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        fail(Object.assign(new Error("vendor-budget worker returned invalid JSON"), { code: "engine-crash", transport: "engine-crash" }));
        return;
      }
      if (code !== 0) {
        fail(Object.assign(new Error(`vendor-budget worker exited ${code}`), {
          code: "engine-crash",
          transport: "engine-crash",
        }));
        return;
      }
      if (parsed?.ok === true && parsed.report && parsed.impact) {
        succeed({ report: parsed.report, impact: parsed.impact });
        return;
      }
      fail(Object.assign(new Error(parsed?.error || `vendor-budget worker failed (${code ?? signal})`), {
        code: parsed?.code || "engine-crash",
        transport: parsed?.code === "timeout" ? "timeout" : "engine-crash",
      }));
    });
    timeoutHandle = setTimeout(() => {
      fail(Object.assign(new Error("vendor-budget compare timeout"), { code: "timeout", transport: "timeout" }));
    }, budget);
    timeoutHandle.unref?.();
    try {
      child.stdin.end(JSON.stringify({ before, after }));
    } catch (error) {
      fail(error);
    }
  });
}

export async function executeVendorBudgetImpact({
  input,
  rawBody,
  env = process.env,
  inProcess = false,
} = {}) {
  const limits = vendorBudgetImpactLimits(env);
  const started = Date.now();
  const body = input || JSON.parse(Buffer.from(rawBody || "{}").toString("utf8") || "{}");
  const admitted = admitVendorBudgetImpactRequest(body, limits);
  const admittedBodyBytes = rawBody ? Buffer.byteLength(rawBody) : Buffer.byteLength(JSON.stringify({
    before: admitted.before.snapshot,
    after: admitted.after.snapshot,
  }));
  if (admittedBodyBytes > limits.maxRequestBytes) inputError("request exceeds server byte ceiling", 413, "payload_too_large");
  try {
    const expected = compareAdmittedSnapshots(admitted.before.snapshot, admitted.after.snapshot);
    const computed = inProcess
      ? expected
      : await runVendorBudgetCompareWorker({
        before: admitted.before.snapshot,
        after: admitted.after.snapshot,
        env,
        timeoutMs: limits.timeoutMs,
      });
    if (workerPayloadClaimsPurchaseAuthority(computed) || (!inProcess && !reportsAgree(expected, computed))) {
      return formatVendorBudgetImpactResult(null, null, {
        charged: false,
        transport: "engine-crash",
        wallMs: Date.now() - started,
        admittedBodyBytes,
        limits,
        env,
      });
    }
    const semantic = validateComputedVendorBudgetImpact(
      publicEngineReport(expected.report, expected.impact),
      admitted,
    );
    if (!semantic.ok) {
      return formatVendorBudgetImpactResult(null, null, {
        charged: false,
        transport: "engine-crash",
        wallMs: Date.now() - started,
        admittedBodyBytes,
        limits,
        env,
      });
    }
    return formatVendorBudgetImpactResult(expected.report, expected.impact, {
      charged: true,
      transport: "ok",
      wallMs: Date.now() - started,
      admittedBodyBytes,
      limits,
      env,
    });
  } catch (error) {
    if (error instanceof VendorBudgetImpactInputError) throw error;
    const transport = error?.transport || (error?.code === "timeout" ? "timeout" : "engine-crash");
    return formatVendorBudgetImpactResult(null, null, {
      charged: false,
      transport,
      wallMs: Date.now() - started,
      admittedBodyBytes,
      limits,
      env,
    });
  }
}

export function vendorBudgetImpactFailureDelivery() {
  return Object.freeze({
    status: 503,
    charged: false,
    owedDelivery: false,
  });
}

function unchargedError(res, error) {
  const status = error instanceof VendorBudgetImpactInputError ? error.status : 400;
  const code = error instanceof VendorBudgetImpactInputError ? error.code : "invalid_vendor_budget_input";
  res.set("Cache-Control", "no-store");
  return res.status(status).json({
    ok: false,
    product: VENDOR_BUDGET_IMPACT_PRODUCT,
    schemaVersion: VENDOR_BUDGET_IMPACT_SCHEMA_VERSION,
    error: error instanceof VendorBudgetImpactInputError ? error.message : "invalid vendor-budget-impact request",
    code,
    charged: false,
    analysis: "not-run",
    transport: "rejected",
    boundary: vendorBudgetImpactBoundary(),
  });
}

function isJsonContentType(req) {
  const type = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  return type === "application/json" || /^application\/[a-z0-9.+-]*\+json$/.test(type);
}

export function readBoundedJsonBody(req, { maxBytes, timeoutMs }) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
      if (error) reject(error);
      else resolveBody(value);
    };
    const timer = setTimeout(() => {
      finish(new VendorBudgetImpactInputError("request timeout", { status: 408, code: "request_timeout" }));
      req.pause();
    }, timeoutMs);
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        req.pause();
        finish(new VendorBudgetImpactInputError(`request exceeds server byte ceiling ${maxBytes}`, { status: 413, code: "payload_too_large" }));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(null, Buffer.concat(chunks, size));
    const onError = (error) => finish(error);
    const onAborted = () => finish(new VendorBudgetImpactInputError("request aborted", { status: 400, code: "request_aborted" }));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

export function mountVendorBudgetImpactParser(app, { env = process.env } = {}) {
  if (!isVendorBudgetImpactEnabled(env)) return app;
  const limits = vendorBudgetImpactLimits(env);
  app.post(VENDOR_BUDGET_IMPACT_PATH, async (req, res, next) => {
    if (req.path !== VENDOR_BUDGET_IMPACT_PATH) {
      return unchargedError(res, new VendorBudgetImpactInputError("use the exact canonical /vendor-budget-impact path", { code: "noncanonical_vendor_budget_path" }));
    }
    try {
      const raw = await readBoundedJsonBody(req, { maxBytes: limits.maxRequestBytes, timeoutMs: limits.timeoutMs });
      req.rawBody = raw;
      if (!raw.length) {
        req.body = {};
        return next();
      }
      if (!isJsonContentType(req)) {
        return unchargedError(res, new VendorBudgetImpactInputError("Content-Type must be application/json", { status: 415, code: "unsupported_media_type" }));
      }
      try {
        req.body = JSON.parse(raw.toString("utf8"));
      } catch (error) {
        return unchargedError(res, new VendorBudgetImpactInputError(`request is not JSON: ${error.message}`, { status: 400, code: "parse-error" }));
      }
      return next();
    } catch (error) {
      return unchargedError(res, error instanceof VendorBudgetImpactInputError ? error : new VendorBudgetImpactInputError(String(error?.message || error)));
    }
  });
  return app;
}

export function validateVendorBudgetImpactRequest(req, res, next) {
  if (req.method !== VENDOR_BUDGET_IMPACT_METHOD || !isVendorBudgetImpactPath(req.path)) return next();
  try {
    if (isVendorBudgetUnsignedDiscoveryProbe(req)) {
      res.set("X-SameDayDesk-Paid-Effect", "read_only");
      res.set("X-SameDayDesk-Paid-Effect-Profile", "/.well-known/paid-action-effects.json");
      res.set("X-SameDayDesk-Vendor-Budget-Impact", "enabled");
      return next();
    }
    res.locals.vendorBudgetImpactInput = admitVendorBudgetImpactRequest(req.body);
    if (hasMppPaymentAuthorizationForPreflight(req.headers)) {
      return unchargedError(res, new VendorBudgetImpactInputError(
        "POST /vendor-budget-impact accepts x402 only. Do not send an MPP Authorization. Retry unpaid for x402 Payment-Required.",
        { status: 400, code: "mpp_not_accepted" },
      ));
    }
    res.set("X-SameDayDesk-Paid-Effect", "read_only");
    res.set("X-SameDayDesk-Paid-Effect-Profile", "/.well-known/paid-action-effects.json");
    res.set("X-SameDayDesk-Vendor-Budget-Impact", "enabled");
    return next();
  } catch (error) {
    return unchargedError(res, error instanceof VendorBudgetImpactInputError ? error : new VendorBudgetImpactInputError("invalid vendor-budget-impact request"));
  }
}

export async function serveVendorBudgetImpact(req, res) {
  res.set("Cache-Control", "no-store");
  res.set("X-SameDayDesk-Vendor-Budget-Impact", "enabled");
  const failHttp = (result, transport) => {
    const delivery = vendorBudgetImpactFailureDelivery();
    result.charged = delivery.charged;
    result.analysis = "not-run";
    result.error = transport === "timeout" ? "vendor_budget_compare_timeout" : "vendor_budget_engine_failed";
    return res.status(delivery.status).json(result);
  };
  try {
    const result = await executeVendorBudgetImpact({
      input: req.body,
      rawBody: req.rawBody,
    });
    if (result.transport !== "ok") return failHttp(result, result.transport);
    // Replay persists this opt-in candidate before the facilitator mutation.
    // It is not a settled success until the existing paywall supplies proof.
    res.locals.replayPrecomputedDelivery = result;
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof VendorBudgetImpactInputError) return unchargedError(res, error);
    const result = formatVendorBudgetImpactResult(null, null, {
      charged: false,
      transport: "internal-error",
      admittedBodyBytes: req.rawBody ? Buffer.byteLength(req.rawBody) : null,
    });
    return failHttp(result, result.transport);
  }
}

export function vendorBudgetImpactResource({ publicUrl, env = process.env } = {}) {
  const price = vendorBudgetImpactPrice(env);
  return {
    url: `${publicUrl}${VENDOR_BUDGET_IMPACT_PATH}`,
    method: VENDOR_BUDGET_IMPACT_METHOD,
    amount: price.amountAtomic,
    description: VENDOR_BUDGET_IMPACT_DESCRIPTION,
    mimeType: "application/json",
  };
}

export function vendorBudgetImpactInputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["before", "after"],
    properties: {
      before: {
        type: "object",
        description: "Pricing-row snapshot JSON with a rows array of {field, value, unit}. Not a filesystem path, URL, or command.",
        additionalProperties: false,
        required: ["rows"],
        properties: {
          rows: {
            type: "array",
            minItems: 1,
            maxItems: VENDOR_BUDGET_IMPACT_MAX_ROWS,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["field", "value", "unit"],
              properties: {
                field: { type: "string", minLength: 1, maxLength: 256 },
                value: { type: "number" },
                unit: { type: "string", minLength: 1, maxLength: 256 },
              },
            },
          },
          label: { type: "string", maxLength: 256 },
          note: { type: "string", maxLength: 256 },
        },
      },
      after: {
        type: "object",
        description: "Pricing-row snapshot JSON with a rows array of {field, value, unit}. Not a filesystem path, URL, or command.",
        additionalProperties: false,
        required: ["rows"],
        properties: {
          rows: {
            type: "array",
            minItems: 1,
            maxItems: VENDOR_BUDGET_IMPACT_MAX_ROWS,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["field", "value", "unit"],
              properties: {
                field: { type: "string", minLength: 1, maxLength: 256 },
                value: { type: "number" },
                unit: { type: "string", minLength: 1, maxLength: 256 },
              },
            },
          },
          label: { type: "string", maxLength: 256 },
          note: { type: "string", maxLength: 256 },
        },
      },
    },
  };
}

export function vendorBudgetImpactOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "ok", "product", "schemaVersion", "quote", "charged", "analysis", "transport",
      "engine", "digest", "engineProvenance", "costInputs", "boundary", "limits",
    ],
    properties: {
      ok: { type: "boolean" },
      product: { type: "string", const: VENDOR_BUDGET_IMPACT_PRODUCT },
      schemaVersion: { type: "string", const: VENDOR_BUDGET_IMPACT_SCHEMA_VERSION },
      quote: {
        type: "object",
        required: ["amountAtomic", "displayUsdc", "meaning"],
        properties: {
          amountAtomic: { type: "string" },
          displayUsdc: { type: "string" },
          meaning: { type: "string" },
        },
      },
      charged: { type: "boolean" },
      analysis: { type: "string", enum: ["actionable", "informational", "partial", "not-run"] },
      transport: { type: "string", enum: ["ok", "timeout", "engine-crash", "internal-error", "rejected", "busy"] },
      engine: { type: ["object", "null"] },
      markdown: { type: ["string", "null"] },
      markdownOmitted: { type: "boolean" },
      digest: { type: ["string", "null"] },
      engineProvenance: { type: "object" },
      costInputs: { type: "object" },
      boundary: { type: "object" },
      limits: { type: "object" },
      error: { type: "string" },
      owedDelivery: { type: "boolean" },
    },
  };
}

export const vendorBudgetImpactMcpOutputSchema = z.object({
  ok: z.boolean(),
  product: z.literal(VENDOR_BUDGET_IMPACT_PRODUCT),
  schemaVersion: z.literal(VENDOR_BUDGET_IMPACT_SCHEMA_VERSION),
  quote: z.object({
    amountAtomic: z.string(),
    displayUsdc: z.string(),
    meaning: z.string(),
  }).strict(),
  charged: z.boolean(),
  analysis: z.enum(["actionable", "informational", "partial", "not-run"]),
  transport: z.enum(["ok", "timeout", "engine-crash", "internal-error", "rejected", "busy"]),
  engine: z.record(z.any()).nullable(),
  markdown: z.string().nullable().optional(),
  markdownOmitted: z.boolean().optional(),
  digest: z.string().nullable(),
  engineProvenance: z.record(z.any()),
  costInputs: z.record(z.any()),
  boundary: z.record(z.any()),
  limits: z.record(z.any()),
  error: z.string().optional(),
  owedDelivery: z.boolean().optional(),
}).strict();

export function vendorBudgetImpactOutputExample() {
  const { report, impact } = compareAdmittedSnapshots(JOURNEY_BEFORE, JOURNEY_AFTER);
  return formatVendorBudgetImpactResult(report, impact, {
    charged: true,
    transport: "ok",
    wallMs: 4,
    admittedBodyBytes: 400,
  });
}

export function vendorBudgetImpactX402Route({ network, payTo, extensions, env = process.env } = {}) {
  const price = vendorBudgetImpactPrice(env);
  const example = vendorBudgetImpactOutputExample();
  return {
    [`${VENDOR_BUDGET_IMPACT_METHOD} ${VENDOR_BUDGET_IMPACT_PATH}`]: {
      serviceName: "SameDayDesk",
      tags: ["pricing", "budget-impact", "vendor-cost", "row-delta"],
      iconUrl: BAZAAR_SERVICE_ICON_URL,
      accepts: [{ scheme: "exact", price: price.priceUsd, network, payTo }],
      description: VENDOR_BUDGET_IMPACT_DESCRIPTION,
      mimeType: "application/json",
      extensions: {
        ...extensions,
        [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
        ...declareDiscoveryContract({
          routeKey: `${VENDOR_BUDGET_IMPACT_METHOD} ${VENDOR_BUDGET_IMPACT_PATH}`,
          method: VENDOR_BUDGET_IMPACT_METHOD,
          bodyType: "json",
          input: VENDOR_BUDGET_IMPACT_DISCOVERY_INPUT,
          inputSchema: vendorBudgetImpactInputSchema(),
          output: { example },
          outputSchema: vendorBudgetImpactOutputSchema(),
        }),
      },
    },
  };
}

export function vendorBudgetImpactOpenApiPath({ paymentInfo, env = process.env } = {}) {
  const price = vendorBudgetImpactPrice(env);
  return {
    post: {
      operationId: "compareVendorBudgetImpact",
      tags: ["Agent Operations"],
      summary: VENDOR_BUDGET_IMPACT_DESCRIPTION,
      requestBody: {
        required: true,
        content: { "application/json": { schema: vendorBudgetImpactInputSchema() } },
      },
      responses: {
        "200": {
          description: "bounded budget-impact report after a completed compare. analysis is actionable, informational (identical rows), or partial. HTTP 200 is not used for timeout, crash, oversized worker output, or nonzero worker exit.",
          content: { "application/json": { schema: vendorBudgetImpactOutputSchema() } },
        },
        "400": { description: "unsupported or malformed input, or an MPP credential on this x402-only route; charged nothing" },
        "402": { description: `payment required (x402 ${price.priceUsd} bounded compare). Initial live release does not accept MPP.` },
        "409": { description: "payment identifier already bound to a different request body, payer, credential, or payment terms" },
        "413": { description: "JSON request or snapshot exceeds the server byte ceiling; no authorization" },
        "415": { description: "Content-Type must be JSON" },
        "503": { description: "engine timeout, crash, capacity, oversized worker output, or unresolved settlement. x402 execute-before-settle: engine failures prevent settlement (charged false). An attempted but unconfirmed settlement remains charged null and may carry a retained comparison, not confirmed paid fulfillment. Exact-credential recovery never settles again. MPP is not accepted." },
      },
      "x-payment-info": paymentInfo,
    },
  };
}
