import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { correctContribution, prepareContribution } from "../src/contribution.mjs";
import { taskDigest } from "../src/intake.mjs";
import { runCommercialDeliver } from "../commercial/deliver.mjs";

const repo = join(import.meta.dirname, "..", "..", "..");
const exp = join(repo, "experiments", "seller-repair-service-100266");
const node = process.execPath;
const oldNode = "/exec-daemon/node";
const [major, minor] = process.versions.node.split(".").map(Number);

function launch(exec, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exec, args, {
      cwd: options.cwd || repo,
      env: options.env || { ...process.env },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    if (options.input != null) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function run(args, input = null) {
  return launch(node, args, { input });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

function send(res, status, body, headers = {}) {
  const encoded = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, {
    "content-type": headers["content-type"] || "application/json",
    "content-length": encoded.length,
    ...headers,
  });
  res.end(encoded);
}

const WIDGET_DOCUMENT = {
  openapi: "3.1.0",
  paths: {
    "/v1/widget": {
      get: {
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["widget"],
                  properties: {
                    widget: {
                      type: "object",
                      required: ["color"],
                      properties: { color: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

function requestFor(overrides) {
  return {
    schema: "samedaydesk.seller-repair-caller-request.v1",
    callerId: "visitor-alpha",
    task: "Caller asks whether GET /v1/alpha on the named origin returns status equal to ready.",
    origin: "https://widget.example",
    operation: "GET /v1/alpha",
    sdk: "node-https@22",
    runtime: "node/22.22.2",
    expect: { path: "status", value: "ready" },
    limits: {
      probes: 4,
      bodyBytes: 4096,
      deadlineMs: 1000,
      totalBodyBytes: 16384,
      totalResponseMs: 4000,
      redirects: 0,
      outputBytes: 65536,
    },
    question: "useful_output",
    paidIntent: false,
    ...overrides,
  };
}

test("receiving uses the declared Node pin", () => {
  assert.ok(major > 22 || (major === 22 && minor >= 22), process.version);
});

test("missing and malformed deliver input is help, not a completed task", async () => {
  const missing = await run([join(exp, "bin", "commercial-path.mjs"), "deliver"]);
  assert.equal(missing.status, 2, missing.stdout);
  assert.match(missing.stderr, /deliver_request_required/);
  assert.match(missing.stderr, /self-test/);
  const missingBody = JSON.parse(missing.stdout);
  assert.equal(missingBody.ok, false);
  assert.equal(missingBody.executed, false);
  assert.equal(missingBody.help, true);
  assert.equal(missingBody.paymentSent, false);
  const empty = await run([join(exp, "bin", "commercial-path.mjs"), "deliver", "--request", "-"], " \n");
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /deliver_request_required/);
  const malformed = await run([join(exp, "bin", "commercial-path.mjs"), "deliver", "--request", "-"], "{");
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /request_malformed/);
  assert.equal(JSON.parse(malformed.stdout).executed, false);
  const source = await readFile(join(exp, "commercial", "caller-request.mjs"), "utf8");
  assert.equal(/rejectUnauthorized\s*[:=]/.test(source), false);
  assert.equal(source.includes("https.createServer"), false);
  assert.equal(source.includes("defaultCallers"), false);
  assert.equal(source.includes("certMaterial"), false);
  assert.equal(source.includes('"rejectUnauthorized"'), true);
});

test("a non-QA library caller does not enter the fixture servers", async () => {
  const other = {
    callerId: "other-visitor",
    origin: "https://other.example",
    operation: "GET /v1/other",
    sdk: "curl/8",
    expect: { path: "status", value: "ready" },
  };
  const refused = await runCommercialDeliver({ repairCaller: other, negativeCaller: { ...other, sdk: "python-httpx@1" } });
  assert.equal(refused.reason, "caller_request_required");
  assert.equal(refused.ok, false);
  assert.equal(refused.fixtureTransport, false);
  assert.equal(refused.paymentSent, false);
});

test("two supplied caller tasks change with the input, including a useful negative", { timeout: 30_000 }, async () => {
  const hits = { alpha: 0, beta: 0, fixture: 0 };
  const server = http.createServer((req, res) => {
    assert.equal(req.headers["x-fixture-mode"], undefined);
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (path === "/v1/alpha") {
      hits.alpha += 1;
      return send(res, 200, { status: "ready" });
    }
    if (path === "/v1/beta") {
      hits.beta += 1;
      return send(res, 200, { note: "up" });
    }
    if (path === "/openapi.json") return send(res, 200, { openapi: "3.1.0", paths: {} });
    hits.fixture += 1;
    return send(res, 200, { quota: { remaining: "3" } });
  });
  await listen(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const dir = await mkdtemp(join(tmpdir(), "caller-exec-100314-"));
  try {
    const positive = requestFor({
      probeConsent: { class: "loopback", confirmed: true, baseUrl },
    });
    const negative = requestFor({
      callerId: "visitor-beta",
      task: "Caller asks whether GET /v1/beta on the named origin returns status equal to ready.",
      operation: "GET /v1/beta",
      sdk: "python-httpx@1",
      probeConsent: { class: "loopback", confirmed: true, baseUrl },
    });
    const positivePath = join(dir, "positive.json");
    const negativePath = join(dir, "negative.json");
    await writeFile(positivePath, `${JSON.stringify(positive)}\n`);
    await writeFile(negativePath, `${JSON.stringify(negative)}\n`);
    const first = await run([
      join(exp, "bin", "commercial-path.mjs"), "deliver", "--request", positivePath, "--out", join(dir, "positive"),
    ]);
    const second = await run([
      join(exp, "bin", "commercial-path.mjs"), "deliver", "--request", negativePath, "--out", join(dir, "negative"),
    ]);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const ready = JSON.parse(first.stdout);
    const missing = JSON.parse(second.stdout);
    assert.equal(ready.classification.useful, true);
    assert.equal(ready.observation.independentlyObserved, true);
    assert.equal(ready.fixtureTransport, false);
    assert.equal(ready.tlsBypass, false);
    assert.equal(ready.standInResponse, false);
    assert.equal(ready.paymentSent, false);
    assert.equal(ready.order, false);
    assert.equal(ready.paid.priceAtomic, "10000");
    assert.equal(ready.paid.usefulDelta, false);
    assert.equal(ready.paid.separatedFromFreeComparison, true);
    assert.equal(ready.resources.cash.atomic, "0");
    assert.equal(ready.resources.modelCost, "unknown");
    assert.equal(ready.resources.reviewCost, "unknown");
    assert.equal(ready.causal.source, "unbound");
    assert.equal(ready.causal.commerceEventId, "unbound");
    assert.equal(ready.causal.authority, false);
    assert.equal(missing.classification.useful, false);
    assert.equal(missing.classification.reason, "missing_field_not_paid_demand");
    assert.equal(missing.missingFieldIsPaidDelta, false);
    assert.equal(missing.order, false);
    assert.equal(missing.purchaseRecommended, false);
    assert.notEqual(ready.operationId, missing.operationId);
    assert.notEqual(ready.inputsSha256, missing.inputsSha256);
    assert.notEqual(ready.classification.useful, missing.classification.useful);
    assert.equal(first.stdout.includes("commercial-path-disposable-token"), false);
    assert.equal(hits.fixture, 0);
    assert.ok(hits.alpha > 0);
    assert.ok(hits.beta > 0);
    const changed = requestFor({
      task: "Caller asks whether GET /v1/alpha on the named origin returns status equal to down.",
      expect: { path: "status", value: "down" },
      probeConsent: { class: "loopback", confirmed: true, baseUrl },
    });
    const changedPath = join(dir, "changed.json");
    await writeFile(changedPath, `${JSON.stringify(changed)}\n`);
    const third = await run([join(exp, "bin", "commercial-path.mjs"), "deliver", "--request", changedPath]);
    assert.equal(third.status, 0, third.stderr || third.stdout);
    const down = JSON.parse(third.stdout);
    assert.equal(down.classification.useful, false);
    assert.notEqual(down.inputsSha256, ready.inputsSha256);
    const artifact = JSON.parse(await readFile(join(dir, "positive", "regression.json"), "utf8"));
    assert.equal(artifact.schema, "samedaydesk.seller-repair-caller-regression.v1");
    assert.equal(artifact.trusted, false);
    assert.equal(artifact.visitorExecution, true);
    assert.equal(artifact.fixtureTransport, false);
    assert.equal(artifact.deployedCounterpartyRepair, false);
  } finally {
    await close(server);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a caller-owned retest records the actual change and does not deploy", { timeout: 30_000 }, async () => {
  const before = http.createServer((req, res) => {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (path === "/openapi.json") return send(res, 200, WIDGET_DOCUMENT);
    return send(res, 200, { widget: { sku: "a" } });
  });
  const after = http.createServer((req, res) => {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (path === "/openapi.json") return send(res, 200, WIDGET_DOCUMENT);
    return send(res, 200, { widget: { sku: "a", color: "blue" } });
  });
  await listen(before);
  await listen(after);
  const dir = await mkdtemp(join(tmpdir(), "caller-retest-100314-"));
  try {
    const body = requestFor({
      callerId: "visitor-widget",
      task: "Caller asks whether GET /v1/widget on the named origin returns widget.color equal to blue.",
      operation: "GET /v1/widget",
      expect: { path: "widget.color", value: "blue" },
      probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${before.address().port}` },
      retest: { baseUrl: `http://127.0.0.1:${after.address().port}` },
      patch: {
        kind: "response_overlay",
        instructions: ["Return widget.color as the string blue from the caller-owned retest."],
        responseOverlay: { widget: { color: "blue" } },
      },
    });
    const path = join(dir, "retest.json");
    await writeFile(path, `${JSON.stringify(body)}\n`);
    const result = await run([join(exp, "bin", "commercial-path.mjs"), "deliver", "--request", path]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.retest.deployedCounterpartyRepair, false);
    assert.equal(receipt.retest.counterpartyMutated, false);
    assert.equal(receipt.retest.changedOutput.before, null);
    assert.equal(receipt.retest.changedOutput.after, "blue");
    assert.equal(receipt.retest.changedOutput.changed, true);
    assert.equal(receipt.retest.useful, true);
    assert.equal(receipt.order, false);
    assert.equal(receipt.paymentSent, false);
  } finally {
    await close(before);
    await close(after);
    await rm(dir, { recursive: true, force: true });
  }
});

test("observed-only stays caller-supplied, and fixture transport cannot reach a server", { timeout: 20_000 }, async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    send(res, 200, { status: "ready" });
  });
  await listen(server);
  const dir = await mkdtemp(join(tmpdir(), "caller-observed-100314-"));
  try {
    const observed = requestFor({
      observed: { status: 200, json: { status: "ready" }, contentType: "application/json" },
      retest: { observed: { status: 200, json: { status: "down" }, contentType: "application/json" } },
    });
    const leak = requestFor({
      probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${server.address().port}` },
      socket: { host: "127.0.0.1", port: server.address().port, rejectUnauthorized: false },
    });
    const observedPath = join(dir, "observed.json");
    const leakPath = join(dir, "leak.json");
    await writeFile(observedPath, `${JSON.stringify(observed)}\n`);
    await writeFile(leakPath, `${JSON.stringify(leak)}\n`);
    const evidence = await run([join(exp, "bin", "commercial-path.mjs"), "deliver", "--request", observedPath]);
    assert.equal(evidence.status, 0, evidence.stderr || evidence.stdout);
    const body = JSON.parse(evidence.stdout);
    assert.equal(body.observation.independentlyObserved, false);
    assert.equal(body.observation.source, "caller_supplied");
    assert.equal(body.consentSupplied, false);
    assert.equal(body.resources.probes, 0);
    assert.equal(body.classification.useful, true);
    assert.equal(body.retest.independentlyObserved, false);
    assert.equal(body.retest.callerSupplied, true);
    assert.equal(body.retest.deployedCounterpartyRepair, false);
    assert.equal(body.retest.changedOutput.changed, true);
    assert.equal(hits, 0);
    const leaked = await run([join(exp, "bin", "commercial-path.mjs"), "deliver", "--request", leakPath]);
    assert.equal(leaked.status, 2, leaked.stdout);
    assert.equal(JSON.parse(leaked.stdout).reason, "fixture_transport_refused");
    assert.equal(JSON.parse(leaked.stdout).executed, false);
    assert.equal(hits, 0);
  } finally {
    await close(server);
    await rm(dir, { recursive: true, force: true });
  }
});

test("deadline, body, output, private, redirect, and real DNS limits are not repairs", { timeout: 30_000 }, async () => {
  const slow = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write("{");
  });
  const large = http.createServer((_req, res) => {
    send(res, 200, { status: "x".repeat(80) });
  });
  const redirect = http.createServer((_req, res) => {
    res.writeHead(302, { location: "/elsewhere" });
    res.end();
  });
  const malformed = http.createServer((_req, res) => {
    send(res, 200, "not-json", { "content-type": "text/plain" });
  });
  await Promise.all([listen(slow), listen(large), listen(redirect), listen(malformed)]);
  const dir = await mkdtemp(join(tmpdir(), "caller-limits-100314-"));
  try {
    async function deliver(body) {
      const path = join(dir, `${createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 8)}.json`);
      await writeFile(path, `${JSON.stringify(body)}\n`);
      const result = await run([join(exp, "bin", "commercial-path.mjs"), "deliver", "--request", path]);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.paymentSent, false);
      assert.equal(receipt.order, false);
      assert.equal(receipt.purchaseRecommended, false);
      assert.equal(receipt.fixtureTransport, false);
      return receipt;
    }
    const deadline = await deliver(requestFor({
      limits: { probes: 2, bodyBytes: 1024, deadlineMs: 20, totalBodyBytes: 4096, totalResponseMs: 4000, redirects: 0, outputBytes: 65536 },
      probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${slow.address().port}` },
    }));
    assert.equal(deadline.classification.reason, "body_deadline");
    const capped = await deliver(requestFor({
      operation: "GET /v1/large",
      task: "Caller asks whether GET /v1/large on the named origin returns status equal to ready.",
      limits: { probes: 2, bodyBytes: 32, deadlineMs: 1000, totalBodyBytes: 4096, totalResponseMs: 4000, redirects: 0, outputBytes: 65536 },
      probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${large.address().port}` },
    }));
    assert.equal(capped.classification.reason, "body_ceiling");
    const moved = await deliver(requestFor({
      operation: "GET /v1/moved",
      task: "Caller asks whether GET /v1/moved on the named origin returns status equal to ready.",
      probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${redirect.address().port}` },
    }));
    assert.equal(moved.classification.reason, "redirect_unfollowed");
    assert.equal(moved.resources.probes > 0, true);
    const broken = await deliver(requestFor({
      operation: "GET /v1/broken",
      task: "Caller asks whether GET /v1/broken on the named origin returns status equal to ready.",
      probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${malformed.address().port}` },
    }));
    assert.equal(broken.classification.useful, false);
    assert.equal(broken.classification.reason, "body_not_observed");
    const privateTarget = await deliver(requestFor({
      origin: "https://10.1.2.3",
      task: "Caller asks whether a private address for GET /v1/alpha is refused before a probe.",
      probeConsent: { class: "public-https", confirmed: true },
    }));
    assert.equal(privateTarget.classification.reason, "target_not_public");
    assert.equal(privateTarget.resources.probes, 0);
    const dns = await deliver(requestFor({
      origin: "https://caller-dns.invalid",
      task: "Caller asks whether an unresolvable public origin is a DNS limit rather than a repair.",
      probeConsent: { class: "public-https", confirmed: true },
    }));
    assert.equal(dns.classification.reason, "dns_failed");
    assert.equal(dns.resources.probes, 0);
    const wide = requestFor({ observed: { status: 402, json: { error: "payment" }, contentType: "application/json" } });
    const priced = await deliver(wide);
    assert.equal(priced.classification.reason, "paid_body_not_read");
    assert.equal(priced.target402IsOrder, false);
    assert.equal(priced.paid.usefulDelta, false);
    assert.equal(priced.order, false);
    const cappedOut = await deliver(requestFor({
      observed: { status: 200, json: { status: "ready" }, contentType: "application/json" },
      limits: { ...requestFor({}).limits, outputBytes: 512 },
    }));
    assert.equal(cappedOut.reason, "output_ceiling");
    assert.equal(cappedOut.useful, false);
    assert.ok(Buffer.byteLength(JSON.stringify(cappedOut)) <= 512);
    const producer = await deliver(requestFor({
      observed: { status: 200, json: { status: "ready" }, contentType: "application/json" },
      producer: { commerceEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    }));
    assert.equal(producer.causal.commerceEventId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(producer.causal.bound, true);
    assert.equal(producer.causal.source, "producer");
    assert.equal(producer.causal.authority, false);
  } finally {
    await Promise.all([close(slow), close(large), close(redirect), close(malformed)]);
    await rm(dir, { recursive: true, force: true });
  }
});

test("later reruns supplied inputs and ignores a claimed retest", { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "caller-later-100314-"));
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    send(res, 200, { status: "ready" });
  });
  await listen(server);
  try {
    const task = "Caller asks whether GET /v1/alpha on the named origin returns status equal to ready.";
    const first = requestFor({
      observed: { status: 200, json: { status: "ready" }, contentType: "application/json" },
    });
    const firstPath = join(dir, "first.json");
    await writeFile(firstPath, `${JSON.stringify(first)}\n`);
    const delivered = await run([
      join(exp, "bin", "commercial-path.mjs"), "deliver", "--request", firstPath, "--out", dir,
    ]);
    assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
    const artifactPath = join(dir, "regression.json");
    const compatible = requestFor({
      observed: { status: 200, json: { note: "up" }, contentType: "application/json" },
      independentRetest: true,
    });
    const compatiblePath = join(dir, "compatible.json");
    await writeFile(compatiblePath, `${JSON.stringify(compatible)}\n`);
    const fresh = await run([
      join(exp, "bin", "commercial-path.mjs"), "later", "--artifact", artifactPath, "--caller", compatiblePath,
    ]);
    assert.equal(fresh.status, 0, fresh.stderr || fresh.stdout);
    const freshBody = JSON.parse(fresh.stdout);
    assert.equal(freshBody.fresh, true);
    assert.equal(freshBody.predicateApplies, true);
    assert.equal(freshBody.executed, true);
    assert.equal(freshBody.probed, false);
    assert.equal(freshBody.assertionIgnored, true);
    assert.equal(freshBody.usefulTransferred, false);
    assert.equal(freshBody.paymentPermitted, false);
    assert.equal(freshBody.receipt.classification.useful, false);
    assert.equal(freshBody.receipt.classification.reason, "missing_field_not_paid_demand");
    assert.equal(hits, 0);
    const claim = {
      callerId: "visitor-alpha",
      taskDigest: taskDigest(task),
      sdk: "node-https@22",
      origin: "https://widget.example",
      method: "GET",
      resource: "/v1/alpha",
      expectValue: "ready",
      independentRetest: true,
      retest: { useful: true },
    };
    const claimPath = join(dir, "claim.json");
    await writeFile(claimPath, `${JSON.stringify(claim)}\n`);
    const claimed = await run([
      join(exp, "bin", "commercial-path.mjs"), "later", "--artifact", artifactPath, "--caller", claimPath,
    ]);
    assert.equal(claimed.status, 2, claimed.stdout);
    const claimedBody = JSON.parse(claimed.stdout);
    assert.equal(claimedBody.reason, "caller_assertion_is_not_execution");
    assert.equal(claimedBody.probed, false);
    assert.equal(claimedBody.executed, false);
    assert.equal(claimedBody.usefulTransferred, false);
    assert.equal(hits, 0);
    const different = requestFor({
      operation: "GET /v1/gamma",
      task: "Caller asks whether GET /v1/gamma on the named origin returns status equal to ready.",
      observed: { status: 200, json: { status: "ready" }, contentType: "application/json" },
    });
    const differentPath = join(dir, "different.json");
    await writeFile(differentPath, `${JSON.stringify(different)}\n`);
    const again = await run([
      join(exp, "bin", "commercial-path.mjs"), "later", "--artifact", artifactPath, "--caller", differentPath,
    ]);
    assert.equal(again.status, 0, again.stderr || again.stdout);
    const againBody = JSON.parse(again.stdout);
    assert.equal(againBody.fresh, true);
    assert.equal(againBody.predicateApplies, false);
    assert.equal(againBody.reason, "stale_applicability");
    assert.equal(againBody.receipt.operationId, "GET /v1/gamma");
    assert.equal(againBody.receipt.classification.useful, true);
    const owner = { ...claim, independentRetest: false };
    delete owner.retest;
    owner.callerId = "other-owner";
    const ownerPath = join(dir, "owner.json");
    await writeFile(ownerPath, `${JSON.stringify(owner)}\n`);
    const wrong = await run([
      join(exp, "bin", "commercial-path.mjs"), "later", "--artifact", artifactPath, "--caller", ownerPath,
    ]);
    assert.equal(wrong.status, 2, wrong.stdout);
    assert.equal(JSON.parse(wrong.stdout).reason, "wrong_owner");
    assert.equal(JSON.parse(wrong.stdout).probed, false);
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    const trustedPath = join(dir, "trusted.json");
    await writeFile(trustedPath, `${JSON.stringify({ ...artifact, trusted: true })}\n`);
    const trustedCaller = requestFor({
      probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${server.address().port}` },
    });
    const trustedCallerPath = join(dir, "trusted-caller.json");
    await writeFile(trustedCallerPath, `${JSON.stringify(trustedCaller)}\n`);
    const trusted = await run([
      join(exp, "bin", "commercial-path.mjs"), "later", "--artifact", trustedPath, "--caller", trustedCallerPath,
    ]);
    assert.equal(trusted.status, 2, trusted.stdout);
    assert.equal(JSON.parse(trusted.stdout).reason, "submitted_artifact_is_not_trusted");
    assert.equal(hits, 0);
    const contribution = prepareContribution({
      intake: {
        callerId: "visitor-alpha",
        expectedUsefulOutput: { paths: ["status"] },
        method: "GET",
        origin: "https://widget.example",
        resource: "/v1/alpha",
        declaredRuntime: "node/22.22.2",
        declaredSdk: "node-https@22",
        taskDigest: artifact.taskDigest,
      },
      classification: { outcome: "unknown" },
      patch: { kind: "response_overlay", instructions: ["return status"], responseOverlay: { status: "ready" } },
      authorized: true,
      now: Date.parse("2020-01-01T00:00:00.000Z"),
    });
    assert.equal(contribution.accepted, true);
    const expiredArtifact = { ...artifact, retention: { contribution } };
    const expiredPath = join(dir, "expired.json");
    await writeFile(expiredPath, `${JSON.stringify(expiredArtifact)}\n`);
    const expiredCaller = { ...owner, callerId: "visitor-alpha", now: Date.parse("2030-01-01T00:00:00.000Z") };
    const expiredCallerPath = join(dir, "expired-caller.json");
    await writeFile(expiredCallerPath, `${JSON.stringify(expiredCaller)}\n`);
    const expired = await run([
      join(exp, "bin", "commercial-path.mjs"), "later", "--artifact", expiredPath, "--caller", expiredCallerPath,
    ]);
    assert.equal(expired.status, 2, expired.stdout);
    assert.equal(JSON.parse(expired.stdout).reason, "expired");
    assert.equal(JSON.parse(expired.stdout).probed, false);
    const corrected = correctContribution(contribution, {
      now: Date.parse("2020-01-02T00:00:00.000Z"),
      replacement: {
        intake: {
          callerId: "visitor-alpha",
          expectedUsefulOutput: { paths: ["status"] },
          method: "GET",
          origin: "https://widget.example",
          resource: "/v1/alpha",
          declaredRuntime: "node/22.22.2",
          declaredSdk: "node-https@22",
          taskDigest: artifact.taskDigest,
        },
        classification: { outcome: "unknown" },
        patch: { kind: "response_overlay", instructions: ["corrected"], responseOverlay: { status: "ready" } },
      },
    });
    const correctedArtifact = {
      ...artifact,
      retention: { contribution, corrections: [corrected.control] },
    };
    const correctedPath = join(dir, "corrected-artifact.json");
    await writeFile(correctedPath, `${JSON.stringify(correctedArtifact)}\n`);
    const correctedCaller = { ...expiredCaller, now: Date.parse("2020-01-03T00:00:00.000Z") };
    const correctedCallerPath = join(dir, "corrected-caller.json");
    await writeFile(correctedCallerPath, `${JSON.stringify(correctedCaller)}\n`);
    const correctedRun = await run([
      join(exp, "bin", "commercial-path.mjs"), "later", "--artifact", correctedPath, "--caller", correctedCallerPath,
    ]);
    assert.equal(correctedRun.status, 2, correctedRun.stdout);
    assert.equal(JSON.parse(correctedRun.stdout).reason, "corrected");
    assert.equal(JSON.parse(correctedRun.stdout).usefulTransferred, false);
    assert.equal(hits, 0);
  } finally {
    await close(server);
    await rm(dir, { recursive: true, force: true });
  }
});

test("cold 0.3.0 runs outside the repo and leaves frozen archives unchanged", { timeout: 60_000 }, async () => {
  const packed = await run([join(exp, "bin", "pack-consumer-030.mjs")]);
  assert.equal(packed.status, 0, packed.stderr);
  const provenance = JSON.parse(await readFile(join(exp, "candidate", "provenance-0.3.0.json"), "utf8"));
  assert.equal(provenance.version, "0.3.0");
  assert.equal(provenance.productionHosted, false);
  const frozen02 = await readFile(join(exp, "candidate", "seller-repair-external-consumer-0.2.0.tar.gz"));
  const published = await readFile(join(repo, "public-acquisition/bytes/seller-repair-external-consumer/0.2.0/seller-repair-external-consumer-0.2.0.tar.gz"));
  assert.equal(createHash("sha256").update(frozen02).digest("hex"), "86e55a75f7e7e5c5ad188de8b20c64648f40c236b11981186b56abeb6d11350f");
  assert.equal(createHash("sha256").update(published).digest("hex"), "86e55a75f7e7e5c5ad188de8b20c64648f40c236b11981186b56abeb6d11350f");
  const frozen01 = await readFile(join(exp, "candidate", "seller-repair-external-consumer-0.1.0.tar.gz"));
  assert.equal(createHash("sha256").update(frozen01).digest("hex"), "3f3552e9cdedff9910211b1820b229daa834cf3811fcc5b38035046cefda4a27");
  const manifest = await readFile(join(repo, "public-acquisition/manifest.json"), "utf8");
  assert.equal(manifest.includes("0.3.0"), false);
  const patch = await readFile(join(exp, "candidate", "ROOT-PUBLIC-ACQUISITION-0.3.0.patch"), "utf8");
  assert.match(patch, /0\.3\.0/);
  assert.match(patch, new RegExp(provenance.sha256));
  const root = await mkdtemp(join(tmpdir(), "seller-repair-cold-100314-"));
  const outside = root.startsWith(repo) ? join(tmpdir(), "seller-repair-cold-100314-outside") : root;
  if (outside !== root) await rm(outside, { recursive: true, force: true });
  await mkdtemp(outside).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(outside, { recursive: true });
  });
  try {
    const extracted = spawnSync("tar", ["-xzf", join(exp, "candidate", "seller-repair-external-consumer-0.3.0.tar.gz"), "-C", outside], { encoding: "utf8" });
    assert.equal(extracted.status, 0, extracted.stderr);
    const blocked = spawnSync(oldNode, [join(outside, "package/bin/caller-deliver.mjs"), "deliver"], {
      cwd: outside,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME || "/tmp" },
    });
    assert.equal(blocked.status, 2, blocked.stderr);
    assert.match(blocked.stderr, /node_pin_unsatisfied/);
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits += 1;
      assert.equal(req.headers["x-fixture-mode"], undefined);
      const path = new URL(req.url, "http://127.0.0.1").pathname;
      if (path === "/openapi.json") return send(res, 200, { openapi: "3.1.0", paths: {} });
      send(res, 200, { status: "ready" });
    });
    await listen(server);
    try {
      const body = requestFor({
        probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${server.address().port}` },
      });
      const requestPath = join(outside, "request.json");
      await writeFile(requestPath, `${JSON.stringify(body)}\n`);
      const cold = await launch(node, [join(outside, "package/bin/caller-deliver.mjs"), "deliver", "--request", requestPath, "--out", outside], {
        cwd: outside,
        env: { PATH: process.env.PATH, HOME: process.env.HOME || "/tmp" },
      });
      assert.equal(cold.status, 0, cold.stderr || cold.stdout);
      const receipt = JSON.parse(cold.stdout);
      assert.equal(receipt.classification.useful, true);
      assert.equal(receipt.fixtureTransport, false);
      assert.equal(receipt.paymentSent, false);
      assert.equal(receipt.resources.modelCost, "unknown");
      assert.equal(receipt.causal.source, "unbound");
      assert.ok(hits > 0);
      const callerPath = join(outside, "caller.json");
      await writeFile(callerPath, `${JSON.stringify({
        callerId: "visitor-alpha",
        taskDigest: receipt.taskDigest,
        sdk: "node-https@22",
        origin: "https://widget.example",
        method: "GET",
        resource: "/v1/alpha-changed",
        expectValue: "ready",
        independentRetest: true,
      })}\n`);
      const later = await launch(node, [
        join(outside, "package/bin/caller-deliver.mjs"),
        "later",
        "--artifact",
        join(outside, "regression.json"),
        "--caller",
        callerPath,
      ], {
        cwd: outside,
        env: { PATH: process.env.PATH, HOME: process.env.HOME || "/tmp" },
      });
      assert.equal(later.status, 2, later.stdout || later.stderr);
      const laterBody = JSON.parse(later.stdout);
      assert.equal(laterBody.reason, "caller_assertion_is_not_execution");
      assert.equal(laterBody.probed, false);
      assert.equal(laterBody.privateImported, false);
      assert.equal(laterBody.paymentSent, false);
    } finally {
      await close(server);
    }
  } finally {
    await rm(outside, { recursive: true, force: true });
    if (outside !== root) await rm(root, { recursive: true, force: true });
  }
});
