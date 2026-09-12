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
import { compareLockfileTexts } from "./vendor/lockfile-pin-delta/lib/compare.mjs";
import { CliRefuse } from "./vendor/lockfile-pin-delta/lib/errors.mjs";
import { toMarkdown } from "./vendor/lockfile-pin-delta/lib/format.mjs";
import { looksLikeHtml, parseLockfileText } from "./vendor/lockfile-pin-delta/lib/parse-lockfile.mjs";
import {
  DEFAULT_LOCKFILE_PIN_DELTA_PRICE_USD,
  LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC,
  LOCKFILE_PIN_DELTA_CATALOG_SHA,
  LOCKFILE_PIN_DELTA_DESCRIPTION,
  LOCKFILE_PIN_DELTA_ENGINE_PATH,
  LOCKFILE_PIN_DELTA_ENGINE_REPO,
  LOCKFILE_PIN_DELTA_ENGINE_SCHEMA,
  LOCKFILE_PIN_DELTA_ENGINE_SHA,
  LOCKFILE_PIN_DELTA_MAX_LOCKFILE_BYTES,
  LOCKFILE_PIN_DELTA_MAX_PINS,
  LOCKFILE_PIN_DELTA_MAX_REQUEST_BYTES,
  LOCKFILE_PIN_DELTA_METHOD,
  LOCKFILE_PIN_DELTA_PATH,
  LOCKFILE_PIN_DELTA_PAYMENT_PROTOCOLS,
  LOCKFILE_PIN_DELTA_PRICE_DISPLAY,
  LOCKFILE_PIN_DELTA_PRICE_USD,
  LOCKFILE_PIN_DELTA_PRODUCT,
  LOCKFILE_PIN_DELTA_QUOTE_MEANING,
  LOCKFILE_PIN_DELTA_SCHEMA_VERSION,
  LOCKFILE_PIN_DELTA_WORKER_KILL_GRACE_MS,
  isLockfilePinDeltaEnabled,
  isLockfilePinDeltaPath,
  lockfilePinDeltaCostParameters,
  lockfilePinDeltaLimits,
  lockfilePinDeltaPrice,
} from "./lockfile-pin-delta-config.mjs";

export {
  DEFAULT_LOCKFILE_PIN_DELTA_PRICE_USD,
  LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC,
  LOCKFILE_PIN_DELTA_DESCRIPTION,
  LOCKFILE_PIN_DELTA_ENGINE_SHA,
  LOCKFILE_PIN_DELTA_METHOD,
  LOCKFILE_PIN_DELTA_PATH,
  LOCKFILE_PIN_DELTA_PAYMENT_PROTOCOLS,
  LOCKFILE_PIN_DELTA_PRICE_DISPLAY,
  LOCKFILE_PIN_DELTA_PRICE_USD,
  LOCKFILE_PIN_DELTA_PRODUCT,
  LOCKFILE_PIN_DELTA_QUOTE_MEANING,
  LOCKFILE_PIN_DELTA_SCHEMA_VERSION,
  isLockfilePinDeltaEnabled,
  isLockfilePinDeltaPath,
  lockfilePinDeltaCostParameters,
  lockfilePinDeltaLimits,
  lockfilePinDeltaPrice,
};

export const LOCKFILE_PIN_DELTA_READ_ONLY_POST = Object.freeze({
  method: LOCKFILE_PIN_DELTA_METHOD,
  path: LOCKFILE_PIN_DELTA_PATH,
  paymentProtocols: LOCKFILE_PIN_DELTA_PAYMENT_PROTOCOLS,
});

const ALLOWED_BODY_KEYS = Object.freeze(["before", "after"]);
const LIMIT_RAISE_KEYS = Object.freeze([
  "maxBytes", "maxJsonDepth", "maxJsonNodes", "maxPins", "timeoutMs",
  "maxRequestBytes", "maxOutputBytes", "maxLockfileBytes", "limits",
]);
const PATHISH_KEYS = Object.freeze(["path", "file", "filename", "filepath", "outDir", "out-dir"]);
const merchantRoot = dirname(fileURLToPath(import.meta.url));
const defaultWorkerPath = join(merchantRoot, "lockfile-pin-delta-worker.mjs");
const ownedWorkers = new Set();

