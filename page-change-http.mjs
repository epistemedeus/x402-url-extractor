import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_LIMITS } from "./examples/customer-x402/src/page-change/constants.mjs";
import { normalizeFields } from "./examples/customer-x402/src/page-change/fields.mjs";
import { isPlainObject } from "./examples/customer-x402/src/page-change/util.mjs";

export const PAGE_CHANGE_HTTP_PATH = "/recipes/page-change";
export const PAGE_CHANGE_HTTP_HEALTH_PATH = "/recipes/page-change/health";
export const PAGE_CHANGE_HTTP_OPENAPI_PATH = "/recipes/page-change/openapi.json";
export const XAGENT_VERIFICATION_PATH = "/.well-known/xagent-verification.json";

export const PAGE_CHANGE_HTTP_PRODUCT = "samedaydesk-page-change-http";
export const PAGE_CHANGE_HTTP_SCHEMA = "samedaydesk.page-change-http.v0";

const ALLOWED_BODY_KEYS = Object.freeze([
  "before",
  "after",
  "fields",
  "clock",
  "maxStaleMs",
  "allowFreshClaim",
]);
const ALLOWED_ENVELOPE_KEYS = Object.freeze(["mediaType", "body", "observedAt", "status"]);
const LIMIT_RAISE_KEYS = Object.freeze([
  "maxBytes",
  "maxJsonDepth",
  "maxJsonNodes",
  "maxHtmlTokens",
  "maxSequenceLength",
  "maxChanges",
  "maxExcerptBytes",
  "maxSources",
  "maxFields",
  "maxActionItems",
  "timeoutMs",
  "maxRequestBytes",
  "maxOutputBytes",
  "limits",
]);

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_REQUEST_BYTES = DEFAULT_LIMITS.maxBytes * 2 + 8_192;
const DEFAULT_MAX_OUTPUT_BYTES = 262_144;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const MAX_CONCURRENT = 2;
const MAX_RATE_KEYS = 1024;
const WORKER_KILL_GRACE_MS = 500;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const CLOCK_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const merchantRoot = dirname(fileURLToPath(import.meta.url));
const defaultWorkerPath = join(merchantRoot, "page-change-http-worker.mjs");

const ownedWorkers = new Set();
const rateWindows = new Map();
let activeRequests = 0;

export class PageChangeHttpError extends Error {
  constructor(message, { status = 400, code = "invalid_page_change_input" } = {}) {
    super(message);
    this.name = "PageChangeHttpError";
    this.status = status;
    this.code = code;
  }
}

