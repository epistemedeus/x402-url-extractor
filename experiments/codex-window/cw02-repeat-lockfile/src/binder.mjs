import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const JOB_SCHEMA = "pilot.cw02.repeat-lockfile.job.v1";
export const APPROVAL_SCHEMA = "pilot.cw02.repeat-lockfile.approval.v1";
export const INTENT_SCHEMA = "pilot.cw02.repeat-lockfile.intent.v1";
export const LIVE_URL = "https://agents.samedaydesk.com/lockfile-pin-delta";
export const LIVE_METHOD = "POST";
export const RUNTIME_FORMATS = Object.freeze(["npm-package-lock-v2", "npm-package-lock-v3"]);

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CUSTOMER_CLI = resolve(HERE, "../../../../examples/customer-x402/bin/cli.mjs");

export class BinderRefusal extends Error {
  constructor(message, code, detail = {}) {
    super(message);
    this.name = "BinderRefusal";
    this.code = code;
    this.detail = detail;
  }
}

function refuse(message, code, detail) {
  throw new BinderRefusal(message, code, detail);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const next = `${path}.next-${process.pid}`;
  writeFileSync(next, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(next, path);
}

const MAX_LOCKFILE_BYTES = 128 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;
const PIN_FIELDS = ["name", "version", "integrity", "resolved"];
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const textTerm = (value) => value == null ? null : String(value).trim() || null;
const stringTerm = (value) => typeof value === "string" ? value.trim() || null : null;

function boundedRead(path, maxBytes) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) refuse("input must be a regular file", "invalid_input");
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0, n;
    while (size < bytes.length && (n = readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += n;
    if (size > maxBytes) refuse("input exceeds the bounded file ceiling", "input_too_large");
    return bytes.subarray(0, size);
  } finally { if (fd !== undefined) closeSync(fd); }
}

function assertJsonLimits(doc) {
  const pending = [[doc, 0]];
  let nodes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (++nodes > 50_000 || depth > 32) refuse("lockfile exceeds JSON graph limits", "input_too_large");
    if (value && typeof value === "object") for (const child of Object.values(value)) pending.push([child, depth + 1]);
  }
}

function readJson(path, label) {
  try {
    return JSON.parse(boundedRead(path, MAX_REQUEST_BYTES).toString("utf8"));
  } catch (error) {
    refuse(`${label} is not readable JSON: ${error.message}`, "invalid_json", { path });
  }
}

export function classifyLockfile(path, bytes) {
  const name = basename(path);
  if (name === "pnpm-lock.yaml") {
    refuse("pnpm-lock.yaml is honest unsupported input: the live route advertises npm package-lock v2/v3 only", "unsupported_format", { format: "pnpm" });
  }
  if (name === "yarn.lock") {
    refuse("yarn.lock is honest unsupported input: the live route advertises npm package-lock v2/v3 only", "unsupported_format", { format: "yarn" });
  }
  let doc;
  try {
    if (Buffer.byteLength(bytes) > MAX_LOCKFILE_BYTES) refuse("lockfile exceeds byte ceiling", "input_too_large");
    doc = JSON.parse(String(bytes).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error instanceof BinderRefusal) throw error;
    refuse("input is not a JSON npm package-lock", "unsupported_format", { path });
  }
  if (doc?.lockfileVersion !== 2 && doc?.lockfileVersion !== 3) {
    refuse("live route supports only npm package-lock lockfileVersion 2 or 3", "unsupported_format", { lockfileVersion: doc?.lockfileVersion ?? null });
  }
  assertJsonLimits(doc);
  if (Buffer.byteLength(JSON.stringify(doc) + "\n") > MAX_LOCKFILE_BYTES) refuse("lockfile exceeds serialized byte ceiling", "input_too_large");
  return { doc, format: `npm-package-lock-v${doc.lockfileVersion}` };
}

function pinMap(doc) {
  const pins = new Map();
  if (doc.packages && typeof doc.packages === "object" && !Array.isArray(doc.packages)) {
    for (const [id, value] of Object.entries(doc.packages)) {
      if (!id || !plain(value) || value.link === true) continue;
      const marker = "node_modules/";
      const markerIndex = id.lastIndexOf(marker);
      const name = textTerm(value.name) || (markerIndex >= 0 ? id.slice(markerIndex + marker.length) : id) || null;
      pins.set(id, { name, version: textTerm(value.version), integrity: stringTerm(value.integrity), resolved: stringTerm(value.resolved) });
    }
  } else if (doc.dependencies && typeof doc.dependencies === "object" && !Array.isArray(doc.dependencies)) {
    const walk = (dependencies, prefix = "") => {
      if (!plain(dependencies)) return;
      for (const [name, value] of Object.entries(dependencies)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const id = prefix ? `${prefix}/node_modules/${name}` : `node_modules/${name}`;
        pins.set(id, { name, version: textTerm(value.version), integrity: stringTerm(value.integrity), resolved: stringTerm(value.resolved) });
        walk(value.dependencies, id);
      }
    };
    walk(doc.dependencies);
  } else {
    refuse("npm lockfile has neither packages nor dependencies pins", "invalid_lockfile");
  }
  if (pins.size > 8_000) refuse("lockfile exceeds pin ceiling", "input_too_large");
  return pins;
}

