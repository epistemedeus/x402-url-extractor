import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import https from "node:https";
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SellerRepairError } from "../src/errors.mjs";
import { normalizeIntake } from "../src/intake.mjs";
import { runJourney } from "../src/journey.mjs";
import { laterApplicability } from "../src/later.mjs";
import { normalizeMachineRequest } from "../src/machine.mjs";
import { probeOnce } from "../src/probe.mjs";
import { assessPublicOrigin, vendoredPublicAddress } from "../src/public-target.mjs";
import { replayContribution } from "../src/contribution.mjs";
import { publicAddress } from "../../../payment-offer-preflight.mjs";

const PRIVATE = "PRIVATE_SENTINEL_do_not_keep";
const cases = join(import.meta.dirname, "..", "cases");
const quotaCase = JSON.parse(readFileSync(join(cases, "supplied-quota.json"), "utf8"));
const healthCase = JSON.parse(readFileSync(join(cases, "supplied-health.json"), "utf8"));
const incomplete = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "local-audit-incomplete.json"), "utf8"));

function publicLookup(address = "93.184.216.34") {
  return async () => [{ address, family: 4 }];
}

function certMaterial() {
  const dir = mkdtempSync(join(tmpdir(), "seller-repair-cert-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  const out = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-keyout", key, "-out", cert,
    "-days", "1", "-nodes", "-subj", "/CN=quota.example",
  ], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  return { key: readFileSync(key), cert: readFileSync(cert) };
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

function httpsServer(material, onRequest) {
  return listen(https.createServer({ key: material.key, cert: material.cert }, onRequest));
}

const quotaDocument = {
  openapi: "3.1.0",
  paths: {
    "/v1/quota": {
      get: {
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["quota"],
                  properties: {
                    quota: {
                      type: "object",
                      required: ["remaining"],
                      properties: { remaining: { type: "string" } },
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

const healthDocument = {
  openapi: "3.1.0",
  paths: {
    "/v1/health": {
      get: {
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { type: "object", required: ["status"], properties: { status: { type: "string" } } },
              },
            },
          },
        },
      },
    },
  },
};

function sendJson(res, status, body, extra = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(raw), ...extra });
  res.end(raw);
}

test("vendored public-address decisions match the payment-target boundary", async () => {
  for (const address of ["93.184.216.34", "1.1.1.1", "8.8.8.8", "10.1.2.3", "127.0.0.1", "192.168.1.20", "169.254.1.1", "172.16.0.4", "100.64.0.1", "0.0.0.0", "::1", "2001:db8::1", "fc00::1"]) {
    assert.equal(vendoredPublicAddress(address), publicAddress(address), address);
  }
  const samples = [
    "https://quota.example",
    "https://10.1.2.3",
    "https://127.0.0.1",
    "https://93.184.216.34",
    "http://quota.example",
    "https://user:pass@quota.example",
    "https://quota.example/v1/quota",
    "https://quota.example?q=1",
    "https://localhost",
    "https://printer.local",
  ];
  const lookupImpl = publicLookup();
  for (const origin of samples) {
    const vendored = await assessPublicOrigin(origin, { lookupImpl, implementation: "vendored" });
    const imported = await assessPublicOrigin(origin, { lookupImpl });
    assert.equal(imported.implementation, "imported", origin);
    assert.equal(vendored.ok, imported.ok, origin);
    assert.equal(vendored.reason, imported.reason, origin);
  }
});

test("a private answer and a changed answer do not open a connection", async () => {
  const material = certMaterial();
  let hits = 0;
  const server = await httpsServer(material, (req, res) => {
    hits += 1;
    sendJson(res, 200, { quota: { remaining: "3" } });
  });
  const socket = { host: "127.0.0.1", port: server.address().port, rejectUnauthorized: false };
  const machine = normalizeMachineRequest({ ...quotaCase, observed: undefined, patch: undefined });
  try {
    const privateRun = await runJourney({
      intake: machine.intake,
      baseUrl: machine.intake.origin,
      lookupImpl: async () => [{ address: "10.1.2.3", family: 4 }],
      socket,
    });
    assert.equal(privateRun.classification.reason, "target_not_public");
    assert.equal(privateRun.classification.useful, false);
    assert.equal(privateRun.paymentSent, false);
    assert.equal(hits, 0);

    let n = 0;
    const changed = await runJourney({
      intake: machine.intake,
      baseUrl: machine.intake.origin,
      lookupImpl: async () => {
        n += 1;
        return [{ address: n % 2 ? "93.184.216.34" : "1.1.1.1", family: 4 }];
      },
      socket,
    });
    assert.equal(changed.classification.reason, "dns_changed");
    assert.equal(hits, 0);

    let seen = 0;
    const counting = async () => {
      seen += 1;
      return [{ address: "93.184.216.34", family: 4 }];
    };
    await assessPublicOrigin("https://quota.example", { lookupImpl: counting });
    const perCheck = seen;
    let calls = 0;
    const moved = await runJourney({
      intake: machine.intake,
      baseUrl: machine.intake.origin,
      lookupImpl: async () => {
        calls += 1;
        return [{ address: calls <= perCheck ? "93.184.216.34" : "1.1.1.1", family: 4 }];
      },
      socket,
    });
    assert.equal(moved.classification.reason, "dns_changed");
    assert.equal(moved.observation.independentlyObserved, false);
    assert.equal(hits, 0);
  } finally {
    await close(server);
  }
});

test("two supplied operations keep their binding, and the quota defect is retested locally", async () => {
  const material = certMaterial();
  const brokenHits = [];
  const repairedHits = [];
  const broken = await httpsServer(material, (req, res) => {
    const path = new URL(req.url, "https://quota.example").pathname;
    brokenHits.push(path);
    if (path === "/openapi.json") return sendJson(res, 200, quotaDocument);
    return sendJson(res, 200, { quota: { limit: 100 } });
  });
  const repaired = await httpsServer(material, (req, res) => {
    const path = new URL(req.url, "https://quota.example").pathname;
    repairedHits.push(path);
    if (path === "/openapi.json") return sendJson(res, 200, quotaDocument);
    return sendJson(res, 200, { quota: { limit: 100, remaining: "3" } });
  });
  const healthHits = [];
  const health = await httpsServer(material, (req, res) => {
    const path = new URL(req.url, "https://status.example").pathname;
    healthHits.push(path);
    if (path === "/openapi.json") return sendJson(res, 200, healthDocument);
    return sendJson(res, 200, { status: "ready" });
  });
  const lookupImpl = publicLookup();
  const quota = normalizeMachineRequest(quotaCase);
  const healthRequest = normalizeMachineRequest(healthCase);
  try {
    const socket = { host: "127.0.0.1", port: broken.address().port, rejectUnauthorized: false };
    const retestSocket = { host: "127.0.0.1", port: repaired.address().port, rejectUnauthorized: false };
    const result = await runJourney({
      intake: quota.intake,
      baseUrl: quota.intake.origin,
      retestBaseUrl: quota.intake.origin,
      lookupImpl,
      socket,
      retestSocket,
      authorizeContribution: true,
    });
    const direct = await probeOnce({
      baseUrl: "https://quota.example",
      route: "/v1/quota",
      deadlineMs: quota.intake.maxEffort.deadlineMs,
      bodyBytes: quota.intake.maxEffort.bodyBytes,
      socket,
    });
    assert.equal(result.callerId, "quota-caller");
    assert.equal(result.operationId, "GET /v1/quota");
    assert.equal(result.declaredSdk, "node-https@22");
    assert.equal(result.target.origin, "https://quota.example");
    assert.equal(result.classification.outcome, "mismatch");
    assert.equal(result.repair.useful, true);
    assert.equal(result.repair.class, "caller_reviewed_retest");
    assert.equal(result.repair.changedOutput.before, null);
    assert.equal(result.repair.changedOutput.after, "3");
    assert.equal(result.repair.deployedCounterpartyRepair, false);
    assert.equal(result.repair.counterpartyMutated, false);
    assert.equal(result.delivery.deployedCounterpartyRepair, false);
    assert.equal(result.delivery.loopbackFix, false);
    assert.equal(result.delivery.callerReviewedRetest, true);
    assert.equal(direct.digest, result.observed.digest);
    assert.equal(direct.values["quota.remaining"], undefined);
    assert.equal(result.paymentSent, false);
    assert.equal(result.metrics.tokens, "unknown");
    assert.equal(result.metrics.adaptationMaintenanceCost, "unknown");
    assert.equal(result.metrics.callerEffort.redirectsFollowed, 0);
    assert.ok(result.metrics.callerEffort.probes >= 2);
    assert.equal(JSON.stringify(result).includes(PRIVATE), false);

    const later = laterApplicability({
      intake: quota.intake,
      taskDigest: result.taskDigest,
      sdk: "python-httpx@1",
      target: result.target,
      callerId: "later-agent",
      retest: result.repair,
      independentRetest: false,
    });
    assert.equal(later.reason, "stale_applicability");
    assert.equal(later.reused, false);
    const hashOnly = replayContribution({
      contribution: result.contribution,
      now: Date.parse(result.contribution.row.expiresAt) - 1000,
      taskDigest: result.taskDigest,
      sdk: result.declaredSdk,
      target: result.target,
    });
    assert.equal(hashOnly.reused, false);
    assert.equal(hashOnly.reason, "hash_is_not_execution");
    const witnessed = replayContribution({
      contribution: result.contribution,
      now: Date.parse(result.contribution.row.expiresAt) - 1000,
      taskDigest: result.taskDigest,
      sdk: result.declaredSdk,
      target: result.target,
      execution: {
        independent: true,
        callerId: "later-agent",
        operationId: result.operationId,
        observedDigest: direct.digest,
      },
    });
    assert.equal(witnessed.reused, true);
    assert.equal(witnessed.reason, "independent_execution");
    assert.equal(witnessed.usefulTransferred, false);
    assert.equal(witnessed.hashIsExecution, false);

    const healthSocket = { host: "127.0.0.1", port: health.address().port, rejectUnauthorized: false };
    const sameIncomplete = {
      ...incomplete,
      request: { origin: "https://status.example", route: "/v1/health", method: "GET" },
    };
    const ready = await runJourney({
      intake: healthRequest.intake,
      baseUrl: healthRequest.intake.origin,
      lookupImpl,
      socket: healthSocket,
      paidReport: sameIncomplete,
    });
    const healthDirect = await probeOnce({
      baseUrl: "https://status.example",
      route: "/v1/health",
      deadlineMs: healthRequest.intake.maxEffort.deadlineMs,
      bodyBytes: healthRequest.intake.maxEffort.bodyBytes,
      socket: healthSocket,
    });
    assert.equal(ready.callerId, "health-caller");
    assert.equal(ready.operationId, "GET /v1/health");
    assert.equal(ready.declaredSdk, "python-httpx@1");
    assert.equal(ready.classification.outcome, "free_sufficient");
    assert.equal(ready.classification.useful, true);
    assert.equal(ready.repair, null);
    assert.equal(ready.paidAudit.connected, false);
    assert.equal(ready.paidAudit.gap, "audit_incomplete_retained");
    assert.equal(ready.paidAudit.answersUsefulOutput, false);
    assert.equal(ready.paidAudit.purchaseRecommended, false);
    assert.equal(ready.paidAudit.purchasePerformed, false);
    assert.equal(ready.classification.nextAction, "free_sufficient");
    assert.equal(healthDirect.digest, ready.observed.digest);
    assert.equal(healthDirect.values.status, "ready");
    assert.notEqual(result.taskDigest, ready.taskDigest);
    assert.notEqual(result.operationId, ready.operationId);
    assert.notEqual(result.declaredSdk, ready.declaredSdk);
  } finally {
    await close(broken);
    await close(repaired);
    await close(health);
  }
});

test("redirects, body ceilings, deadlines, and bare responses stay uncharged negatives", async () => {
  const material = certMaterial();
  let away = 0;
  const elsewhere = await listen(http.createServer((_req, res) => {
    away += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  }));
  const redirect = await httpsServer(material, (req, res) => {
    const path = new URL(req.url, "https://quota.example").pathname;
    if (path === "/openapi.json") return sendJson(res, 200, quotaDocument);
    res.writeHead(302, { location: `http://127.0.0.1:${elsewhere.address().port}/secret` });
    res.end();
  });
  const huge = await httpsServer(material, (req, res) => {
    const path = new URL(req.url, "https://quota.example").pathname;
    if (path === "/openapi.json") return sendJson(res, 200, { openapi: "3.1.0" });
    sendJson(res, 200, { quota: { remaining: "3", filler: "x".repeat(4000) } });
  });
  const slow = await httpsServer(material, (req, res) => {
    const path = new URL(req.url, "https://quota.example").pathname;
    if (path === "/openapi.json") return sendJson(res, 200, { openapi: "3.1.0" });
    res.writeHead(200, { "content-type": "application/json" });
    res.write("{");
    const timer = setInterval(() => res.write(" "), 20);
    res.on("close", () => clearInterval(timer));
  });
  const lookupImpl = publicLookup();
  const quota = normalizeMachineRequest({ ...quotaCase, patch: undefined });
  try {
    const redirected = await runJourney({
      intake: quota.intake,
      baseUrl: quota.intake.origin,
      lookupImpl,
      socket: { host: "127.0.0.1", port: redirect.address().port, rejectUnauthorized: false },
    });
    assert.equal(redirected.classification.reason, "redirect_unfollowed");
    assert.equal(redirected.classification.useful, false);
    assert.equal(away, 0);

    const capped = normalizeMachineRequest({
      ...quotaCase,
      patch: undefined,
      maxEffort: { probes: 4, bodyBytes: 64, deadlineMs: 1000, totalBodyBytes: 4096, totalResponseMs: 4000, redirects: 0 },
    });
    const ceiling = await runJourney({
      intake: capped.intake,
      baseUrl: capped.intake.origin,
      lookupImpl,
      socket: { host: "127.0.0.1", port: huge.address().port, rejectUnauthorized: false },
    });
    assert.equal(ceiling.classification.reason, "body_ceiling");
    assert.equal(JSON.stringify(ceiling).includes("x".repeat(80)), false);

    const tight = normalizeMachineRequest({
      ...quotaCase,
      patch: undefined,
      maxEffort: { probes: 4, bodyBytes: 4096, deadlineMs: 80, totalBodyBytes: 8192, totalResponseMs: 1000, redirects: 0 },
    });
    const started = performance.now();
    const expired = await runJourney({
      intake: tight.intake,
      baseUrl: tight.intake.origin,
      lookupImpl,
      socket: { host: "127.0.0.1", port: slow.address().port, rejectUnauthorized: false },
    });
    assert.equal(expired.classification.reason, "body_deadline");
    assert.equal(expired.classification.useful, false);
    assert.ok(performance.now() - started < 1500);

    const missing = normalizeMachineRequest({
      ...healthCase,
      observed: { status: 200, json: { note: "up" }, contentType: "application/json" },
    });
    const bare = await runJourney({ intake: missing.intake, baseUrl: missing.intake.origin, live: "evidence" });
    assert.equal(bare.classification.useful, false);
    assert.equal(bare.classification.reason, "missing_field_not_paid_demand");
    assert.equal(bare.observation.http200IsSuccess, false);
    assert.equal(bare.observation.independentlyObserved, false);
  } finally {
    await close(elsewhere);
    await close(redirect);
    await close(huge);
    await close(slow);
  }
});

test("malformed evidence, private bodies, and a failed resolver stay explicit", async () => {
  const offline = JSON.parse(readFileSync(join(cases, "supplied-offline.json"), "utf8"));
  assert.throws(() => normalizeIntake({ ...offline, callerEvidence: { observed: { status: "200", json: { status: "ready" } } } }), SellerRepairError);
  const numeric = normalizeMachineRequest({ ...healthCase, expect: { path: "status", value: 3 } });
  assert.throws(() => normalizeIntake(numeric.intake), SellerRepairError);
  assert.throws(() => normalizeMachineRequest({ ...healthCase, lookupImpl: publicLookup() }), SellerRepairError);
  const marked = normalizeMachineRequest({
    ...healthCase,
    observed: { status: 200, json: { status: PRIVATE }, contentType: "application/json" },
  });
  const withheld = await runJourney({ intake: marked.intake, baseUrl: marked.intake.origin, live: "evidence" });
  assert.equal(withheld.classification.reason, "private_body_withheld");
  assert.equal(JSON.stringify(withheld).includes(PRIVATE), false);
  const absent = await runJourney({
    intake: normalizeMachineRequest(healthCase).intake,
    baseUrl: "https://status.example",
    lookupImpl: async () => { throw new Error("resolver down"); },
  });
  assert.equal(absent.observation.liveAdapter, "absent");
  assert.equal(absent.observation.independentlyObserved, false);
  assert.equal(absent.observation.dnsFailure, "dns_failed");
  assert.equal(absent.classification.outcome, "free_sufficient");
  assert.equal(absent.repair, null);
  const completed = {
    request: { origin: "https://status.example", route: "/v1/health", method: "GET" },
    report: {
      auditCompleted: true,
      findings: ["response_contract"],
      responseContract: { requiredPaths: ["status"] },
      repairPlan: { actions: ["declare status"], boundary: { sellerRuntimeVerified: false } },
    },
    boundary: { responseBodyRead: false },
  };
  const bodyQuestion = await runJourney({
    intake: normalizeMachineRequest(healthCase).intake,
    baseUrl: "https://status.example",
    live: "evidence",
    paidReport: completed,
  });
  assert.equal(bodyQuestion.paidAudit.connected, false);
  assert.equal(bodyQuestion.paidAudit.gap, "paid_report_does_not_read_useful_body");
  assert.equal(bodyQuestion.classification.nextAction, "free_sufficient");
  const contractIntake = normalizeMachineRequest({ ...healthCase, question: "declaration_contract" });
  const contract = await runJourney({
    intake: contractIntake.intake,
    baseUrl: contractIntake.intake.origin,
    live: "evidence",
    paidReport: completed,
  });
  assert.equal(contract.paidAudit.connected, true);
  assert.equal(contract.paidAudit.usefulDelta, true);
  assert.equal(contract.paidAudit.answersUsefulOutput, false);
  assert.equal(contract.paidAudit.purchasePerformed, false);
  const storedFixture = await runJourney({
    intake: normalizeMachineRequest(healthCase).intake,
    baseUrl: "https://status.example",
    live: "evidence",
    paidReport: incomplete,
  });
  assert.equal(storedFixture.paidAudit.gap, "target_mismatch");
  assert.equal(storedFixture.paidAudit.connected, false);
  assert.equal(storedFixture.paidAudit.purchasePerformed, false);
  const mismatched = await runJourney({
    intake: contractIntake.intake,
    baseUrl: contractIntake.intake.origin,
    live: "evidence",
    paidReport: { ...completed, request: { origin: "https://other.example", route: "/v1/health", method: "GET" } },
  });
  assert.equal(mismatched.paidAudit.gap, "target_mismatch");
  assert.equal(mismatched.paidAudit.connected, false);
});