export function isPageChangeHttpEnabled(env = process.env) {
  const raw = String(env.PAGE_CHANGE_HTTP_ENABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isPageChangeHttpPath(pathname) {
  // Express matches case-insensitively and permits a trailing slash by default.
  const path = String(pathname || "").split("?", 1)[0].toLowerCase().replace(/\/+$/, "");
  return path === PAGE_CHANGE_HTTP_PATH
    || path === PAGE_CHANGE_HTTP_HEALTH_PATH
    || path === PAGE_CHANGE_HTTP_OPENAPI_PATH
    || path === XAGENT_VERIFICATION_PATH;
}

function boundedCeiling(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > fallback) {
    throw new Error(`${name} must be an integer from 1 through ${fallback}`);
  }
  return value;
}

export function pageChangeHttpLimits(env = process.env) {
  return Object.freeze({
    maxBytes: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_BYTES", DEFAULT_LIMITS.maxBytes),
    maxJsonDepth: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_JSON_DEPTH", DEFAULT_LIMITS.maxJsonDepth),
    maxJsonNodes: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_JSON_NODES", DEFAULT_LIMITS.maxJsonNodes),
    maxHtmlTokens: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_HTML_TOKENS", DEFAULT_LIMITS.maxHtmlTokens),
    maxSequenceLength: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_SEQUENCE_LENGTH", DEFAULT_LIMITS.maxSequenceLength),
    maxChanges: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_CHANGES", DEFAULT_LIMITS.maxChanges),
    maxExcerptBytes: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_EXCERPT_BYTES", DEFAULT_LIMITS.maxExcerptBytes),
    maxSources: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_SOURCES", DEFAULT_LIMITS.maxSources),
    maxFields: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_FIELDS", DEFAULT_LIMITS.maxFields),
    maxActionItems: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_ACTION_ITEMS", DEFAULT_LIMITS.maxActionItems),
    timeoutMs: boundedCeiling(env, "PAGE_CHANGE_HTTP_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    maxRequestBytes: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_REQUEST_BYTES", DEFAULT_MAX_REQUEST_BYTES),
    maxOutputBytes: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_OUTPUT_BYTES", DEFAULT_MAX_OUTPUT_BYTES),
    maxConcurrent: boundedCeiling(env, "PAGE_CHANGE_HTTP_MAX_CONCURRENT", MAX_CONCURRENT),
    maxStaleMs: null,
  });
}

export function resolveSourceCommit(env = process.env) {
  const raw = String(env.PAGE_CHANGE_SOURCE_COMMIT || env.SOURCE_COMMIT || "").trim().toLowerCase();
  if (!raw) return { commit: null, commitStatus: "unavailable", reason: "missing_source_commit" };
  if (!COMMIT_PATTERN.test(raw)) {
    return { commit: null, commitStatus: "unavailable", reason: "invalid_source_commit" };
  }
  return { commit: raw, commitStatus: "available", reason: null };
}

export function pageChangeHttpHealth(env = process.env) {
  if (!isPageChangeHttpEnabled(env)) {
    return {
      ok: false,
      status: "disabled",
      enabled: false,
      product: PAGE_CHANGE_HTTP_PRODUCT,
      schemaVersion: PAGE_CHANGE_HTTP_SCHEMA,
      error: "page_change_http_disabled",
    };
  }
  const provenance = resolveSourceCommit(env);
  const body = {
    ok: true,
    status: "ok",
    enabled: true,
    product: PAGE_CHANGE_HTTP_PRODUCT,
    schemaVersion: PAGE_CHANGE_HTTP_SCHEMA,
    commitStatus: provenance.commitStatus,
  };
  if (provenance.commitStatus === "available") body.commit = provenance.commit;
  else {
    body.commit = null;
    body.reason = provenance.reason;
  }
  return body;
}

export function xagentVerification(env = process.env) {
  if (!isPageChangeHttpEnabled(env)) {
    return { ok: false, error: "xagent_verification_unavailable", reason: "page_change_http_disabled" };
  }
  const slug = String(env.PAGE_CHANGE_XAGENT_SLUG || "").trim();
  const source = resolveSourceCommit(env);
  const commitRaw = String(env.PAGE_CHANGE_XAGENT_COMMIT || source.commit || "").trim().toLowerCase();
  if (!slug || !COMMIT_PATTERN.test(commitRaw)) {
    return {
      ok: false,
      error: "xagent_verification_unavailable",
      reason: !slug ? "missing_slug" : "missing_or_invalid_commit",
    };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 || source.commit !== commitRaw) {
    return { ok: false, error: "xagent_verification_unavailable", reason: "invalid_slug_or_source_commit_mismatch" };
  }
  return {
    schemaVersion: 1,
    slug,
    commit: commitRaw,
  };
}

export function pageChangeHttpOpenApiExample() {
  return {
    openapi: "3.1.0",
    info: {
      title: "SameDayDesk page-change HTTP companion",
      version: PAGE_CHANGE_HTTP_SCHEMA,
      description: "Optional unpaid transform. Compares two already delivered batch JSON artifacts. Not a paid SKU. Disabled until PAGE_CHANGE_HTTP_ENABLED is set. Does not fetch, pay, or schedule a second observation.",
    },
    paths: {
      [PAGE_CHANGE_HTTP_PATH]: {
        post: {
          operationId: "postRecipesPageChange",
          summary: "Compare two supplied extract-batch artifacts for explicit fields.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: pageChangeHttpInputSchema(),
                example: {
                  before: { mediaType: "application/json", body: { product: "samedaydesk-extract-batch", sources: [] } },
                  after: { mediaType: "application/json", body: { product: "samedaydesk-extract-batch", sources: [] } },
                  fields: ["title", "description"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Page-change brief. Verdict may be changed, unchanged, reordered, incomplete, ambiguous, or incomparable.",
              content: { "application/json": { schema: pageChangeHttpOutputSchema() } },
            },
            "400": { description: "Invalid method payload, missing required fields, or attempted limit raise." },
            "404": { description: "Companion disabled." },
            "405": { description: "Method not allowed." },
            "408": { description: "Shared request/compare deadline expired; owned worker reaped." },
            "413": { description: "Request or comparison output exceeds server byte ceiling." },
            "415": { description: "Content-Type must be JSON." },
            "429": { description: "Rate limit exceeded." },
            "503": { description: "Global comparison capacity occupied; retry later." },
          },
        },
      },
      [PAGE_CHANGE_HTTP_HEALTH_PATH]: {
        get: {
          operationId: "getRecipesPageChangeHealth",
          summary: "Companion status. Source commit only when configured and valid.",
          responses: { "200": { description: "Enabled health." }, "404": { description: "Disabled." } },
        },
      },
    },
  };
}

export function pageChangeHttpInputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["before", "after", "fields"],
    properties: {
      before: { description: "Already delivered batch JSON object or {mediaType, body, observedAt} envelope. Not a filesystem path or URL." },
      after: { description: "Already delivered batch JSON object or envelope." },
      fields: {
        type: "array",
        minItems: 1,
        maxItems: DEFAULT_LIMITS.maxFields,
        uniqueItems: true,
        items: { type: "string" },
      },
      clock: { type: "string", description: "Caller UTC clock accepted for compatibility only. HTTP comparison keeps freshness unknown because it does not verify observations." },
      maxStaleMs: { type: "integer", minimum: 0, description: "Optional freshness horizon. Not a compute ceiling." },
      allowFreshClaim: { type: "boolean", const: false, description: "This supplied-input HTTP route cannot attest freshness. True is rejected." },
    },
  };
}

