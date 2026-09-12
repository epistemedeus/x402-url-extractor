import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
  mkdirSync(dirname(path), { recursive: true });
  const next = `${path}.next-${process.pid}`;
  writeFileSync(next, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(next, path);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
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
    doc = JSON.parse(bytes);
  } catch {
    refuse("input is not a JSON npm package-lock", "unsupported_format", { path });
  }
  if (doc?.lockfileVersion !== 2 && doc?.lockfileVersion !== 3) {
    refuse("live route supports only npm package-lock lockfileVersion 2 or 3", "unsupported_format", { lockfileVersion: doc?.lockfileVersion ?? null });
  }
  return { doc, format: `npm-package-lock-v${doc.lockfileVersion}` };
}

function pinMap(doc) {
  const pins = new Map();
  if (doc.packages && typeof doc.packages === "object" && !Array.isArray(doc.packages)) {
    for (const [id, value] of Object.entries(doc.packages)) {
      if (!id || !value || typeof value !== "object" || value.link === true) continue;
      const marker = "node_modules/";
      const name = value.name || id.slice(id.lastIndexOf(marker) + marker.length);
      pins.set(id, { name, version: value.version ?? null, integrity: value.integrity ?? null, resolved: value.resolved ?? null });
    }
  } else if (doc.dependencies && typeof doc.dependencies === "object" && !Array.isArray(doc.dependencies)) {
    const walk = (dependencies, prefix = "") => {
      for (const [name, value] of Object.entries(dependencies || {})) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const id = prefix ? `${prefix}/node_modules/${name}` : `node_modules/${name}`;
        pins.set(id, { name, version: value.version ?? null, integrity: value.integrity ?? null, resolved: value.resolved ?? null });
        walk(value.dependencies, id);
      }
    };
    walk(doc.dependencies);
  } else {
    refuse("npm lockfile has neither packages nor dependencies pins", "invalid_lockfile");
  }
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
    else if (["name", "version", "integrity", "resolved"].every((key) => left[key] === right[key])) counts.unchanged += 1;
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
  return {
    network: String(terms.network),
    asset: String(terms.asset),
    recipient: String(terms.recipient),
    amountCapAtomic: String(terms.amountCapAtomic),
    assetName: String(terms.assetName),
    assetVersion: String(terms.assetVersion),
    maxTimeoutSeconds: Number(terms.maxTimeoutSeconds),
    requiredOutput: terms.requiredOutput,
  };
}

export function prepareJob({ jobPath, stateDir }) {
  const absoluteJob = resolve(jobPath);
  const job = readJson(absoluteJob, "job");
  if (job.schema !== JOB_SCHEMA) refuse(`job.schema must be ${JOB_SCHEMA}`, "invalid_job");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(String(job.jobId || ""))) {
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
  const previousBytes = readFileSync(previousPath);
  const currentBytes = readFileSync(currentPath);
  const previous = classifyLockfile(previousPath, previousBytes.toString("utf8"));
  const current = classifyLockfile(currentPath, currentBytes.toString("utf8"));
  if (!RUNTIME_FORMATS.includes(previous.format) || !RUNTIME_FORMATS.includes(current.format)) {
    refuse("lockfile format is not advertised by the runtime", "unsupported_format");
  }
  const comparison = comparePins(previous.doc, current.doc);
  const body = { before: previous.doc, after: current.doc };
  const bodyRaw = JSON.stringify(body);
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
  return { intent, statePath, intentDir };
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
  if (!approval.approvedAt || !approval.approvedBy) refuse("approval must name approvedAt and approvedBy", "approval_refused");
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

function runChild(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => resolveRun({ code, signal, stdout, stderr }));
  });
}

export async function executeJob({ jobPath, stateDir, approvalPath, approve, privateKeyEnv, customerCli = DEFAULT_CUSTOMER_CLI, env = process.env }) {
  const prepared = prepareJob({ jobPath, stateDir });
  const { intent } = prepared;
  if (!approve) refuse("execution requires the separate --approve switch", "approval_refused");
  if (!privateKeyEnv) refuse("execution requires --private-key-env <ENV_VAR>", "approval_refused");
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
  const phase = existsSync(intent.attemptReceiptPath)
    ? (payload?.outcome === "valid_delivered" ? "response_observed" : "resume_required")
    : "failed_before_identity";
  atomicWrite(prepared.statePath, { ...state, phase, childExitCode: result.code, outcome: payload?.outcome || "unknown" });
  return { ...result, payload, intent, phase };
}

export function readApproval(path) {
  return readJson(resolve(path), "approval");
}