function comparePins(beforeDoc, afterDoc) {
  const before = pinMap(beforeDoc);
  const after = pinMap(afterDoc);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const counts = { beforePins: before.size, afterPins: after.size, added: 0, removed: 0, changed: 0, unchanged: 0, missingIntegrity: 0 };
  for (const id of ids) {
    const left = before.get(id);
    const right = after.get(id);
    if (!left) counts.added += 1;
    else if (!right) counts.removed += 1;
    else if (PIN_FIELDS.every((key) => textTerm(left[key]) === textTerm(right[key]))) counts.unchanged += 1;
    else counts.changed += 1;
    if ((left && !left.integrity) || (right && !right.integrity)) counts.missingIntegrity += 1;
  }
  const hasDelta = counts.added + counts.removed + counts.changed > 0;
  return { status: counts.missingIntegrity > 0 ? "partial" : hasDelta ? "actionable" : "informational", counts };
}

function normalizeTerms(job) {
  const terms = job.terms;
  if (!terms || typeof terms !== "object" || Array.isArray(terms)) {
    refuse("job.terms is required", "invalid_job");
  }
  const required = ["network", "asset", "recipient", "amountCapAtomic", "assetName", "assetVersion", "maxTimeoutSeconds", "requiredOutput"];
  const missing = required.filter((key) => terms[key] == null);
  if (missing.length) refuse(`job.terms missing ${missing.join(", ")}`, "invalid_job", { missing });
  const invalid = (message) => refuse(message, "invalid_terms");
  if (required.some((key) => key !== "maxTimeoutSeconds" && key !== "requiredOutput" && typeof terms[key] !== "string")) invalid("priced terms must use explicit string values");
  if (!/^eip155:\d+$/.test(terms.network.trim())) invalid("invalid EVM network");
  if (!/^0x[0-9a-fA-F]{40}$/.test(terms.asset) || !/^0x[0-9a-fA-F]{40}$/.test(terms.recipient)) invalid("asset and recipient must be EVM addresses");
  if (!/^[1-9]\d{0,77}$/.test(terms.amountCapAtomic) || BigInt(terms.amountCapAtomic) >= 2n ** 256n) invalid("amount cap must be a positive uint256 decimal string");
  if (!terms.assetName.trim() || !terms.assetVersion.trim()) invalid("explicit token signing domain is required");
  if (!Number.isSafeInteger(terms.maxTimeoutSeconds) || terms.maxTimeoutSeconds < 1 || terms.maxTimeoutSeconds > 300) invalid("timeout must be an integer from 1 to 300");
  const output = terms.requiredOutput;
  if (!plain(output) || output.mediaType !== "application/json" || !Array.isArray(output.requiredFields)
    || !output.requiredFields.length || output.requiredFields.some((field) => typeof field !== "string" || !field)
    || !Number.isSafeInteger(output.maxResponseBytes) || output.maxResponseBytes < 1 || output.maxResponseBytes > 160 * 1024) invalid("bounded JSON output terms are required");
  return {
    network: terms.network.trim(),
    asset: terms.asset.toLowerCase(),
    recipient: terms.recipient.toLowerCase(),
    amountCapAtomic: terms.amountCapAtomic,
    assetName: terms.assetName,
    assetVersion: terms.assetVersion,
    maxTimeoutSeconds: terms.maxTimeoutSeconds,
    requiredOutput: { ...output, requiredFields: [...new Set(output.requiredFields)].sort() },
  };
}