export function pageChangeHttpOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ok", "product", "schemaVersion", "charged", "report"],
    properties: {
      ok: { type: "boolean" },
      product: { type: "string", const: PAGE_CHANGE_HTTP_PRODUCT },
      schemaVersion: { type: "string", const: PAGE_CHANGE_HTTP_SCHEMA },
      charged: { type: "boolean", const: false },
      report: { type: "object", description: "pilot/page-change-brief/v1 from comparePageBatches." },
    },
  };
}

function inputError(message, status = 400, code = "invalid_page_change_input") {
  throw new PageChangeHttpError(message, { status, code });
}

function extraKeys(object, allowed) {
  return Object.keys(object).filter((key) => !allowed.includes(key));
}

function walkJsonGraph(value, limits, role) {
  let nodes = 0;
  const visit = (node, depth) => {
    if (depth > limits.maxJsonDepth) {
      inputError(`${role} json depth exceeds server limit ${limits.maxJsonDepth}`, 400, "json_depth_limit");
    }
    nodes += 1;
    if (nodes > limits.maxJsonNodes) {
      inputError(`${role} json nodes exceed server limit ${limits.maxJsonNodes}`, 400, "json_node_limit");
    }
    if (node && typeof node === "object") {
      const children = Array.isArray(node) ? node : Object.values(node);
      for (const child of children) visit(child, depth + 1);
    }
  };
  visit(value, 0);
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function admitArtifact(value, role, limits) {
  if (value === undefined || value === null) inputError(`${role} is required`);
  if (typeof value === "string") inputError(`${role} must be a supplied JSON artifact, not a filesystem path`);
  if (typeof value !== "object" || Array.isArray(value) || Buffer.isBuffer(value)) {
    inputError(`${role} must be a JSON object`);
  }
  for (const key of LIMIT_RAISE_KEYS) {
    if (Object.hasOwn(value, key)) inputError("caller cannot raise admission limits");
  }
  if (typeof value.path === "string" || typeof value.file === "string") {
    inputError(`${role} filesystem input is not accepted`);
  }
  if (value.source && (value.source.kind === "file" || typeof value.source.path === "string")) {
    inputError(`${role} filesystem input is not accepted`);
  }
  if (typeof value.url === "string" && !Object.hasOwn(value, "body") && !Object.hasOwn(value, "sources") && !Object.hasOwn(value, "items")) {
    inputError(`${role} URL dereference is not accepted`);
  }
  if (value.missing === true || value.status === "missing") {
    const allowed = ["missing", "status", "source"];
    const extra = extraKeys(value, allowed);
    if (extra.length) inputError(`${role} unexpected field: ${extra[0]}`);
    if (value.source?.path) inputError(`${role} filesystem input is not accepted`);
    return { missing: true, source: { kind: "supplied", path: null, role } };
  }
  const envelopeShaped = Object.hasOwn(value, "body")
    || Object.hasOwn(value, "mediaType")
    || Object.hasOwn(value, "observedAt");
  const artifact = envelopeShaped ? value.body : value;
  if (envelopeShaped) {
    const extra = extraKeys(value, ALLOWED_ENVELOPE_KEYS);
    if (extra.length) inputError(`${role} unexpected field: ${extra[0]}`);
    if (value.mediaType !== undefined && value.mediaType !== "application/json") {
      inputError(`${role} mediaType must be application/json`);
    }
    if (artifact === undefined) inputError(`${role} body is required`);
  }
  walkJsonGraph(envelopeShaped ? value : artifact, limits, role);
  const bytes = encodedBytes(artifact);
  if (bytes > limits.maxBytes) {
    inputError(`${role} exceeds server byte ceiling ${limits.maxBytes}`, 413, "payload_too_large");
  }
  return {
    mediaType: "application/json",
    body: artifact,
    observedAt: envelopeShaped ? (value.observedAt ?? null) : null,
    source: { kind: "supplied", path: null, role },
  };
}

export function admitPageChangeRequest(body, limits) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    inputError("request body must be a JSON object");
  }
  for (const key of LIMIT_RAISE_KEYS) {
    if (Object.hasOwn(body, key)) inputError("caller cannot raise admission limits");
  }
  const extra = extraKeys(body, ALLOWED_BODY_KEYS);
  if (extra.length) inputError(`unexpected field: ${extra[0]}`);
  if (!body.fields) inputError("fields must be an explicit non-empty unique subset of supported extraction fields");
  let fields;
  try {
    fields = normalizeFields(body.fields);
  } catch (error) {
    inputError(error.message);
  }
  if (fields.length > limits.maxFields) {
    inputError(`fields exceed server maxFields ${limits.maxFields}`);
  }
  let clock = null;
  if (body.clock !== undefined && body.clock !== null) {
    if (typeof body.clock !== "string" || !CLOCK_PATTERN.test(body.clock)) {
      inputError("clock must be a UTC ISO-8601 timestamp with trailing Z");
    }
    clock = body.clock;
  }
  let maxStaleMs = null;
  if (body.maxStaleMs !== undefined && body.maxStaleMs !== null) {
    if (!Number.isSafeInteger(body.maxStaleMs) || body.maxStaleMs < 0) {
      inputError("maxStaleMs must be a finite non-negative integer");
    }
    maxStaleMs = body.maxStaleMs;
  }
  if (body.allowFreshClaim !== undefined && typeof body.allowFreshClaim !== "boolean") {
    inputError("allowFreshClaim must be a boolean");
  }
  if (body.allowFreshClaim === true) inputError("supplied observations cannot establish freshness", 400, "freshness_authority_required");
  const before = admitArtifact(body.before, "before", limits);
  const after = admitArtifact(body.after, "after", limits);
  return Object.freeze({
    before,
    after,
    fields,
    clock,
    allowFreshClaim: false,
    limits: Object.freeze({
      maxBytes: limits.maxBytes,
      maxJsonDepth: limits.maxJsonDepth,
      maxJsonNodes: limits.maxJsonNodes,
      maxHtmlTokens: limits.maxHtmlTokens,
      maxSequenceLength: limits.maxSequenceLength,
      maxChanges: limits.maxChanges,
      maxExcerptBytes: limits.maxExcerptBytes,
      maxSources: limits.maxSources,
      maxFields: limits.maxFields,
      maxActionItems: limits.maxActionItems,
      maxStaleMs,
    }),
  });
}