function readVendorLockfileFixture(rel) {
  return Object.freeze(JSON.parse(readFileSync(join(merchantRoot, "vendor/lockfile-pin-delta/fixtures", rel), "utf8")));
}
const JOURNEY_BEFORE = readVendorLockfileFixture("journey/before.json");
const JOURNEY_AFTER = readVendorLockfileFixture("journey/after.json");

export const LOCKFILE_PIN_DELTA_DISCOVERY_INPUT = Object.freeze({
  before: JOURNEY_BEFORE,
  after: JOURNEY_AFTER,
});

export class LockfilePinDeltaInputError extends Error {
  constructor(message, { status = 400, code = "invalid_lockfile_input" } = {}) {
    super(message);
    this.name = "LockfilePinDeltaInputError";
    this.status = status;
    this.code = code;
  }
}

function inputError(message, status = 400, code = "invalid_lockfile_input") {
  throw new LockfilePinDeltaInputError(message, { status, code });
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
    || /(?:^|\/)package-lock\.json$/i.test(value)
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
  if (typeof object.command === "string" || Array.isArray(object.argv) || typeof object.shell === "string") {
    inputError("arbitrary commands are not accepted", 400, "command_input");
  }
  if (object.fetch === true || object.network === true || looksLikeUrl(object.url) || looksLikeUrl(object.href)) {
    inputError(`${role} URL dereference is not accepted`, 400, "url_input");
  }
}

function admitLockfileValue(value, role, limits) {
  if (value === undefined || value === null) inputError(`${role} is required`);
  if (typeof value === "string") {
    if (looksLikeHtml(value)) inputError(`${role} is HTML, not a package-lock.json`, 400, "html-input");
    if (looksLikePath(value) || looksLikeUrl(value)) {
      inputError(`${role} must be a supplied JSON lockfile, not a filesystem path or URL`, 400, "filesystem_input");
    }
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      inputError(`${role} is not JSON: ${error.message}`, 400, "parse-error");
    }
    return admitLockfileValue(parsed, role, limits);
  }
  if (typeof value !== "object" || Array.isArray(value) || Buffer.isBuffer(value)) {
    inputError(`${role} must be a JSON object`);
  }
  rejectControlSurface(value, role);
  walkJsonGraph(value, limits, role);
  const text = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(text, "utf8") > limits.maxLockfileBytes) {
    inputError(`${role} exceeds server lockfile ceiling ${limits.maxLockfileBytes}`, 413, "payload_too_large");
  }
  let extracted;
  try {
    extracted = parseLockfileText(text, { label: role });
  } catch (error) {
    if (error instanceof CliRefuse) {
      inputError(error.message, 400, error.code);
    }
    throw error;
  }
  if (extracted.doc?.name === "SAMPLE") {
    inputError("SAMPLE lockfile cannot be emitted as a customer pin delta", 400, "sample-as-customer-delta");
  }
  if (extracted.pins.length > limits.maxPins) {
    inputError(`${role} exceeds server pin ceiling ${limits.maxPins}`, 413, "pin_limit");
  }
  return Object.freeze({ text, extracted });
}

const LOCKFILE_PAYMENT_CREDENTIAL_HEADERS = Object.freeze([
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
  if (LOCKFILE_PAYMENT_CREDENTIAL_HEADERS.some((name) => headerPresent(headers, name))) return true;
  if (!headerPresent(headers, "authorization")) return false;
  const authorization = req.get?.("authorization") || headers.authorization || headers.Authorization || "";
  if (String(authorization).trim() === "") return true;
  return hasMppPaymentAuthorizationForPreflight(headers);
}

export function isLockfileUnsignedDiscoveryProbe(req) {
  if (requestHasPaymentCredential(req)) return false;
  const body = req?.body;
  if (body === undefined) return true;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  return Object.keys(body).length === 0;
}

export function admitLockfilePinDeltaRequest(body, limits = lockfilePinDeltaLimits()) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    inputError("request body must be a JSON object");
  }
  rejectControlSurface(body, "request");
  const extra = extraKeys(body, ALLOWED_BODY_KEYS);
  if (extra.length) inputError(`unexpected field: ${extra[0]}`);
  const before = admitLockfileValue(body.before, "before", limits);
  const after = admitLockfileValue(body.after, "after", limits);
  return Object.freeze({ before, after, limits });
}