export function prepareJob({ jobPath, stateDir }) {
  const absoluteJob = resolve(jobPath);
  const job = readJson(absoluteJob, "job");
  if (job.schema !== JOB_SCHEMA) refuse(`job.schema must be ${JOB_SCHEMA}`, "invalid_job");
  if (typeof job.jobId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(job.jobId)) {
    refuse("jobId must be a stable 3-128 character identifier", "invalid_job");
  }
  if (job.approve === true || job.autoPurchase === true || job.permissionToSign === true) {
    refuse("scheduled job input cannot carry approval or auto-purchase authority", "embedded_approval_refused");
  }
  const method = String(job.route?.method || "").toUpperCase();
  const url = String(job.route?.url || "");
  if (method !== LIVE_METHOD || url !== LIVE_URL) {
    refuse(`route must be exact ${LIVE_METHOD} ${LIVE_URL}`, "route_mismatch", { method, url });
  }
  const base = dirname(absoluteJob);
  const previousPath = resolve(base, String(job.inputs?.previous || ""));
  const currentPath = resolve(base, String(job.inputs?.current || ""));
  const previousBytes = boundedRead(previousPath, MAX_LOCKFILE_BYTES);
  const currentBytes = boundedRead(currentPath, MAX_LOCKFILE_BYTES);
  const previous = classifyLockfile(previousPath, previousBytes.toString("utf8"));
  const current = classifyLockfile(currentPath, currentBytes.toString("utf8"));
  if (!RUNTIME_FORMATS.includes(previous.format) || !RUNTIME_FORMATS.includes(current.format)) {
    refuse("lockfile format is not advertised by the runtime", "unsupported_format");
  }
  const comparison = comparePins(previous.doc, current.doc);
  const body = { before: previous.doc, after: current.doc };
  const bodyRaw = JSON.stringify(body);
  if (Buffer.byteLength(bodyRaw) > MAX_REQUEST_BYTES) refuse("request exceeds byte ceiling", "input_too_large");
  const terms = normalizeTerms(job);
  const request = { method, url, bodySha256: sha256(bodyRaw) };
  const source = {
    previous: { path: job.inputs.previous, bytes: previousBytes.length, sha256: sha256(previousBytes), format: previous.format },
    current: { path: job.inputs.current, bytes: currentBytes.length, sha256: sha256(currentBytes), format: current.format },
  };
  const termsSha256 = sha256(JSON.stringify(terms));
  const intentId = sha256(JSON.stringify({ schema: INTENT_SCHEMA, jobId: job.jobId, request, source, termsSha256 }));
  const resumeId = sha256(`cw02-resume-v1\0${intentId}`);
  const intentDir = resolve(stateDir, "intents", intentId);
  const authorizationPath = join(intentDir, "authorization.json");
  const statePath = join(intentDir, "state.json");
  const attemptReceiptPath = join(intentDir, "attempt-receipt.json");
  const authorization = { method, url, ...terms, body };
  const intent = {
    schema: INTENT_SCHEMA,
    jobId: job.jobId,
    intentId,
    resumeId,
    request,
    source,
    termsSha256,
    analysis: comparison.status,
    counts: comparison.counts,
    authorizationPath,
    attemptReceiptPath,
  };
  atomicWrite(join(intentDir, "intent.json"), intent);
  atomicWrite(authorizationPath, authorization);
  if (!existsSync(statePath)) {
    atomicWrite(statePath, { schema: "pilot.cw02.repeat-lockfile.state.v1", jobId: job.jobId, intentId, resumeId, phase: "prepared", attemptReceiptPath });
  }
  return { intent, statePath, intentDir, authorization };
}

export function approvalTemplate(intent) {
  return {
    schema: APPROVAL_SCHEMA,
    jobId: intent.jobId,
    intentId: intent.intentId,
    permissionToSign: false,
    request: intent.request,
    termsSha256: intent.termsSha256,
    approvedAt: null,
    approvedBy: null,
  };
}

export function assertApproval(intent, approval) {
  if (approval?.schema !== APPROVAL_SCHEMA) refuse(`approval.schema must be ${APPROVAL_SCHEMA}`, "approval_refused");
  if (approval.permissionToSign !== true) refuse("approval must say permissionToSign: true", "approval_refused");
  if (typeof approval.approvedAt !== "string" || !/^\d{4}-\d\d-\d\dT/.test(approval.approvedAt) || !Number.isFinite(Date.parse(approval.approvedAt)) || typeof approval.approvedBy !== "string" || !approval.approvedBy.trim()) refuse("approval must name a valid timestamp and operator", "approval_refused");
  if (approval.jobId !== intent.jobId) refuse("approval belongs to a different job", "approval_stale");
  if (approval.termsSha256 !== intent.termsSha256) {
    refuse("priced terms changed; a new approval is required", "terms_changed");
  }
  if (JSON.stringify(approval.request) !== JSON.stringify(intent.request)) {
    refuse("route or body changed after approval", "request_changed");
  }
  if (approval.intentId !== intent.intentId) refuse("approval belongs to a different job intent", "approval_stale");
  return true;
}