export function ownedPageChangeWorkerCount() {
  return ownedWorkers.size;
}

export function resolvePageChangeWorkerPath(env = process.env) {
  const raw = String(env.PAGE_CHANGE_HTTP_WORKER_PATH || "").trim();
  if (!raw) return defaultWorkerPath;
  const resolved = resolve(raw);
  if (!resolved.startsWith(`${merchantRoot}${merchantRoot.endsWith("/") ? "" : "/"}`) && resolved !== merchantRoot) {
    throw new PageChangeHttpError("worker path must stay inside the merchant tree", { status: 500, code: "invalid_worker_path" });
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

export function reapPageChangeWorker(child, { graceMs = WORKER_KILL_GRACE_MS } = {}) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) {
    ownedWorkers.delete(child);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let killTimer;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      ownedWorkers.delete(child);
      resolve();
    };
    child.once("exit", done);
    try {
      child.kill("SIGTERM");
    } catch {
      done();
      return;
    }
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      }
    }, graceMs).unref();
  });
}

export function runPageChangeCompare(job, { env = process.env, abortSignal, timeoutMs } = {}) {
  const limits = pageChangeHttpLimits(env);
  const budget = Math.min(timeoutMs ?? limits.timeoutMs, limits.timeoutMs);
  if (abortSignal?.aborted) return Promise.reject(new PageChangeHttpError("request aborted", { code: "request_aborted" }));
  if (!Number.isFinite(budget) || budget <= 0) return Promise.reject(new PageChangeHttpError("compare timeout", { status: 408, code: "compare_timeout" }));
  if (ownedWorkers.size >= limits.maxConcurrent) return Promise.reject(new PageChangeHttpError("compare capacity occupied", { status: 503, code: "page_change_busy" }));
  const workerPath = resolvePageChangeWorkerPath(env);

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = trackWorker(spawn(process.execPath, [workerPath], {
      cwd: merchantRoot,
      env: { ...process.env, PAGE_CHANGE_HTTP_WORKER: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    }));
    const stdout = [];
    let stdoutBytes = 0;
    let timeoutHandle;
    let abortHandler;

    const settle = (fn) => (value) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (abortSignal && abortHandler) abortSignal.removeEventListener("abort", abortHandler);
      fn(value);
    };
    const succeed = settle(resolve);
    const fail = settle((error) => {
      reapPageChangeWorker(child).finally(() => reject(error));
    });

    child.stdin?.on("error", () => {});
    child.stderr?.resume();
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > limits.maxOutputBytes) {
        fail(new PageChangeHttpError("compare output exceeds server ceiling", { status: 413, code: "output_too_large" }));
        return;
      }
      stdout.push(chunk);
    });
    child.once("error", (error) => fail(error));
    // close follows exit AND stdout closure; exit alone can truncate a valid report.
    child.once("close", (code, signal) => {
      if (settled) {
        ownedWorkers.delete(child);
        return;
      }
      ownedWorkers.delete(child);
      const raw = Buffer.concat(stdout);
      if (signal === "SIGTERM" || signal === "SIGKILL") {
        fail(new PageChangeHttpError("compare aborted", { status: 400, code: "request_aborted" }));
        return;
      }
      if (!raw.length) {
        fail(new PageChangeHttpError(`compare worker failed (${code ?? signal})`, { status: 500, code: "compare_failed" }));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        fail(new PageChangeHttpError("compare worker returned invalid JSON", { status: 500, code: "compare_failed" }));
        return;
      }
      if (!parsed || parsed.ok !== true || !parsed.report) {
        fail(new PageChangeHttpError(parsed?.error || "compare failed", { status: 400, code: parsed?.code || "compare_failed" }));
        return;
      }
      succeed(parsed.report);
    });

    timeoutHandle = setTimeout(() => {
      fail(new PageChangeHttpError("compare timeout", { status: 408, code: "compare_timeout" }));
    }, budget);
    if (abortSignal) {
      abortHandler = () => fail(new PageChangeHttpError("request aborted", { status: 400, code: "request_aborted" }));
      if (abortSignal.aborted) abortHandler();
      else abortSignal.addEventListener("abort", abortHandler, { once: true });
    }
    if (settled) return;

    try {
      child.stdin.end(JSON.stringify({
        before: job.before,
        after: job.after,
        options: {
          fields: job.fields,
          // This public supplied-input route has no observation verifier. Even
          // a plausible caller clock cannot establish C2's current/fresh claims.
          clock: null,
          allowFreshClaim: false,
          limits: job.limits,
        },
      }));
    } catch (error) {
      fail(error);
    }
  });
}

