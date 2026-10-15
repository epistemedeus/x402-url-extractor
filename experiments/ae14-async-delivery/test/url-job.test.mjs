import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { before, describe } from "node:test";
import { startServer } from "../src/http.mjs";
import { createUrlJobs } from "../src/url-job.mjs";
import { actors, future, parties, setupService } from "./helpers.mjs";

const TOKEN = "tenant-a-url-job-token";
const OTHER = "tenant-b-url-job-token";
const FIXTURE_URL = "https://fixture.example/page";
const FIXTURE_HTML = "<html><head><title>Fixture Title</title></head><body><p>local fixture</p></body></html>";

function makeCerts(dir) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", path.join(dir, "ca.key"), "-out", path.join(dir, "ca.pem"), "-days", "1", "-nodes", "-subj", "/CN=ae14-e08u-ca"], { stdio: "ignore" });
  execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-keyout", path.join(dir, "srv.key"), "-out", path.join(dir, "srv.csr"), "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  execFileSync("openssl", ["x509", "-req", "-in", path.join(dir, "srv.csr"), "-CA", path.join(dir, "ca.pem"), "-CAkey", path.join(dir, "ca.key"), "-CAcreateserial", "-out", path.join(dir, "srv.pem"), "-days", "1", "-copy_extensions", "copy"], { stdio: "ignore" });
  return {
    ca: readFileSync(path.join(dir, "ca.pem")),
    key: readFileSync(path.join(dir, "srv.key")),
    cert: readFileSync(path.join(dir, "srv.pem")),
  };
}