// The generic maintained buyer proves transport/payment boundaries. This binder
// additionally proves the returned product and pin evidence match its approved job.
export function validateDelivery(body, authorization) {
  const invalid = (message) => refuse(message, "invalid_delivery");
  if (!plain(body) || body.ok !== true || body.charged !== true || body.transport !== "ok"
    || body.product !== "samedaydesk-lockfile-pin-delta"
    || body.schemaVersion !== "samedaydesk.lockfile-pin-delta-http.v0") invalid("response is not the approved paid lockfile product");
  if (Buffer.byteLength(JSON.stringify(body)) > authorization.requiredOutput.maxResponseBytes) invalid("response exceeds approved output ceiling");
  if (!/^[1-9]\d*$/.test(body.quote?.amountAtomic || "") || BigInt(body.quote.amountAtomic) > BigInt(authorization.amountCapAtomic)) invalid("response quote exceeds approved cap");
  const engine = body.engine;
  const comparison = comparePins(authorization.body.before, authorization.body.after);
  if (!plain(engine) || engine.schema !== "samedaydesk.lockfile-pin-delta.v1" || engine.appId !== "lockfile-pin-delta"
    || engine.ok !== true || engine.equality !== "pin-fields" || engine.purchaseAuthority !== false || engine.paidValueClaim !== false
    || body.analysis !== comparison.status || engine.status !== comparison.status
    || engine.lockfileVersion?.before !== authorization.body.before.lockfileVersion || engine.lockfileVersion?.after !== authorization.body.after.lockfileVersion
    || !Array.isArray(engine.gaps) || (comparison.status === "partial" && !engine.gaps.length)
    || body.digest !== sha256(JSON.stringify(engine) + "\n")) invalid("engine contract or digest does not match the approved comparison");
  for (const [field, value] of Object.entries(comparison.counts)) if (engine.counts?.[field] !== value) invalid("engine counts do not match approved pins");
  const before = pinMap(authorization.body.before), after = pinMap(authorization.body.after);
  const expected = { added: [], removed: [], changed: [] };
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    if (!before.has(id)) expected.added.push(id);
    else if (!after.has(id)) expected.removed.push(id);
    else if (PIN_FIELDS.some((key) => textTerm(before.get(id)[key]) !== textTerm(after.get(id)[key]))) expected.changed.push(id);
  }
  const checkPin = (pin, id, source) => {
    if (!plain(pin) || pin.id !== id || PIN_FIELDS.some((field) => pin[field] !== source[field])) invalid("returned pin does not match authorized input");
    const terms = Object.fromEntries([...PIN_FIELDS].sort().map((key) => [key, key === "integrity" ? source[key] : textTerm(source[key])]));
    const resolved = source.resolved;
    const fragment = resolved?.slice(resolved.lastIndexOf("#") + 1);
    const gitCommit = resolved && /(?:^git\+|github:|\.git(?:#|$))/i.test(resolved) && resolved.includes("#") && /^[0-9a-f]{7,40}$/i.test(fragment) ? fragment.toLowerCase() : null;
    if (pin.termsHash !== sha256(JSON.stringify(terms)) || pin.missingIntegrity !== (source.integrity === null) || pin.gitCommit !== gitCommit) invalid("returned pin metadata does not match authorized input");
  };
  for (const kind of ["added", "removed", "changed"]) {
    const rows = engine[kind], ids = expected[kind];
    if (!Array.isArray(rows) || rows.length !== ids.length) invalid("returned evidence is incomplete or unrelated");
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index], row = rows[index];
      if (kind !== "changed") checkPin(row, id, (kind === "added" ? after : before).get(id));
      else {
        if (row?.id !== id || row.name !== (after.get(id).name || before.get(id).name)) invalid("changed pin identity mismatch");
        checkPin(row.before, id, before.get(id)); checkPin(row.after, id, after.get(id));
        const changedFields = PIN_FIELDS.filter((key) => textTerm(before.get(id)[key]) !== textTerm(after.get(id)[key]));
        if (JSON.stringify(row.changeKinds) !== JSON.stringify(changedFields)) invalid("changed fields mismatch");
      }
    }
  }
  return comparison.status;
}

function runChild(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    let stdout = "", stderr = "", bytes = 0, limitExceeded = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 90_000);
    const collect = (which, chunk) => {
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > 2 * 1024 * 1024) { limitExceeded = true; child.kill("SIGKILL"); return; }
      if (which === "stdout") stdout += chunk; else stderr += chunk;
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.once("error", (error) => { clearTimeout(timer); rejectRun(error); });
    child.once("close", (code, signal) => { clearTimeout(timer); resolveRun({ code, signal, stdout, stderr, limitExceeded, timedOut }); });
  });
}

