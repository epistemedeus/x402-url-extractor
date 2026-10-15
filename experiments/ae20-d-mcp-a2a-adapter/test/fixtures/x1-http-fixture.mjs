#!/usr/bin/env node
/**
 * Labelled fixture. In-memory stand-in for X1's mounted url.extract routes.
 * It speaks quote/execute and returns the contract shapes. It does not fetch URLs.
 */
import { randomUUID } from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";
import Ajv from "ajv";
import { PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL } from "../../src/config.mjs";
import { canonicalBytes, digestBytes, digestValue } from "../../src/canonical.mjs";
import { listen } from "../../src/listen.mjs";
import { CONTRACT_SCHEMAS } from "../../src/tools.mjs";

export const PREFIX = "/api/machine-gateway";
const JOB_ID = /^j[a-f0-9]{32}$/;
const IDEM = /^[A-Za-z0-9_.-]{16,128}$/;
const ROUTES = ["url.extract.submit", "url.extract.poll", "url.extract.result"];
const FIXTURE_JOB = `j${"0".repeat(32)}`;
const PRICE = { amount: 0, unit: "usd-micros" };
const PAYMENT = { state: "not_required", adapter: null, evidence: "none", reference: null, network: null };

const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: false });
const check = {
  "url.extract.submit": ajv.compile(CONTRACT_SCHEMAS.url_extract_submit_input),
  "url.extract.poll": ajv.compile(CONTRACT_SCHEMAS.url_extract_poll_input),
  "url.extract.result": ajv.compile(CONTRACT_SCHEMAS.url_extract_result_input),
};
const checkOut = {
  "url.extract.submit": ajv.compile(CONTRACT_SCHEMAS.url_extract_submit_output),
  "url.extract.poll": ajv.compile(CONTRACT_SCHEMAS.url_extract_poll_output),
  "url.extract.result": ajv.compile(CONTRACT_SCHEMAS.url_extract_result_output),
};

function emptyStats() {
  return {
    label: "ae20-d-x1-contract-fixture",
    note: "In-memory stand-in for X1 url.extract. Does not fetch URLs.",
    jobsCreated: 0,
    submitsAdmitted: 0,
    executes: { "url.extract.submit": 0, "url.extract.poll": 0, "url.extract.result": 0 },
    quotes: 0,
    quoteRejected: 0,
    paymentHeaderSeen: 0,
    capture: 0,
    paymentFieldsSet: 0,
  };
}

