import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import https from "node:https";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { startServer } from "../src/http.mjs";
import { setupService } from "./helpers.mjs";

const TOKEN = "tenant-a-url-job-token";

function makeCerts(dir) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", path.join(dir, "ca.key"), "-out", path.join(dir, "ca.pem"), "-days", "1", "-nodes", "-subj", "/CN=ae14-e08-ca"], { stdio: "ignore" });
  execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-keyout", path.join(dir, "srv.key"), "-out", path.join(dir, "srv.csr"), "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:203.0.113.10"], { stdio: "ignore" });
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
        let parsed = null;
        if (text) {
          try { parsed = JSON.parse(text); } catch { parsed = { unparsed: text }; }
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

async function disposableServer() {
  const ctx = await setupService();
  const tls = makeCerts(mkdtempSync(path.join(tmpdir(), "ae14-e08u-gap-")));
  const started = await startServer({
    service: ctx.service,
    tls,
    urlJobTokens: [{ token: TOKEN, tenantId: "tenant-a" }],
  });
  return {
    ctx,
    tls,
    started,
    async close() {
      started.server.close();
      await ctx.close();
    },
  };
}

describe("unpaid url job contract gaps", { concurrency: 1 }, () => {
  test("submit of https://example.com/ returns an unpaid url job", async () => {
    const box = await disposableServer();
    try {
      const response = await request({
        port: box.started.port,
        ca: box.tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "idempotency-key": "gap-submit-example",
        },
        body: { url: "https://example.com/" },
      });
      assert.equal(response.status, 201);
      assert.equal(response.body?.ok, true);
      assert.equal(response.body?.unpaid, true);
      assert.equal(response.body?.mode, "test-only");
      assert.equal(response.body?.state, "working");
      assert.match(response.body?.jobId, /^j[a-f0-9]{32}$/);
      assert.equal(response.body?.quote, undefined);
      assert.equal(response.body?.paymentCompleted, false);
    } finally {
      await box.close();
    }
  });

  test("url job completion is readable without a query-string actor", async () => {
    const box = await disposableServer();
    try {
      const created = await request({
        port: box.started.port,
        ca: box.tls.ca,
        method: "POST",
        path: "/v1/url-jobs",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "idempotency-key": "gap-completion",
        },
        body: { url: "https://example.com/" },
      });
      assert.equal(created.status, 201);
      const jobId = created.body.jobId;
      const completionPath = `/v1/url-jobs/${jobId}/completion`;
      assert.equal(new URL(completionPath, "https://127.0.0.1").search, "");
      const completion = await request({
        port: box.started.port,
        ca: box.tls.ca,
        method: "GET",
        path: completionPath,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(completion.status, 200);
      assert.deepEqual(Object.keys(completion.body).sort(), ["digest", "jobId", "state", "updatedAt"]);
      assert.equal(completion.body.jobId, jobId);
      assert.equal(completion.body.state, "working");
      assert.equal(completion.body.digest, null);
      const byQuery = await request({
        port: box.started.port,
        ca: box.tls.ca,
        method: "GET",
        path: `${completionPath}?tenantId=tenant-a&actorId=later-a&role=later-consumer`,
      });
      assert.equal(byQuery.status, 401);
      assert.notEqual(byQuery.body?.state, "completed");
    } finally {
      await box.close();
    }
  });

  test("a configured public origin is not refused as loopback_only", async () => {
    const tls = makeCerts(mkdtempSync(path.join(tmpdir(), "ae14-e08u-bind-")));
    let bare = null;
    try {
      const started = await startServer({ service: {}, tls, host: "203.0.113.10" });
      started.server.close();
    } catch (error) {
      bare = error;
    }
    assert.equal(bare?.message, "loopback_only");
    let refusal = null;
    let started = null;
    try {
      started = await startServer({
        service: {},
        tls,
        host: "203.0.113.10",
        publicOrigin: "https://203.0.113.10",
      });
    } catch (error) {
      refusal = error;
    } finally {
      started?.server?.close();
    }
    assert.notEqual(refusal?.message, "loopback_only");
  });
});