export async function executeJob({ jobPath, stateDir, approvalPath, approve, privateKeyEnv, customerCli = DEFAULT_CUSTOMER_CLI, env = process.env }) {
  const prepared = prepareJob({ jobPath, stateDir });
  const { intent } = prepared;
  if (approve !== true) refuse("execution requires the separate --approve switch", "approval_refused");
  if (typeof privateKeyEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(privateKeyEnv)) refuse("execution requires --private-key-env <ENV_VAR>", "approval_refused");
  const approval = readJson(resolve(approvalPath), "approval");
  assertApproval(intent, approval);
  const state = readJson(prepared.statePath, "state");
  if (existsSync(intent.attemptReceiptPath) || state.phase !== "prepared") {
    refuse("this intended job may already have signed or sent; keep its resumeId and reconcile instead of paying again", "resume_required", {
      intentId: intent.intentId,
      resumeId: intent.resumeId,
      attemptReceiptPath: intent.attemptReceiptPath,
      phase: state.phase,
    });
  }
  if (!existsSync(resolve(customerCli))) {
    refuse("maintained customer-x402 CLI not found; pass its exact path with --customer-cli", "maintained_cli_missing", { customerCli: resolve(customerCli) });
  }
  // A permanent single-flight lock precedes wallet loading/signing in the child.
  // Unknown outcomes must be reconciled; there is deliberately no auto-unlock.
  try {
    const lock = openSync(join(prepared.intentDir, "dispatch.lock"), "wx", 0o600);
    closeSync(lock);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    refuse("this intent already has an execution owner; reconcile its original identity", "resume_required", { intentId: intent.intentId, resumeId: intent.resumeId, attemptReceiptPath: intent.attemptReceiptPath });
  }
  atomicWrite(prepared.statePath, { ...state, phase: "dispatching" });
  const result = await runChild(process.execPath, [resolve(customerCli), "--approve", "--authorization", intent.authorizationPath, "--private-key-env", privateKeyEnv, "--attempt-receipt", intent.attemptReceiptPath], {
    cwd: dirname(resolve(customerCli)),
    env,
  });
  let payload = null;
  for (const candidate of [result.stdout.trim(), result.stderr.trim()]) {
    if (!candidate) continue;
    try { payload = JSON.parse(candidate); break; } catch { /* try a single-line payload next */ }
  }
  if (!payload) {
    for (const line of `${result.stdout}\n${result.stderr}`.split(/\r?\n/).filter(Boolean).reverse()) {
      try { payload = JSON.parse(line); break; } catch { /* keep scanning */ }
    }
  }
  if (payload?.outcome === "valid_delivered" && result.code === 0 && !result.limitExceeded && !result.timedOut) {
    try {
      if (!existsSync(intent.attemptReceiptPath)) refuse("paid result has no retained attempt identity", "invalid_delivery");
      const analysis = validateDelivery(payload.evidence?.retainedBody, prepared.authorization);
      if (analysis === "partial") {
        payload = { ...payload, ok: false, outcome: "partial_delivered", binderValidation: "matched-partial-pin-evidence" };
        result.code = 2;
      } else payload = { ...payload, binderValidation: "matched-approved-pin-evidence" };
    } catch (error) {
      payload = { ...payload, ok: false, outcome: "paid_invalid_output", binderValidation: error.message };
      result.code = 2;
    }
    // Never forward a generic valid_delivered line after rejecting its evidence.
    result.stdout = JSON.stringify(payload) + "\n";
    result.stderr = "";
  } else if (result.limitExceeded || result.timedOut || payload?.outcome === "valid_delivered") {
    payload = { ok: false, outcome: "unknown", message: "maintained CLI did not complete cleanly within execution bounds; reconcile original attempt" };
    result.code = 2; result.stdout = ""; result.stderr = JSON.stringify(payload) + "\n";
  }
  if (payload?.outcome !== "valid_delivered") result.code = 2;
  const phase = existsSync(intent.attemptReceiptPath)
    ? (["valid_delivered", "partial_delivered"].includes(payload?.outcome) ? "response_observed" : "resume_required")
    : "failed_before_identity";
  atomicWrite(prepared.statePath, { ...state, phase, childExitCode: result.code, outcome: payload?.outcome || "unknown" });
  return { ...result, payload, intent, phase };
}

export function readApproval(path) {
  return readJson(resolve(path), "approval");
}