export function normalizeLockfilePinDeltaInput(body, limits = lockfilePinDeltaLimits()) {
  const admitted = admitLockfilePinDeltaRequest(body, limits);
  return Object.freeze({
    before: admitted.before.extracted.doc,
    after: admitted.after.extracted.doc,
  });
}

export function lockfilePinDeltaQuote(env = process.env) {
  const price = lockfilePinDeltaPrice(env);
  return Object.freeze({
    amountAtomic: price.amountAtomic,
    displayUsdc: price.displayUsdc,
    meaning: LOCKFILE_PIN_DELTA_QUOTE_MEANING,
  });
}

export function lockfilePinDeltaBoundary() {
  return Object.freeze({
    filesystemInput: false,
    networkFetch: false,
    arbitraryCommand: false,
    npmInstall: false,
    registryFetch: false,
    soldFlag: false,
    purchaseAuthority: false,
    npmAudit: false,
  });
}

export function engineProvenance() {
  return Object.freeze({
    repo: LOCKFILE_PIN_DELTA_ENGINE_REPO,
    sha: LOCKFILE_PIN_DELTA_ENGINE_SHA,
    path: LOCKFILE_PIN_DELTA_ENGINE_PATH,
    catalogSha: LOCKFILE_PIN_DELTA_CATALOG_SHA,
  });
}

function publicEngineReport(report) {
  return {
    schema: report.schema,
    appId: report.appId,
    ok: report.ok === true,
    status: report.status,
    purchaseAuthority: false,
    paidValueClaim: false,
    settlement: "nonsettling-prototype",
    equality: report.equality,
    lockfileVersion: report.lockfileVersion,
    mapSource: report.mapSource,
    counts: report.counts,
    added: report.added,
    removed: report.removed,
    changed: report.changed,
    gaps: report.gaps,
  };
}

function sha256Json(value) {
  return createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex");
}

function trimDeltaLists(engine, maxResponseBytes) {
  const clone = structuredClone(engine);
  const fit = () => Buffer.byteLength(JSON.stringify(clone), "utf8") <= maxResponseBytes;
  if (fit()) return { engine: clone, truncated: false };
  clone.added = [];
  clone.removed = [];
  clone.changed = [];
  clone.gaps = [...(engine.gaps || []), "delta lists omitted to keep the paid response replayable within its byte ceiling"];
  return { engine: clone, truncated: true };
}

export function formatLockfilePinDeltaResult(report, {
  charged = true,
  transport = "ok",
  wallMs = null,
  admittedBodyBytes = null,
  limits = lockfilePinDeltaLimits(),
  env = process.env,
} = {}) {
  const analysis = report?.status || "not-run";
  const trimmed = report ? trimDeltaLists(publicEngineReport(report), Math.floor(limits.maxResponseBytes * 0.7)) : { engine: null, truncated: false };
  const markdown = report && !trimmed.truncated ? toMarkdown(publicEngineReport(report)) : null;
  const markdownFits = markdown && Buffer.byteLength(markdown, "utf8") <= limits.maxMarkdownBytes;
  const quote = lockfilePinDeltaQuote(env);
  const result = {
    ok: charged && transport === "ok" && Boolean(report) && report.ok === true,
    product: LOCKFILE_PIN_DELTA_PRODUCT,
    schemaVersion: LOCKFILE_PIN_DELTA_SCHEMA_VERSION,
    quote,
    charged,
    analysis,
    transport,
    engine: trimmed.engine,
    markdown: markdownFits ? markdown : null,
    markdownOmitted: Boolean(report) && !markdownFits,
    digest: trimmed.engine ? sha256Json(trimmed.engine) : null,
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
    boundary: lockfilePinDeltaBoundary(),
    limits: {
      maxRequestBytes: limits.maxRequestBytes,
      maxLockfileBytes: limits.maxLockfileBytes,
      timeoutMs: limits.timeoutMs,
      maxPins: limits.maxPins,
    },
  };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > limits.maxResponseBytes) {
    result.engine = result.engine ? {
      ...result.engine,
      added: [],
      removed: [],
      changed: [],
      gaps: [...(result.engine.gaps || []), "response truncated to replay ceiling"],
    } : null;
    result.markdown = null;
    result.markdownOmitted = true;
    result.digest = result.engine ? sha256Json(result.engine) : null;
  }
  return result;
}