function allowPageChangeHttp(req) {
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  for (const [ip, window] of rateWindows) if (window.resetAt <= now) rateWindows.delete(ip);
  const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) {
    if (rateWindows.size >= MAX_RATE_KEYS) return false;
    rateWindows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_MAX) return false;
  current.count += 1;
  return true;
}

function jsonError(res, error) {
  if (res.writableEnded) return res;
  const status = error instanceof PageChangeHttpError
    ? error.status
    : 500;
  const code = error instanceof PageChangeHttpError ? error.code : "page_change_http_failed";
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  return res.status(status).json({
    ok: false,
    product: PAGE_CHANGE_HTTP_PRODUCT,
    schemaVersion: PAGE_CHANGE_HTTP_SCHEMA,
    charged: false,
    error: error instanceof PageChangeHttpError ? error.code : "page_change_http_failed",
    message: error instanceof PageChangeHttpError ? String(error.message).slice(0, 160) : "page-change compare failed",
    code,
  });
}

function disabledJson(res) {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  return res.status(404).json({
    ok: false,
    enabled: false,
    product: PAGE_CHANGE_HTTP_PRODUCT,
    schemaVersion: PAGE_CHANGE_HTTP_SCHEMA,
    charged: false,
    error: "page_change_http_disabled",
  });
}

