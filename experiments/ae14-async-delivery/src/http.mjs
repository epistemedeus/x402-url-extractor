import https from "node:https";
import { caught } from "./service.mjs";
import { completionDenied, completionUrlTemplate, createUrlJobs, UrlJobError } from "./url-job.mjs";

export const ROUTES = Object.freeze([
  "POST /v1/jobs",
  "POST /v1/jobs/:jobId/funding",
  "POST /v1/jobs/:jobId/output",
  "POST /v1/jobs/:jobId/accept",
  "POST /v1/jobs/:jobId/reject",
  "POST /v1/jobs/:jobId/reuse",
  "POST /v1/jobs/:jobId/rights",
  "GET /v1/jobs/:jobId",
  "POST /v1/url-jobs",
  "GET /v1/url-jobs/:jobId",
  "GET /v1/url-jobs/:jobId/result",
  "GET /v1/url-jobs/:jobId/completion",
  "POST /v1/url-jobs/:jobId/cancel",
  "GET /v1/health",
]);

export function listenPolicy({ host = "127.0.0.1", publicOrigin = null } = {}) {
  if (publicOrigin == null || publicOrigin === "") {
    if (host !== "127.0.0.1") throw new Error("loopback_only");
    return { host, publicOrigin: null, disposable: true };
  }
  let origin;
  try { origin = new URL(publicOrigin); }
  catch { throw new Error("public_origin_invalid"); }
  if (origin.protocol !== "https:") throw new Error("public_origin_tls_required");
  if (origin.username || origin.password || origin.search || origin.hash || (origin.pathname !== "/" && origin.pathname !== "")) {
    throw new Error("public_origin_invalid");
  }
  if (origin.port && origin.port !== "443") throw new Error("public_origin_port_invalid");
  if (origin.hostname !== host) throw new Error("public_origin_host_mismatch");
  if (host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "0.0.0.0") {
    throw new Error("public_origin_requires_public_bind");
  }
  return { host, publicOrigin: origin.origin, disposable: false };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        reject(Object.assign(new Error("body"), { code: "body" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("json"), { code: "json" })); }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendView(res, view) {
  const { statusCode, ...body } = view;
  send(res, statusCode || 200, body);
}

function idempotencyKey(req) {
  const value = req.headers["idempotency-key"];
  if (value == null || value === "") throw new UrlJobError("idempotency_key_required", 400);
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new UrlJobError("idempotency_key_invalid", 400);
  return value;
}

export function startServer({
  service,
  tls,
  host = "127.0.0.1",
  port = 0,
  publicOrigin = null,
  urlJobs = null,
  urlJobTokens = [],
  urlJobExtract = null,
  urlJobConcurrency = 2,
  urlJobDeadlineMs = 10_000,
  urlJobDisposable = false,
  urlJobFixtureOrigin = null,
  now,
} = {}) {
  const policy = listenPolicy({ host, publicOrigin });
  const jobs = urlJobs || createUrlJobs({
    journal: service?.journal,
    tokens: urlJobTokens,
    extract: urlJobExtract,
    concurrency: urlJobConcurrency,
    deadlineMs: urlJobDeadlineMs,
    disposable: urlJobDisposable,
    fixtureOrigin: urlJobFixtureOrigin,
    now,
  });
  const server = https.createServer({ key: tls.key, cert: tls.cert, ca: tls.ca }, async (req, res) => {
    let completionId = null;
    try {
      const url = new URL(req.url, "https://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/v1/health") {
        send(res, 200, {
          ok: true,
          schemaVersion: "ae14.async-delivery.v1",
          qualification: "pending-join",
          railQualification: service.railQualification,
          routes: ROUTES,
          liveImmediatePay: false,
          bind: policy.host,
          publicOrigin: policy.publicOrigin,
          completionUrlTemplate: policy.publicOrigin ? completionUrlTemplate(policy.publicOrigin) : null,
          completionAuthorization: "Authorization: Bearer <tenant-scoped token>",
          paymentCompleted: false,
          usefulWork: false,
        });
        return;
      }
      const urlJobMatch = url.pathname.match(/^\/v1\/url-jobs(?:\/(j[a-f0-9]{32})(?:\/(result|completion|cancel))?)?$/);
      if (urlJobMatch) {
        const jobId = urlJobMatch[1] || "";
        const action = urlJobMatch[2] || "";
        if (action === "completion") completionId = jobId;
        // Identity is the bearer token only. Query parameters are never actors.
        if (req.method === "POST" && !jobId && !action) {
          const body = await readBody(req);
          const tenantId = jobs.tenantFromAuthorization(req.headers.authorization);
          sendView(res, await jobs.submit(tenantId, idempotencyKey(req), body));
          return;
        }
        if (req.method === "GET" && jobId && action === "completion") {
          const tenantId = jobs.tenantFromAuthorization(req.headers.authorization);
          send(res, 200, await jobs.completion(tenantId, jobId));
          return;
        }
        if (req.method === "GET" && jobId && action === "") {
          const tenantId = jobs.tenantFromAuthorization(req.headers.authorization);
          sendView(res, await jobs.get(tenantId, jobId));
          return;
        }
        if (req.method === "GET" && jobId && action === "result") {
          const tenantId = jobs.tenantFromAuthorization(req.headers.authorization);
          sendView(res, await jobs.result(tenantId, jobId));
          return;
        }
        if (req.method === "POST" && jobId && action === "cancel") {
          const tenantId = jobs.tenantFromAuthorization(req.headers.authorization);
          sendView(res, await jobs.cancel(tenantId, jobId));
          return;
        }
        send(res, 404, { ok: false, code: "not_found", qualification: "pending-join", liveImmediatePay: false, usefulWork: false, paymentCompleted: false });
        return;
      }
      const jobMatch = url.pathname.match(/^\/v1\/jobs\/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})(?:\/(funding|output|accept|reject|reuse|rights))?$/);
      if (req.method === "POST" && url.pathname === "/v1/jobs") {
        const body = await readBody(req);
        const opened = await service.openJob(body.actor, body.job || body);
        send(res, opened.statusCode || 201, opened);
        return;
      }
      if (!jobMatch) {
        send(res, 404, { ok: false, code: "not_found", qualification: "pending-join", liveImmediatePay: false, usefulWork: false });
        return;
      }
      const jobId = jobMatch[1];
      const action = jobMatch[2] || "";
      if (req.method === "GET" && action === "") {
        const actor = { tenantId: url.searchParams.get("tenantId"), actorId: url.searchParams.get("actorId"), role: url.searchParams.get("role") };
        const viewed = await service.observe(actor, jobId);
        send(res, viewed.statusCode || 200, viewed);
        return;
      }
      if (req.method !== "POST" || !action) {
        send(res, 404, { ok: false, code: "not_found", qualification: "pending-join", usefulWork: false });
        return;
      }
      const body = await readBody(req);
      const actor = body.actor;
      let view;
      if (action === "funding") view = await service.observeFunding(actor, jobId, body.proofId);
      else if (action === "output") view = await service.deliverOutput(actor, jobId, body.output || body);
      else if (action === "accept") view = await service.accept(actor, jobId, body);
      else if (action === "reject") view = await service.reject(actor, jobId, body);
      else if (action === "reuse") view = await service.reuse(actor, jobId);
      else if (action === "rights") view = await service.withdrawRights(actor, jobId);
      else {
        send(res, 404, { ok: false, code: "not_found", qualification: "pending-join", usefulWork: false });
        return;
      }
      send(res, view.statusCode || 200, view);
    } catch (error) {
      if (completionId) {
        const status = error instanceof UrlJobError ? error.statusCode : 500;
        send(res, status, completionDenied(completionId));
        return;
      }
      if (error instanceof UrlJobError) {
        send(res, error.statusCode, {
          ok: false,
          schemaVersion: "ae14.url-job.v1",
          code: error.code,
          state: error.fields?.state || "unknown",
          unpaid: true,
          mode: "test-only",
          qualification: "pending-join",
          paymentCompleted: false,
          fundingRequired: false,
          resultAccess: "independent-of-funding",
        });
        return;
      }
      if (error?.code === "body" || error?.code === "json") {
        send(res, 400, { ok: false, code: error.code, qualification: "pending-join", usefulWork: false, paymentCompleted: false });
        return;
      }
      try {
        const refusal = caught(error);
        send(res, refusal.statusCode, refusal);
      } catch {
        send(res, 500, { ok: false, code: "internal", qualification: "pending-join", usefulWork: false, paymentCompleted: false });
      }
    }
  });
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.close();
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, policy.host, () => {
      server.off("error", onError);
      const address = server.address();
      resolve({
        server,
        host: policy.host,
        port: address.port,
        publicOrigin: policy.publicOrigin,
        urlJobs: jobs,
        completionUrlTemplate: policy.publicOrigin ? completionUrlTemplate(policy.publicOrigin) : null,
      });
    });
  });
}