export function compareAdmittedLockfiles(beforeText, afterText) {
  return compareLockfileTexts(beforeText, afterText);
}

export function resolveLockfileWorkerPath(env = process.env) {
  const raw = String(env.LOCKFILE_PIN_DELTA_WORKER_PATH || "").trim();
  if (!raw) return defaultWorkerPath;
  const resolved = resolve(raw);
  if (!resolved.startsWith(`${merchantRoot}${merchantRoot.endsWith("/") ? "" : "/"}`) && resolved !== merchantRoot) {
    throw new LockfilePinDeltaInputError("worker path must stay inside the merchant tree", { status: 500, code: "invalid_worker_path" });
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

export function ownedLockfileWorkerCount() {
  return ownedWorkers.size;
}

export function reapLockfileWorker(child, { graceMs = LOCKFILE_PIN_DELTA_WORKER_KILL_GRACE_MS } = {}) {
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

export function runLockfileCompareWorker({ beforeText, afterText, env = process.env, timeoutMs } = {}) {
  const limits = lockfilePinDeltaLimits(env);
  const budget = Math.min(timeoutMs ?? limits.timeoutMs, limits.timeoutMs);
  const workerPath = resolveLockfileWorkerPath(env);
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = trackWorker(spawn(process.execPath, [workerPath], {
      cwd: merchantRoot,
      env: { ...process.env, ...env, LOCKFILE_PIN_DELTA_WORKER: "1" },
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
      reapLockfileWorker(child).finally(() => reject(error));
    });
    child.stdin?.on("error", () => {});
    child.stderr?.resume();
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        fail(Object.assign(new Error("lockfile worker output exceeded bound"), {
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
        fail(Object.assign(new Error("lockfile compare timeout"), { code: "timeout", transport: "timeout" }));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        fail(Object.assign(new Error("lockfile worker returned invalid JSON"), { code: "engine-crash", transport: "engine-crash" }));
        return;
      }
      if (code !== 0) {
        fail(Object.assign(new Error(`lockfile worker exited ${code} with${parsed?.ok === true && parsed.report ? " valid-looking stdout" : " a failure payload"}`), {
          code: "engine-crash",
          transport: "engine-crash",
        }));
        return;
      }
      if (parsed?.ok === true && parsed.report) {
        succeed(parsed.report);
        return;
      }
      if (parsed?.refused === true) {
        fail(Object.assign(new Error(parsed.error || "engine refused after admission"), {
          code: parsed.code || "engine-crash",
          transport: "engine-crash",
        }));
        return;
      }
      fail(Object.assign(new Error(parsed?.error || `lockfile worker failed (${code ?? signal})`), {
        code: parsed?.code || "engine-crash",
        transport: parsed?.code === "timeout" ? "timeout" : "engine-crash",
      }));
    });
    timeoutHandle = setTimeout(() => {
      fail(Object.assign(new Error("lockfile compare timeout"), { code: "timeout", transport: "timeout" }));
    }, budget);
    timeoutHandle.unref?.();
    try {
      child.stdin.end(JSON.stringify({ beforeText, afterText }));
    } catch (error) {
      fail(error);
    }
  });
}

export async function executeLockfilePinDelta({
  input,
  rawBody,
  env = process.env,
  inProcess = false,
} = {}) {
  const limits = lockfilePinDeltaLimits(env);
  const started = Date.now();
  const body = input || JSON.parse(Buffer.from(rawBody || "{}").toString("utf8") || "{}");
  const admitted = admitLockfilePinDeltaRequest(body, limits);
  const admittedBodyBytes = rawBody ? Buffer.byteLength(rawBody) : Buffer.byteLength(JSON.stringify({
    before: admitted.before.extracted.doc,
    after: admitted.after.extracted.doc,
  }));
  try {
    const report = inProcess
      ? compareLockfileTexts(admitted.before.text, admitted.after.text)
      : await runLockfileCompareWorker({
        beforeText: admitted.before.text,
        afterText: admitted.after.text,
        env,
        timeoutMs: limits.timeoutMs,
      });
    return formatLockfilePinDeltaResult(report, {
      charged: true,
      transport: "ok",
      wallMs: Date.now() - started,
      admittedBodyBytes,
      limits,
      env,
    });
  } catch (error) {
    if (error instanceof LockfilePinDeltaInputError) throw error;
    const transport = error?.transport || (error?.code === "timeout" ? "timeout" : "engine-crash");
    return formatLockfilePinDeltaResult(null, {
      charged: false,
      transport,
      wallMs: Date.now() - started,
      admittedBodyBytes,
      limits,
      env,
    });
  }
}

export function lockfilePinDeltaFailureDelivery() {
  return Object.freeze({
    status: 503,
    charged: false,
    owedDelivery: false,
  });
}

function unchargedError(res, error) {
  const status = error instanceof LockfilePinDeltaInputError ? error.status : 400;
  const code = error instanceof LockfilePinDeltaInputError ? error.code : "invalid_lockfile_input";
  res.set("Cache-Control", "no-store");
  return res.status(status).json({
    ok: false,
    product: LOCKFILE_PIN_DELTA_PRODUCT,
    schemaVersion: LOCKFILE_PIN_DELTA_SCHEMA_VERSION,
    error: error instanceof LockfilePinDeltaInputError ? error.message : "invalid lockfile pin-delta request",
    code,
    charged: false,
    analysis: "not-run",
    transport: "rejected",
    boundary: lockfilePinDeltaBoundary(),
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
      finish(new LockfilePinDeltaInputError("request timeout", { status: 408, code: "request_timeout" }));
      req.pause();
    }, timeoutMs);
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        req.pause();
        finish(new LockfilePinDeltaInputError(`request exceeds server byte ceiling ${maxBytes}`, { status: 413, code: "payload_too_large" }));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(null, Buffer.concat(chunks, size));
    const onError = (error) => finish(error);
    const onAborted = () => finish(new LockfilePinDeltaInputError("request aborted", { status: 400, code: "request_aborted" }));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

export function mountLockfilePinDeltaParser(app, { env = process.env } = {}) {
  if (!isLockfilePinDeltaEnabled(env)) return app;
  const limits = lockfilePinDeltaLimits(env);
  app.post(LOCKFILE_PIN_DELTA_PATH, async (req, res, next) => {
    try {
      const raw = await readBoundedJsonBody(req, { maxBytes: limits.maxRequestBytes, timeoutMs: limits.timeoutMs });
      req.rawBody = raw;
      if (!raw.length) {
        req.body = {};
        return next();
      }
      if (!isJsonContentType(req)) {
        return unchargedError(res, new LockfilePinDeltaInputError("Content-Type must be application/json", { status: 415, code: "unsupported_media_type" }));
      }
      try {
        req.body = JSON.parse(raw.toString("utf8"));
      } catch (error) {
        return unchargedError(res, new LockfilePinDeltaInputError(`request is not JSON: ${error.message}`, { status: 400, code: "parse-error" }));
      }
      return next();
    } catch (error) {
      return unchargedError(res, error instanceof LockfilePinDeltaInputError ? error : new LockfilePinDeltaInputError(String(error?.message || error)));
    }
  });
  return app;
}

export function validateLockfilePinDeltaRequest(req, res, next) {
  if (req.method !== LOCKFILE_PIN_DELTA_METHOD || !isLockfilePinDeltaPath(req.path)) return next();
  try {
    if (isLockfileUnsignedDiscoveryProbe(req)) {
      res.set("X-SameDayDesk-Paid-Effect", "read_only");
      res.set("X-SameDayDesk-Paid-Effect-Profile", "/.well-known/paid-action-effects.json");
      res.set("X-SameDayDesk-Lockfile-Pin-Delta", "enabled");
      return next();
    }
    res.locals.lockfilePinDeltaInput = admitLockfilePinDeltaRequest(req.body);
    if (hasMppPaymentAuthorizationForPreflight(req.headers)) {
      return unchargedError(res, new LockfilePinDeltaInputError(
        "POST /lockfile-pin-delta accepts x402 only. Do not send an MPP Authorization. Retry unpaid for x402 Payment-Required.",
        { status: 400, code: "mpp_not_accepted" },
      ));
    }
    res.set("X-SameDayDesk-Paid-Effect", "read_only");
    res.set("X-SameDayDesk-Paid-Effect-Profile", "/.well-known/paid-action-effects.json");
    res.set("X-SameDayDesk-Lockfile-Pin-Delta", "enabled");
    return next();
  } catch (error) {
    return unchargedError(res, error instanceof LockfilePinDeltaInputError ? error : new LockfilePinDeltaInputError("invalid lockfile pin-delta request"));
  }
}

export async function serveLockfilePinDelta(req, res) {
  res.set("Cache-Control", "no-store");
  res.set("X-SameDayDesk-Lockfile-Pin-Delta", "enabled");
  const failHttp = (result, transport) => {
    const delivery = lockfilePinDeltaFailureDelivery();
    result.charged = delivery.charged;
    result.analysis = "not-run";
    result.error = transport === "timeout" ? "lockfile_compare_timeout" : "lockfile_engine_failed";
    return res.status(delivery.status).json(result);
  };
  try {
    const result = await executeLockfilePinDelta({
      input: req.body,
      rawBody: req.rawBody,
    });
    if (result.transport !== "ok") return failHttp(result, result.transport);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof LockfilePinDeltaInputError) return unchargedError(res, error);
    const result = formatLockfilePinDeltaResult(null, {
      charged: false,
      transport: "internal-error",
      admittedBodyBytes: req.rawBody ? Buffer.byteLength(req.rawBody) : null,
    });
    return failHttp(result, result.transport);
  }
}

export function lockfilePinDeltaResource({ publicUrl, env = process.env } = {}) {
  const price = lockfilePinDeltaPrice(env);
  return {
    url: `${publicUrl}${LOCKFILE_PIN_DELTA_PATH}`,
    method: LOCKFILE_PIN_DELTA_METHOD,
    amount: price.amountAtomic,
    description: LOCKFILE_PIN_DELTA_DESCRIPTION,
    mimeType: "application/json",
  };
}

export function lockfilePinDeltaInputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["before", "after"],
    properties: {
      before: {
        type: "object",
        description: "npm package-lock.json object with lockfileVersion 2 or 3. Not a filesystem path, URL, or command.",
      },
      after: {
        type: "object",
        description: "npm package-lock.json object with lockfileVersion 2 or 3. Not a filesystem path, URL, or command.",
      },
    },
  };
}