function request({ port, ca, method, path: pathname, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = https.request({
      host: "127.0.0.1",
      port,
      ca,
      rejectUnauthorized: true,
      servername: "localhost",
      method,
      path: pathname,
      headers: {
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

function authHeaders(token, extra = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

async function moneyCounts(pool) {
  const one = async (sql) => (await pool.query(sql)).rows[0].n;
  return {
    jobs: await one("SELECT count(*)::int AS n FROM ae14_async_job"),
    receipts: await one("SELECT count(*)::int AS n FROM ae14_async_receipt"),
    standin: await one("SELECT count(*)::int AS n FROM ae14_async_standin"),
    invocations: await one("SELECT coalesce(sum(coalesce((record->>'invocations')::int, 0)), 0)::int AS n FROM ae14_async_standin"),
    urlJobs: await one("SELECT count(*)::int AS n FROM ae14_async_url_job"),
  };
}

function startFixture() {
  const server = http.createServer((req, res) => {
    if (req.url === "/page") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(FIXTURE_HTML);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function installBridge(origin, pages = { [FIXTURE_URL]: "/page" }) {
  const previousFetch = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  const previousTimeout = globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
  const state = { calls: 0, active: 0, maxActive: 0 };
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input, init) => {
    const target = String(input);
    state.calls += 1;
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    try {
      const pathName = pages[target];
      if (!pathName) throw Object.assign(new Error("unmapped fixture"), { code: "fetch_error" });
      if (typeof pathName === "function") return pathName(target, init, state);
      const response = await fetch(`${origin}${pathName}`, { signal: init?.signal });
      const payload = new Uint8Array(await response.arrayBuffer());
      let delivered = false;
      return {
        status: response.status,
        url: target,
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
        body: {
          getReader() {
            return {
              async read() {
                if (delivered) return { done: true };
                delivered = true;
                return { done: false, value: payload };
              },
              async cancel() {},
            };
          },
        },
      };
    } finally {
      state.active -= 1;
    }
  };
  return {
    state,
    restore() {
      if (previousFetch === undefined) delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
      else globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = previousFetch;
      if (previousTimeout === undefined) delete globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
      else globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = previousTimeout;
    },
  };
}

async function closeServer(started) {
  if (!started?.server) return;
  await new Promise((resolve) => started.server.close(resolve));
}

describe("unpaid url extraction jobs", { concurrency: 1 }, () => {
  let tls;
  before(() => {
    tls = makeCerts(mkdtempSync(path.join(tmpdir(), "ae14-e08u-url-")));
  });

  test("local fixture extraction completes and the result is stable across restart", async () => {
    const ctx = await setupService();
    const fixture = await startFixture();
    const bridge = installBridge(fixture.origin);
    const before = await moneyCounts(ctx.pool);
    const started = await startServer({
      service: ctx.service,
      tls,
      urlJobTokens: [
        { token: TOKEN, tenantId: "tenant-a" },
        { token: OTHER, tenantId: "tenant-b" },
      ],
      urlJobConcurrency: 1,
    });
    try {
      const created = await request({
        port: started.port,
        ca: tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "fixture-once" }),
        body: { url: FIXTURE_URL },
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.unpaid, true);
      assert.equal(created.body.mode, "test-only");
      assert.equal(created.body.fundingRequired, false);
      assert.equal(created.body.resultAccess, "independent-of-funding");
      assert.equal(created.body.paymentCompleted, false);
      assert.equal(created.body.state, "working");
      const jobId = created.body.jobId;
      const working = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${jobId}/completion?tenantId=tenant-b&actorId=nope&role=requester`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(working.status, 200);
      assert.deepEqual(Object.keys(working.body).sort(), ["digest", "jobId", "state", "updatedAt"]);
      assert.equal(working.body.state, "working");
      assert.equal(working.body.digest, null);
      const queried = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${jobId}/completion?tenantId=tenant-a&actorId=later-a&role=later-consumer`,
      });
      assert.equal(queried.status, 401);
      assert.equal(queried.body.state, "unknown");
      const wrongTenant = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${jobId}/completion`,
        headers: authHeaders(OTHER),
      });
      assert.equal(wrongTenant.status, 404);
      assert.notEqual(wrongTenant.body.state, "completed");
      assert.equal(wrongTenant.body.digest, null);
      const early = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${jobId}/result`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(early.status, 409);
      assert.equal(early.body.code, "result_not_ready");
      assert.equal(early.body.bytes, undefined);

      await started.urlJobs.start();
      const done = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${jobId}/completion`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(done.body.state, "completed");
      assert.match(done.body.digest, /^[a-f0-9]{64}$/);
      const result = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${jobId}/result`,
        headers: authHeaders(TOKEN),
      });
      const bytes = Buffer.from(result.body.bytes, "base64");
      assert.equal(createHash("sha256").update(bytes).digest("hex"), result.body.digest);
      assert.equal(result.body.digest, done.body.digest);
      const parsed = JSON.parse(bytes.toString("utf8"));
      assert.equal(parsed.title, "Fixture Title");
      assert.equal(parsed.requestedUrl, FIXTURE_URL);
      assert.equal(parsed.ok, true);
      const again = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${jobId}/result`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(again.body.bytes, result.body.bytes);
      assert.equal(again.body.digest, result.body.digest);
      assert.equal(bridge.state.calls, 1);
      const cancelDone = await request({
        port: started.port,
        ca: tls.ca,
        method: "POST",
        path: `/v1/url-jobs/${jobId}/cancel`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(cancelDone.status, 409);
      assert.equal(cancelDone.body.code, "cancel_terminal");
      assert.equal(cancelDone.body.state, "completed");
      const still = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${jobId}/completion`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(still.body.state, "completed");
      assert.equal(still.body.digest, done.body.digest);

      const restarted = createUrlJobs({
        journal: ctx.journal,
        tokens: [
          { token: TOKEN, tenantId: "tenant-a" },
          { token: OTHER, tenantId: "tenant-b" },
        ],
        concurrency: 1,
      });
      await restarted.start();
      const afterRestart = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${jobId}/result`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(afterRestart.body.bytes, result.body.bytes);
      assert.equal(afterRestart.body.digest, result.body.digest);
      assert.equal(bridge.state.calls, 1);
      const replay = await request({
        port: started.port,
        ca: tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "fixture-once" }),
        body: { url: FIXTURE_URL },
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.jobId, jobId);
      assert.equal(replay.body.replayed, true);
      assert.equal((await moneyCounts(ctx.pool)).urlJobs, 1);

      const after = await moneyCounts(ctx.pool);
      assert.equal(after.jobs, before.jobs);
      assert.equal(after.receipts, before.receipts);
      assert.equal(after.standin, before.standin);
      assert.equal(after.invocations, before.invocations);
      const opened = await ctx.service.openJob(actors().requester, { ...parties, gross: "20", expiresAt: future() });
      assert.match(opened.jobId, /^j[a-f0-9]{32}$/);
      assert.equal(opened.paymentCompleted, false);
      const fundedCounts = await moneyCounts(ctx.pool);
      assert.equal(fundedCounts.jobs, before.jobs + 1);
      assert.equal(fundedCounts.invocations, 0);
      assert.equal(fundedCounts.receipts, 0);
    } finally {
      bridge.restore();
      await closeServer(started);
      await fixture.close();
      await ctx.close();
    }
  });

  test("idempotency, bearer, and query-string negatives do not create a second job", async () => {
    const ctx = await setupService();
    const started = await startServer({
      service: ctx.service,
      tls,
      urlJobTokens: [
        { token: TOKEN, tenantId: "tenant-a" },
        { token: OTHER, tenantId: "tenant-b" },
      ],
    });
    try {
      const missing = await request({
        port: started.port,
        ca: tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: authHeaders(TOKEN),
        body: { url: FIXTURE_URL },
      });
      assert.equal(missing.status, 400);
      assert.equal(missing.body.code, "idempotency_key_required");
      const first = await request({
        port: started.port,
        ca: tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "same-key" }),
        body: { url: FIXTURE_URL },
      });
      const changed = await request({
        port: started.port,
        ca: tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "same-key" }),
        body: { url: "https://fixture.example/other" },
      });
      assert.equal(changed.status, 409);
      assert.equal(changed.body.code, "idempotency_conflict");
      const otherKey = await request({
        port: started.port,
        ca: tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "other-key" }),
        body: { url: FIXTURE_URL },
      });
      assert.equal(otherKey.status, 201);
      assert.notEqual(otherKey.body.jobId, first.body.jobId);
      const replay = await request({
        port: started.port,
        ca: tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "same-key" }),
        body: { url: FIXTURE_URL },
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.jobId, first.body.jobId);
      assert.equal((await moneyCounts(ctx.pool)).urlJobs, 2);
      const noBearer = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${first.body.jobId}/completion`,
      });
      assert.equal(noBearer.status, 401);
      assert.notEqual(noBearer.body.state, "completed");
      const ignoredQuery = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${first.body.jobId}?tenantId=tenant-b&actorId=later-a&role=later-consumer`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(ignoredQuery.status, 200);
      assert.equal(ignoredQuery.body.tenantId, "tenant-a");
      assert.equal(ignoredQuery.body.state, "working");
    } finally {
      await closeServer(started);
      await ctx.close();
    }
  });

  test("private and loopback targets are refused outside disposable mode", async () => {
    const ctx = await setupService();
    const bridge = installBridge("http://127.0.0.1:9", {});
    const started = await startServer({
      service: ctx.service,
      tls,
      urlJobTokens: [{ token: TOKEN, tenantId: "tenant-a" }],
      urlJobDisposable: false,
    });
    try {
      for (const url of ["http://127.0.0.1:9/secret", "http://10.1.2.3/a", "http://localhost/a", "http://169.254.169.254/latest"]) {
        const refused = await request({
          port: started.port,
          ca: tls.ca,
          method: "POST",
          path: "/v1/url-jobs",
          headers: authHeaders(TOKEN, { "idempotency-key": `block-${url.length}` }),
          body: { url },
        });
        assert.equal(refused.status, 400, url);
        assert.equal(refused.body.code, "private_target", url);
      }
      assert.equal((await moneyCounts(ctx.pool)).urlJobs, 0);
      assert.equal(bridge.state.calls, 0);
    } finally {
      bridge.restore();
      await closeServer(started);
      await ctx.close();
    }
  });

  test("disposable mode still uses the maintained kernel for a loopback fixture", async () => {
    const ctx = await setupService();
    const bridge = installBridge("http://127.0.0.1:9", {});
    const started = await startServer({
      service: ctx.service,
      tls,
      urlJobTokens: [{ token: TOKEN, tenantId: "tenant-a" }],
      urlJobDisposable: true,
      urlJobFixtureOrigin: "http://127.0.0.1:9",
      urlJobConcurrency: 1,
    });
    try {
      const created = await request({
        port: started.port,
        ca: tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "loopback-fixture" }),
        body: { url: "http://127.0.0.1:9/page" },
      });
      assert.equal(created.status, 201);
      await started.urlJobs.start();
      const view = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${created.body.jobId}`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(view.body.state, "failed");
      assert.equal(view.body.reason, "ssrf_blocked");
      assert.equal(bridge.state.calls, 0);
      const completion = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${created.body.jobId}/completion`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(completion.body.state, "failed");
      assert.equal(completion.body.digest, null);
    } finally {
      bridge.restore();
      await closeServer(started);
      await ctx.close();
    }
  });

  test("a deadline fails the job and cancellation is terminal", async () => {
    const ctx = await setupService();
    let releaseSlow;
    const bridge = installBridge("http://127.0.0.1:9", {
      "https://fixture.example/slow": (_target, init) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" })), 5000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" }));
        }, { once: true });
      }),
      "https://fixture.example/cancel": (_target, init) => new Promise((resolve, reject) => {
        releaseSlow = () => resolve({
          status: 200,
          url: "https://fixture.example/cancel",
          headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
          body: {
            getReader() {
              let delivered = false;
              return {
                async read() {
                  if (delivered) return { done: true };
                  delivered = true;
                  return { done: false, value: new TextEncoder().encode(FIXTURE_HTML) };
                },
                async cancel() {},
              };
            },
          },
        });
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" }));
        }, { once: true });
      }),
    });
    const deadlineServer = await startServer({
      service: ctx.service,
      tls,
      urlJobTokens: [{ token: TOKEN, tenantId: "tenant-a" }],
      urlJobConcurrency: 1,
      urlJobDeadlineMs: 40,
    });
    try {
      const created = await request({
        port: deadlineServer.port,
        ca: tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "deadline" }),
        body: { url: "https://fixture.example/slow" },
      });
      await deadlineServer.urlJobs.start();
      const failed = await request({
        port: deadlineServer.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${created.body.jobId}`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(failed.body.state, "failed");
      assert.equal(failed.body.reason, "deadline");
      const completion = await request({
        port: deadlineServer.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${created.body.jobId}/completion`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(completion.body.state, "failed");
      assert.equal(completion.body.digest, null);
    } finally {
      await closeServer(deadlineServer);
    }

    const cancelServer = await startServer({
      service: ctx.service,
      tls,
      urlJobTokens: [{ token: TOKEN, tenantId: "tenant-a" }],
      urlJobConcurrency: 1,
      urlJobDeadlineMs: 5000,
    });
    try {
      const created = await request({
        port: cancelServer.port,
        ca: tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "cancel-me" }),
        body: { url: "https://fixture.example/cancel" },
      });
      const seen = bridge.state.calls;
      const pending = cancelServer.urlJobs.start();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("worker did not enter")), 2000);
        const poll = () => {
          if (bridge.state.calls > seen && releaseSlow) {
            clearTimeout(timer);
            resolve();
            return;
          }
          setTimeout(poll, 5);
        };
        poll();
      });
      const cancelled = await request({
        port: cancelServer.port,
        ca: tls.ca,
        method: "POST",
        path: `/v1/url-jobs/${created.body.jobId}/cancel`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(cancelled.status, 200);
      assert.equal(cancelled.body.state, "cancelled");
      assert.equal(cancelled.body.reason, "cancelled");
      releaseSlow();
      await pending;
      const after = await request({
        port: cancelServer.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${created.body.jobId}/completion`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(after.body.state, "cancelled");
      assert.equal(after.body.digest, null);
      const repeat = await request({
        port: cancelServer.port,
        ca: tls.ca,
        method: "POST",
        path: `/v1/url-jobs/${created.body.jobId}/cancel`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(repeat.body.state, "cancelled");
      const blocked = await request({
        port: cancelServer.port,
        ca: tls.ca,
        method: "POST",
        path: `/v1/url-jobs/${created.body.jobId}/cancel`,
        headers: authHeaders(OTHER),
      });
      assert.equal(blocked.status, 401);
    } finally {
      bridge.restore();
      await closeServer(cancelServer);
      await ctx.close();
    }
  });

  test("restart terminally marks an interrupted extraction and does not extract again", async () => {
    const ctx = await setupService();
    const bridge = installBridge("http://127.0.0.1:9", { [FIXTURE_URL]: "/page" });
    const started = await startServer({
      service: ctx.service,
      tls,
      urlJobTokens: [{ token: TOKEN, tenantId: "tenant-a" }],
    });
    try {
      const created = await request({
        port: started.port,
        ca: tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "interrupted" }),
        body: { url: FIXTURE_URL },
      });
      await ctx.journal.updateUrlJob(created.body.jobId, (record) => ({ ...record, extractStarted: true }));
      const restarted = createUrlJobs({
        journal: ctx.journal,
        tokens: [{ token: TOKEN, tenantId: "tenant-a" }],
        concurrency: 1,
      });
      await restarted.start();
      const view = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${created.body.jobId}`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(view.body.state, "failed");
      assert.equal(view.body.reason, "restart_interrupted");
      assert.equal(bridge.state.calls, 0);
      const completion = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${created.body.jobId}/completion`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(completion.body.state, "failed");
      await ctx.journal.updateUrlJob(created.body.jobId, (record) => {
        const next = { ...record };
        delete next.state;
        return next;
      });
      const unknown = await request({
        port: started.port,
        ca: tls.ca,
        method: "GET",
        path: `/v1/url-jobs/${created.body.jobId}/completion`,
        headers: authHeaders(TOKEN),
      });
      assert.equal(unknown.body.state, "unknown");
      assert.equal(unknown.body.digest, null);
      assert.notEqual(unknown.body.state, "completed");
    } finally {
      bridge.restore();
      await closeServer(started);
      await ctx.close();
    }
  });

  test("bounded concurrency does not overlap when the limit is one", async () => {
    const ctx = await setupService();
    const releases = [];
    const gate = (_target, _init) => new Promise((resolve) => {
      releases.push(() => resolve({
        status: 200,
        url: _target,
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
        body: {
          getReader() {
            let delivered = false;
            return {
              async read() {
                if (delivered) return { done: true };
                delivered = true;
                return { done: false, value: new TextEncoder().encode(FIXTURE_HTML) };
              },
              async cancel() {},
            };
          },
        },
      }));
    });
    const bridge = installBridge("http://127.0.0.1:9", {
      "https://fixture.example/a": gate,
      "https://fixture.example/b": gate,
    });
    const started = await startServer({
      service: ctx.service,
      tls,
      urlJobTokens: [{ token: TOKEN, tenantId: "tenant-a" }],
      urlJobConcurrency: 1,
      urlJobDeadlineMs: 5000,
    });
    try {
      await request({
        port: started.port, ca: tls.ca, method: "POST", path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "conc-a" }),
        body: { url: "https://fixture.example/a" },
      });
      await request({
        port: started.port, ca: tls.ca, method: "POST", path: "/v1/url-jobs",
        headers: authHeaders(TOKEN, { "idempotency-key": "conc-b" }),
        body: { url: "https://fixture.example/b" },
      });
      const pending = started.urlJobs.start();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("first job did not start")), 2000);
        const poll = () => {
          if (releases.length >= 1) { clearTimeout(timer); resolve(); return; }
          setTimeout(poll, 5);
        };
        poll();
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(bridge.state.maxActive, 1);
      assert.equal(releases.length, 1);
      releases[0]();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("second job did not start")), 2000);
        const poll = () => {
          if (releases.length >= 2) { clearTimeout(timer); resolve(); return; }
          setTimeout(poll, 5);
        };
        poll();
      });
      assert.equal(bridge.state.maxActive, 1);
      releases[1]();
      await pending;
      assert.equal(bridge.state.calls, 2);
      assert.equal((await moneyCounts(ctx.pool)).invocations, 0);
    } finally {
      bridge.restore();
      await closeServer(started);
      await ctx.close();
    }
  });
});