function isJsonContentType(req) {
  const type = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  return type === "application/json" || /^application\/[a-z0-9.+-]*\+json$/.test(type);
}

export function readBoundedRequestBody(req, { maxBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
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
      else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(new PageChangeHttpError("request timeout", { status: 408, code: "request_timeout" }));
      req.pause();
    }, timeoutMs);
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        req.pause();
        finish(new PageChangeHttpError("request exceeds server byte ceiling", { status: 413, code: "payload_too_large" }));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      finish(null, Buffer.concat(chunks, size));
    };
    const onError = (error) => finish(error);
    const onAborted = () => finish(new PageChangeHttpError("request aborted", { status: 400, code: "request_aborted" }));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

export function drainRequest(req, res) {
  if (req.complete) return;
  req.pause();
  res.set("Connection", "close");
  res.once("finish", () => req.destroy());
}

export function mountPageChangeHttp(app, { env = process.env } = {}) {
  const enabled = isPageChangeHttpEnabled(env);
  const limits = enabled ? pageChangeHttpLimits(env) : pageChangeHttpLimits({});

  const methodNotAllowed = (allowed) => (req, res) => {
    drainRequest(req, res);
    res.set("Allow", allowed);
    res.set("Cache-Control", "no-store");
    return res.status(405).json({ ok: false, error: "method_not_allowed", charged: false });
  };

  app.get(PAGE_CHANGE_HTTP_HEALTH_PATH, (req, res) => {
    const body = pageChangeHttpHealth(env);
    if (!body.enabled) return disabledJson(res);
    res.set("Cache-Control", "no-store");
    return res.status(200).json(body);
  });
  app.all(PAGE_CHANGE_HTTP_HEALTH_PATH, methodNotAllowed("GET"));

  app.get(PAGE_CHANGE_HTTP_OPENAPI_PATH, (req, res) => {
    if (!enabled) return disabledJson(res);
    res.set("Cache-Control", "no-store");
    return res.status(200).json(pageChangeHttpOpenApiExample());
  });
  app.all(PAGE_CHANGE_HTTP_OPENAPI_PATH, methodNotAllowed("GET"));

  app.get(XAGENT_VERIFICATION_PATH, (req, res) => {
    const proof = xagentVerification(env);
    if (proof.ok === false || proof.error) {
      res.set("Cache-Control", "no-store");
      return res.status(404).json({
        ok: false,
        error: "xagent_verification_unavailable",
        reason: proof.reason || "unconfigured",
      });
    }
    res.set("Cache-Control", "no-store");
    return res.status(200).json(proof);
  });
  app.all(XAGENT_VERIFICATION_PATH, methodNotAllowed("GET"));

  app.post(PAGE_CHANGE_HTTP_PATH, async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    if (!enabled) {
      drainRequest(req, res);
      return disabledJson(res);
    }
    if (!allowPageChangeHttp(req)) {
      drainRequest(req, res);
      res.set("Retry-After", "60");
      return res.status(429).json({ ok: false, error: "rate_limit_exceeded", charged: false });
    }
    if (!isJsonContentType(req)) {
      drainRequest(req, res);
      return res.status(415).json({ ok: false, error: "unsupported_media_type", charged: false });
    }
    if (Number(req.headers["content-length"]) > limits.maxRequestBytes) {
      drainRequest(req, res);
      return jsonError(res, new PageChangeHttpError("request exceeds server byte ceiling", { status: 413, code: "payload_too_large" }));
    }
    if (activeRequests >= limits.maxConcurrent) {
      drainRequest(req, res);
      res.set("Retry-After", "1");
      return jsonError(res, new PageChangeHttpError("compare capacity occupied", { status: 503, code: "page_change_busy" }));
    }
    activeRequests += 1;
    const deadline = performance.now() + limits.timeoutMs;
    const abort = new AbortController();
    // IncomingMessage `close` also fires after a complete body while the
    // response is still pending. Abort only on a real client disconnect.
    const onClientGone = () => {
      if (!res.writableEnded) abort.abort();
    };
    req.once("aborted", onClientGone);
    res.once("close", onClientGone);
    try {
      const raw = await readBoundedRequestBody(req, {
        maxBytes: limits.maxRequestBytes,
        timeoutMs: Math.max(1, deadline - performance.now()),
      });
      let parsed;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new PageChangeHttpError("request body must be valid JSON", { status: 400, code: "invalid_json" });
      }
      const job = admitPageChangeRequest(parsed, limits);
      const report = await runPageChangeCompare(job, {
        env,
        abortSignal: abort.signal,
        timeoutMs: deadline - performance.now(),
      });
      if (res.writableEnded) return;
      const output = {
        ok: true,
        product: PAGE_CHANGE_HTTP_PRODUCT,
        schemaVersion: PAGE_CHANGE_HTTP_SCHEMA,
        charged: false,
        report,
      };
      if (encodedBytes(output) > limits.maxOutputBytes) throw new PageChangeHttpError("response exceeds server ceiling", { status: 413, code: "output_too_large" });
      return res.status(200).json(output);
    } catch (error) {
      if (res.writableEnded) return;
      drainRequest(req, res);
      if (abort.signal.aborted && !(error instanceof PageChangeHttpError)) {
        return jsonError(res, new PageChangeHttpError("request aborted", { status: 400, code: "request_aborted" }));
      }
      return jsonError(res, error);
    } finally {
      activeRequests -= 1;
      req.removeListener("aborted", onClientGone);
      res.removeListener("close", onClientGone);
    }
  });
  app.all(PAGE_CHANGE_HTTP_PATH, methodNotAllowed("POST"));

  return { enabled, limits };
}

export const PAGE_CHANGE_HTTP_WORKER_MODULE = pathToFileURL(defaultWorkerPath).href;
export { defaultWorkerPath as PAGE_CHANGE_HTTP_DEFAULT_WORKER_PATH };