export function lockfilePinDeltaOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "ok", "product", "schemaVersion", "quote", "charged", "analysis", "transport",
      "engine", "digest", "engineProvenance", "costInputs", "boundary", "limits",
    ],
    properties: {
      ok: { type: "boolean" },
      product: { type: "string", const: LOCKFILE_PIN_DELTA_PRODUCT },
      schemaVersion: { type: "string", const: LOCKFILE_PIN_DELTA_SCHEMA_VERSION },
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
      transport: { type: "string", enum: ["ok", "timeout", "engine-crash", "internal-error", "rejected"] },
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

export const lockfilePinDeltaMcpOutputSchema = z.object({
  ok: z.boolean(),
  product: z.literal(LOCKFILE_PIN_DELTA_PRODUCT),
  schemaVersion: z.literal(LOCKFILE_PIN_DELTA_SCHEMA_VERSION),
  quote: z.object({
    amountAtomic: z.string(),
    displayUsdc: z.string(),
    meaning: z.string(),
  }).strict(),
  charged: z.boolean(),
  analysis: z.enum(["actionable", "informational", "partial", "not-run"]),
  transport: z.enum(["ok", "timeout", "engine-crash", "internal-error", "rejected"]),
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

export function lockfilePinDeltaOutputExample() {
  const report = compareLockfileTexts(JSON.stringify(JOURNEY_BEFORE), JSON.stringify(JOURNEY_AFTER));
  return formatLockfilePinDeltaResult(report, {
    charged: true,
    transport: "ok",
    wallMs: 4,
    admittedBodyBytes: 900,
  });
}

export function lockfilePinDeltaX402Route({ network, payTo, extensions, env = process.env } = {}) {
  const price = lockfilePinDeltaPrice(env);
  const example = lockfilePinDeltaOutputExample();
  return {
    [`${LOCKFILE_PIN_DELTA_METHOD} ${LOCKFILE_PIN_DELTA_PATH}`]: {
      serviceName: "SameDayDesk",
      tags: ["lockfile", "npm", "pin-delta", "dependency-diff", "sbom"],
      iconUrl: BAZAAR_SERVICE_ICON_URL,
      accepts: [{ scheme: "exact", price: price.priceUsd, network, payTo }],
      description: LOCKFILE_PIN_DELTA_DESCRIPTION,
      mimeType: "application/json",
      extensions: {
        ...extensions,
        [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
        ...declareDiscoveryContract({
          routeKey: `${LOCKFILE_PIN_DELTA_METHOD} ${LOCKFILE_PIN_DELTA_PATH}`,
          method: LOCKFILE_PIN_DELTA_METHOD,
          bodyType: "json",
          input: LOCKFILE_PIN_DELTA_DISCOVERY_INPUT,
          inputSchema: lockfilePinDeltaInputSchema(),
          output: { example },
          outputSchema: lockfilePinDeltaOutputSchema(),
        }),
      },
    },
  };
}

export function lockfilePinDeltaOpenApiPath({ paymentInfo, env = process.env } = {}) {
  const price = lockfilePinDeltaPrice(env);
  return {
    post: {
      operationId: "compareLockfilePinDelta",
      tags: ["Agent Operations"],
      summary: LOCKFILE_PIN_DELTA_DESCRIPTION,
      requestBody: {
        required: true,
        content: { "application/json": { schema: lockfilePinDeltaInputSchema() } },
      },
      responses: {
        "200": {
          description: "bounded pin delta after a completed compare. analysis is actionable, informational (identical pins), or partial. HTTP 200 is not used for timeout, crash, oversized worker output, or nonzero worker exit.",
          content: { "application/json": { schema: lockfilePinDeltaOutputSchema() } },
        },
        "400": { description: "unsupported or malformed input, or an MPP credential on this x402-only route; charged nothing" },
        "402": { description: `payment required (x402 ${price.priceUsd} bounded compare). Initial live release does not accept MPP.` },
        "409": { description: "payment identifier already bound to a different request body, payer, credential, or payment terms" },
        "413": { description: "JSON request or lockfile exceeds the server byte ceiling; no authorization" },
        "415": { description: "Content-Type must be JSON" },
        "503": { description: "engine timeout, crash, oversized worker output, nonzero worker exit, or unresolved settlement. Not a successful compare. x402 execute-before-settle: HTTP >=400 cancels settlement (charged false). This route does not accept MPP and does not sell an owed-retry." },
      },
      "x-payment-info": paymentInfo,
    },
  };
}