export function createFixtureState({ deterministic = false, nowMs = 1_700_000_000_000, bearer = PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL } = {}) {
  const jobs = new Map();
  const idem = new Map();
  const quotes = new Map();
  const receipts = new Map();
  const stats = emptyStats();
  let seq = 0;
  let clock = nowMs;
  function now() {
    if (!deterministic) return Date.now();
    clock += 1;
    return clock;
  }
  function nextId() {
    if (!deterministic) return randomUUID();
    seq += 1;
    return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`;
  }
  return { jobs, idem, quotes, receipts, stats, now, nextId, bearer, deterministic };
}

function blocked(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return true; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "127.0.0.1" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

function held(url) {
  try { return new URL(url).hostname.toLowerCase() === "hold.example"; } catch { return false; }
}

function fixtureJobId(key) {
  return `j${digestValue(key).slice(0, 32)}`;
}

function pageBytes(url) {
  return canonicalBytes({
    error: null,
    fetch_mode: "fixture",
    finalUrl: url,
    requestedUrl: url,
    sourceOk: true,
    status: 200,
    title: "Fixture Page",
  });
}

function noFitBytes() {
  return canonicalBytes({ fit: false, paymentAttempts: 0, reason: "ssrf_blocked" });
}

function submitOutput(job) {
  return {
    jobId: job.jobId,
    status: job.state === "queued" || job.state === "running" ? "queued" : "ready",
    digest: job.digest,
    state: job.state,
    reason: job.reason,
    attempts: 0,
    paymentAttempts: 0,
    newPayment: false,
    fetch_mode: job.fetchMode,
    completion: job.state === "queued" || job.state === "running" ? "pending" : "ready",
  };
}

function readOutput(job) {
  if (job.bytes && job.digest && digestBytes(job.bytes) !== job.digest) {
    return {
      jobId: job.jobId,
      title: null,
      status: null,
      requestedUrl: null,
      fetch_mode: job.fetchMode,
      completion: "failed",
      digest: null,
      state: "unknown",
      reason: "digest_mismatch",
      attempts: 0,
      paymentAttempts: 0,
      newPayment: false,
      verdict: "unknown",
      code: "digest_mismatch",
    };
  }
  let parsed = {};
  if (job.bytes) parsed = JSON.parse(job.bytes.toString("utf8"));
  const pending = job.state === "queued" || job.state === "running";
  return {
    jobId: job.jobId,
    title: typeof parsed.title === "string" ? parsed.title : null,
    status: Number.isInteger(parsed.status) ? parsed.status : null,
    requestedUrl: typeof parsed.requestedUrl === "string" ? parsed.requestedUrl : null,
    fetch_mode: job.fetchMode,
    completion: pending ? "pending" : (job.state === "no_fit" || job.state === "ready" ? "ready" : "failed"),
    digest: job.digest,
    state: job.state,
    reason: job.reason,
    attempts: 0,
    paymentAttempts: 0,
    newPayment: false,
    verdict: null,
    code: null,
  };
}

function admit(state, input) {
  const prior = state.idem.get(input.idempotencyKey);
  if (prior) {
    if (prior.url !== input.url) {
      const error = new Error("idempotency_conflict");
      error.receiptCode = "idempotency_conflict";
      throw error;
    }
    return state.jobs.get(prior.jobId);
  }
  const jobId = fixtureJobId(input.idempotencyKey);
  let job;
  if (blocked(input.url)) {
    const bytes = noFitBytes();
    job = {
      jobId, url: input.url, state: "no_fit", reason: "ssrf_blocked", fetchMode: "none",
      bytes, digest: digestBytes(bytes),
    };
  } else if (held(input.url)) {
    job = { jobId, url: input.url, state: "queued", reason: null, fetchMode: null, bytes: null, digest: null };
  } else {
    const bytes = pageBytes(input.url);
    job = {
      jobId, url: input.url, state: "ready", reason: null, fetchMode: "fixture",
      bytes, digest: digestBytes(bytes),
    };
  }
  state.jobs.set(jobId, job);
  state.idem.set(input.idempotencyKey, { url: input.url, jobId });
  state.stats.jobsCreated += 1;
  state.stats.submitsAdmitted += 1;
  return job;
}

function runRoute(state, routeId, input) {
  state.stats.executes[routeId] += 1;
  if (routeId === "url.extract.submit") return submitOutput(admit(state, input));
  const job = state.jobs.get(input.jobId);
  if (!job) {
    const error = new Error("e08_job_forbidden");
    error.receiptCode = "e08_job_forbidden";
    throw error;
  }
  return readOutput(job);
}

function testOutput(routeId) {
  if (routeId === "url.extract.submit") {
    return {
      jobId: FIXTURE_JOB, status: "ready", digest: null, state: "ready", reason: null, attempts: 0,
      paymentAttempts: 0, newPayment: false, fetch_mode: "none", completion: "ready",
    };
  }
  return {
    jobId: FIXTURE_JOB, title: "fixture", status: 200, requestedUrl: "https://example.com/",
    fetch_mode: "none", completion: "ready", digest: null, state: "ready", reason: null, attempts: 0,
    paymentAttempts: 0, newPayment: false, verdict: null, code: null,
  };
}

function receipt(state, routeId, quote, output, error) {
  const stamp = state.now();
  return {
    schema: "neomorphic.machine-gateway.receipt.v1",
    id: state.nextId(),
    quoteId: quote.id,
    routeId,
    routeVersion: "1",
    requestDigest: digestValue({ routeId, input: quote.input }),
    inputDigest: quote.inputDigest,
    createdAt: stamp,
    deadlineAt: stamp + 15000,
    completedAt: stamp,
    status: error ? "failed" : "completed",
    price: PRICE,
    payment: PAYMENT,
    output: output ?? null,
    error: error ? { code: error } : null,
    readbackPath: `${PREFIX}/v1/receipts/${quote.id}`,
  };
}

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-ae20-d-fixture": "x1-url-extract-contract",
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65536) reject(Object.assign(new Error("body"), { code: "body" }));
      else chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error("json"), { code: "json" })); }
    });
    req.on("error", reject);
  });
}

function authorized(req, bearer) {
  return req.headers.authorization === `Bearer ${bearer}`;
}

export function createFixtureHandler(state) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.search) return send(res, 400, { error: { code: "query_not_supported" } });
      const path = url.pathname === PREFIX ? "/" : url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length) : null;
      if (req.method === "GET" && url.pathname === "/__fixture/stats") return send(res, 200, state.stats);
      if (path == null && req.method === "POST" && url.pathname === "/__fixture/release") {
        if (!authorized(req, state.bearer)) return send(res, 401, { error: { code: "unauthorized" } });
        const body = await readBody(req);
        const job = state.jobs.get(body.jobId);
        if (!job || job.state !== "queued") return send(res, 404, { error: { code: "job_absent" } });
        const bytes = pageBytes(job.url);
        job.bytes = bytes;
        job.digest = digestBytes(bytes);
        job.state = "ready";
        job.fetchMode = "fixture";
        job.reason = null;
        return send(res, 200, { ok: true, jobId: job.jobId, digest: job.digest, fixture: true });
      }
      if (path == null && req.method === "POST" && url.pathname === "/__fixture/tamper") {
        if (!authorized(req, state.bearer)) return send(res, 401, { error: { code: "unauthorized" } });
        const body = await readBody(req);
        const job = state.jobs.get(body.jobId);
        if (!job?.digest) return send(res, 404, { error: { code: "job_absent" } });
        job.bytes = Buffer.from("tampered");
        return send(res, 200, { ok: true, jobId: job.jobId, fixture: true });
      }
      if (path == null && req.method === "GET" && url.pathname.startsWith("/__fixture/job/")) {
        const job = state.jobs.get(url.pathname.slice("/__fixture/job/".length));
        if (!job) return send(res, 404, { error: { code: "job_absent" } });
        return send(res, 200, {
          fixture: true,
          jobId: job.jobId,
          digest: job.digest,
          bytesSha256: job.bytes ? digestBytes(job.bytes) : null,
          state: job.state,
        });
      }
      if (path == null) return send(res, 404, { error: { code: "route_not_found" } });
      if (req.method === "GET" && path === "/healthz") {
        return send(res, 200, { ok: true, fixture: true, paymentsEnabled: false, price: 0 });
      }
      if (req.method === "GET" && path === "/v1/discover") {
        return send(res, 200, {
          schema: "neomorphic.machine-gateway.discovery.v1",
          fixture: true,
          fixtureLabel: "AE20-D contract fixture for X1 url.extract. Not the X1 process. Does not fetch.",
          version: "0.1.1",
          basePath: PREFIX,
          budgetUnit: "usd-micros",
          paymentsEnabled: false,
          paths: {
            quote: `${PREFIX}/v1/quote`,
            test: `${PREFIX}/v1/test`,
            execute: `${PREFIX}/v1/execute`,
            receipt: `${PREFIX}/v1/receipts/{id}`,
          },
          routes: ROUTES.map((id) => ({
            id,
            version: "1",
            provider: "ae19-extraction-contract",
            description: "fixture",
            price: PRICE,
            timeoutMs: 15000,
            maxOutputBytes: 16384,
            executable: true,
            inputSchemaPath: `${PREFIX}/v1/routes/${id}/input.schema.json`,
            outputSchemaPath: `${PREFIX}/v1/routes/${id}/output.schema.json`,
          })),
        });
      }
      const schemaMatch = /^\/v1\/routes\/(url\.extract\.(?:submit|poll|result))\/(input|output)\.schema\.json$/.exec(path);
      if (req.method === "GET" && schemaMatch) {
        const key = `url_extract_${schemaMatch[1].split(".")[2]}_${schemaMatch[2]}`;
        return send(res, 200, CONTRACT_SCHEMAS[key]);
      }
      if (!["/v1/quote", "/v1/execute", "/v1/test"].includes(path) || req.method !== "POST") {
        return send(res, 404, { error: { code: "route_not_found" } });
      }
      if (req.headers["payment-signature"]) state.stats.paymentHeaderSeen += 1;
      if (!authorized(req, state.bearer)) return send(res, 401, { error: { code: "unauthorized" } });
      if (req.headers["payment-signature"]) return send(res, 400, { error: { code: "payment_on_free_route" } });
      const body = await readBody(req);
      if (path === "/v1/test") {
        if (!ROUTES.includes(body.routeId)) return send(res, 404, { error: { code: "route_not_found" } });
        return send(res, 200, {
          schema: "neomorphic.machine-gateway.test.v1",
          routeId: body.routeId,
          fixture: true,
          paymentAttempts: 0,
          output: testOutput(body.routeId),
        });
      }
      if (path === "/v1/quote") {
        state.stats.quotes += 1;
        if (!ROUTES.includes(body.routeId) || !body.input || typeof body.input !== "object" || !check[body.routeId](body.input)) {
          state.stats.quoteRejected += 1;
          return send(res, 400, { error: { code: "request_schema_invalid" } });
        }
        const id = state.nextId();
        const quote = {
          id,
          routeId: body.routeId,
          input: body.input,
          inputDigest: digestValue(body.input),
        };
        state.quotes.set(id, quote);
        return send(res, 200, {
          schema: "neomorphic.machine-gateway.quote.v1",
          quoteId: id,
          routeId: body.routeId,
          routeDigest: digestValue({ routeId: body.routeId }),
          inputDigest: quote.inputDigest,
          expiresAt: state.now() + 60000,
          tenantBound: true,
          executable: true,
          price: PRICE,
          requirements: null,
        });
      }
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !IDEM.test(key)) return send(res, 400, { error: { code: "idempotency_key_required" } });
      const replay = state.receipts.get(key);
      if (replay) {
        if (replay.request !== JSON.stringify(body)) return send(res, 409, { error: { code: "idempotency_conflict" } });
        return send(res, 200, replay.receipt, { "idempotency-replayed": "true" });
      }
      const quote = state.quotes.get(body.quoteId);
      if (!quote) return send(res, 404, { error: { code: "quote_not_found" } });
      if (JSON.stringify(body.input) !== JSON.stringify(quote.input)) return send(res, 409, { error: { code: "quote_changed" } });
      if (!check[quote.routeId](body.input)) return send(res, 400, { error: { code: "request_schema_invalid" } });
      let output = null;
      let errorCode = null;
      try {
        output = runRoute(state, quote.routeId, body.input);
        if (!checkOut[quote.routeId](output)) {
          errorCode = "response_schema_invalid";
          output = null;
        }
      } catch (error) {
        errorCode = error.receiptCode || "provider_failed";
        output = null;
      }
      const bodyReceipt = receipt(state, quote.routeId, quote, output, errorCode);
      state.receipts.set(key, { request: JSON.stringify(body), receipt: bodyReceipt });
      return send(res, 200, bodyReceipt, { "idempotency-replayed": "false" });
    } catch (error) {
      const code = error?.code === "json" ? "invalid_json" : "service_unavailable";
      const status = code === "invalid_json" ? 400 : 503;
      if (!res.headersSent) return send(res, status, { error: { code } });
    }
  };
}

export function startFixture(options = {}) {
  const state = createFixtureState({
    deterministic: options.deterministic === true || process.env.FIXTURE_DETERMINISTIC === "1",
    nowMs: Number(options.nowMs || process.env.FIXTURE_NOW_MS || 1_700_000_000_000),
    bearer: options.bearer || PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL,
  });
  const server = http.createServer(createFixtureHandler(state));
  return { server, state };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadConfig } = await import("../../src/config.mjs");
  const config = loadConfig();
  const { server } = startFixture();
  const url = await listen(server, { port: config.port, urlFile: config.urlFile, basePath: PREFIX });
  console.error(`AE20_D_FIXTURE ${url}`);
}
