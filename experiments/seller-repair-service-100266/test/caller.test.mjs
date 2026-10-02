import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeSellerIntegrityAuditInput } from "../../../seller-integrity-audit.mjs";
import { SELLER_INTEGRITY_AUDIT_EXAMPLE } from "../../../seller-integrity-audit.mjs";
import { assessSellerIntegrityUsefulness } from "../../../paid-useful-journey.mjs";
import { authorizeProbe } from "../src/authorize.mjs";
import { compareBeforeAfter } from "../src/compare.mjs";
import { SellerRepairError } from "../src/errors.mjs";
import { normalizeIntake } from "../src/intake.mjs";
import { laterApplicability } from "../src/later.mjs";
import { runJourney } from "../src/journey.mjs";
import { normalizeOperation } from "../src/operation.mjs";
import { paidReportAnswersCaller } from "../src/paid-report.mjs";
import { PRIVATE_MARKER } from "../src/constants.mjs";
import { rejectSeeded } from "../src/seed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const retained = JSON.parse(readFileSync(path.join(here, "../cases/retained-case.json"), "utf8"));
const openapi = {
  openapi: "3.1.0",
  info: { title: "caller-owned", version: "1" },
  paths: {
    "/catalog/item": {
      get: {
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["result"],
                  properties: {
                    result: { type: "object", required: ["name", "sku"], properties: { name: { type: "string" }, sku: { type: "string" } } },
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

function listen(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        requests,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

test("operation identity stays exact and read-only", () => {
  const sample = { origin: "https://seller.example", route: "/catalog/item", method: "GET", requiredPaths: ["result.sku"] };
  const authority = normalizeSellerIntegrityAuditInput(sample);
  const local = normalizeOperation(sample);
  assert.equal(local.origin, authority.origin);
  assert.equal(local.route, authority.route);
  assert.equal(local.method, authority.method);
  assert.deepEqual([...local.requiredPaths], [...authority.requiredPaths]);
  assert.equal(normalizeSellerIntegrityAuditInput({ ...sample, method: "POST" }).method, "POST");
  assert.throws(() => normalizeIntake({ ...retained, method: "POST" }), SellerRepairError);
  assert.throws(() => normalizeIntake({
    ...retained,
    operation: { method: "GET", resource: "/catalog/items", operationId: "GET /catalog/items" },
  }), SellerRepairError);
  const publicSample = {
    origin: "https://agents.samedaydesk.com",
    route: "/.well-known/public-acquisition/index.json",
    method: "GET",
    requiredPaths: ["productionHosted", "schema"],
  };
  const publicAuthority = normalizeSellerIntegrityAuditInput(publicSample);
  const publicLocal = normalizeOperation(publicSample);
  assert.equal(publicLocal.route, publicAuthority.route);
  assert.deepEqual([...publicLocal.requiredPaths], [...publicAuthority.requiredPaths]);
});

test("a caller-owned before and after changes useful output without mutating the first service", async () => {
  const before = await listen((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method !== "GET") return send(res, 405, { ok: false });
    if (url.pathname === "/openapi.json") return send(res, 200, openapi);
    if (url.pathname === "/catalog/item") return send(res, 200, { result: { name: "Widget" } });
    return send(res, 404, { ok: false });
  });
  const after = await listen((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/openapi.json") return send(res, 200, openapi);
    if (url.pathname === "/catalog/item") return send(res, 200, { result: { name: "Widget", sku: "WIDGET-1" } });
    return send(res, 404, { ok: false });
  });
  try {
    const compared = await compareBeforeAfter({ raw: retained, beforeBaseUrl: before.baseUrl, afterBaseUrl: after.baseUrl });
    assert.equal(compared.beforeOutcome, "mismatch");
    assert.equal(compared.beforeUseful, false);
    assert.equal(compared.afterUseful, true);
    assert.equal(compared.usefulOutputChanged, true);
    assert.equal(compared.loopbackFix, true);
    assert.equal(compared.deployedCounterpartyRepair, false);
    assert.equal(compared.counterpartyMutated, false);
    assert.equal(compared.sameInputQa, true);
    assert.equal(compared.laterCallerReuse, false);
    assert.equal(compared.http200IsSuccess, false);
    assert.equal(compared.paidAuditRequired, false);
    assert.equal(compared.actualSourceCoverage, "unknown");
    assert.equal(compared.paymentSent, false);
    assert.equal(compared.recognizedRevenueAtomic, "0");
    assert.equal(before.requests.every((item) => item.method === "GET"), true);
    assert.equal(before.requests.some((item) => item.url.startsWith("/catalog/items")), false);
  } finally {
    await before.close();
    await after.close();
  }
});

test("a similar route, a bare 200, a redirect, and a private body do not prove useful work", async () => {
  const similar = {
    ...openapi,
    paths: { "/catalog/items": openapi.paths["/catalog/item"] },
  };
  const server = await listen((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/openapi.json") return send(res, 200, similar);
    if (url.pathname === "/catalog/item") return send(res, 200, { ok: true });
    if (url.pathname === "/catalog/items") return send(res, 200, { result: { sku: "WIDGET-1" } });
    return send(res, 404, {});
  });
  try {
    const missing = await runJourney({ intake: retained, baseUrl: server.baseUrl });
    assert.equal(missing.classification.outcome, "unknown");
    assert.equal(missing.classification.reason, "missing_field_not_paid_demand");
    assert.equal(missing.classification.paidAuditRequired, false);
    assert.equal(missing.declared.provesExecution, false);
    assert.equal(missing.declared.requiredPaths.includes("result.sku"), false);
    assert.equal(missing.metrics.actualSourceCoverage, "unknown");
    assert.equal(server.requests.some((item) => item.url.startsWith("/catalog/items")), false);
  } finally {
    await server.close();
  }

  const redirector = await listen((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/openapi.json") return send(res, 200, openapi);
    res.writeHead(302, { location: "/catalog/items", "content-type": "text/plain" });
    res.end("go");
  });
  try {
    const redirected = await runJourney({ intake: retained, baseUrl: redirector.baseUrl });
    assert.equal(redirected.classification.reason, "redirect_unfollowed");
    assert.equal(redirected.classification.paidAuditRequired, false);
    assert.equal(redirector.requests.some((item) => item.url.startsWith("/catalog/items")), false);
  } finally {
    await redirector.close();
  }

  const hidden = await listen((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/openapi.json") return send(res, 200, openapi);
    return send(res, 200, { result: { note: PRIVATE_MARKER } });
  });
  try {
    const result = await runJourney({ intake: retained, baseUrl: hidden.baseUrl });
    assert.equal(result.classification.reason, "private_body_withheld");
    assert.equal(JSON.stringify(result).includes(PRIVATE_MARKER), false);
    assert.equal(result.paidAudit.purchaseRecommended, false);
  } finally {
    await hidden.close();
  }
});

test("probe budget is shared and a later caller must retest the bound target", async () => {
  const server = await listen((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/openapi.json") return send(res, 200, openapi);
    return send(res, 200, { result: { name: "Widget" } });
  });
  try {
    const tight = await runJourney({
      intake: {
        ...retained,
        maxEffort: { probes: 2, bodyBytes: 4096, deadlineMs: 1000, totalBodyBytes: 8192, totalResponseMs: 4000, redirects: 0 },
      },
      baseUrl: server.baseUrl,
      retestBaseUrl: server.baseUrl,
    });
    assert.equal(tight.repair.useful, false);
    assert.equal(tight.repair.reason, "effort_exhausted");
    assert.equal(tight.metrics.requesterAmendmentEffort.probes, 2);
    assert.equal(tight.metrics.callerEffort.probes, 2);
    assert.equal(tight.paymentSent, false);
  } finally {
    await server.close();
  }

  const intake = normalizeIntake(retained);
  const stale = laterApplicability({
    intake,
    taskDigest: intake.taskDigest,
    sdk: intake.declaredSdk,
    target: { origin: intake.origin, method: "GET", resource: "/catalog/items" },
    callerId: "later-agent",
    retest: { useful: true },
    independentRetest: false,
  });
  assert.equal(stale.reason, "stale_applicability");
  assert.equal(stale.currentTarget, false);
  assert.equal(stale.reused, false);
  assert.equal(stale.trustedPriorUseful, false);
  assert.equal(stale.usefulTransferred, false);
});

test("the paid audit's local incomplete report stays a useful negative", () => {
  const incomplete = JSON.parse(readFileSync(path.join(here, "../fixtures/local-audit-incomplete.json"), "utf8"));
  const assessed = assessSellerIntegrityUsefulness(incomplete, {
    origin: "https://example.com",
    route: "/extract",
    method: "GET",
  });
  assert.equal(assessed.useful, false);
  assert.equal(assessed.reason, "audit_incomplete");
  const negative = paidReportAnswersCaller(incomplete);
  assert.equal(negative.answersUsefulOutput, false);
  assert.equal(negative.purchaseRecommended, false);
  assert.equal(negative.reason, "audit_incomplete_retained");

  const completed = paidReportAnswersCaller(SELLER_INTEGRITY_AUDIT_EXAMPLE);
  assert.equal(completed.answersUsefulOutput, false);
  assert.equal(completed.purchaseRecommended, false);
  assert.equal(completed.reason, "paid_report_does_not_read_useful_body");
  const auditUseful = assessSellerIntegrityUsefulness(SELLER_INTEGRITY_AUDIT_EXAMPLE, {
    origin: SELLER_INTEGRITY_AUDIT_EXAMPLE.request.origin,
    route: SELLER_INTEGRITY_AUDIT_EXAMPLE.request.route,
    method: SELLER_INTEGRITY_AUDIT_EXAMPLE.request.method,
  });
  assert.equal(auditUseful.reason, "additional_work_present");
  assert.equal(completed.answersUsefulOutput, false);
});

test("public read-only authorization does not follow a caller onto another host", () => {
  const intake = normalizeIntake(JSON.parse(readFileSync(path.join(here, "../cases/public-readonly.json"), "utf8")));
  assert.equal(authorizeProbe({ intake, baseUrl: intake.origin }).ok, true);
  assert.equal(authorizeProbe({ intake, baseUrl: "http://127.0.0.1:9" }).reason, "target_not_authorized");
  assert.equal(authorizeProbe({ intake, baseUrl: "https://example.com" }).reason, "target_not_authorized");
  const seeded = rejectSeeded(JSON.parse(readFileSync(path.join(here, "../fixtures/seeded-false-useful.json"), "utf8")));
  assert.equal(seeded.refused, true);
  assert.equal(seeded.reasons.includes("unknown_coverage_is_not_useful"), true);
  assert.equal(seeded.reasons.includes("declaration_is_not_execution"), true);
  assert.equal(seeded.reasons.includes("counterparty_not_mutated"), true);
});

function runNode(args) {
  const child = spawn(process.execPath, args, {
    cwd: repo,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.once("exit", (code) => resolve({ code, stdout, stderr })));
}

test("cold later refusal binds the target and a later caller retests", async () => {
  const refused = await runNode([
    "experiments/seller-repair-service-100266/bin/cold-later.mjs",
    "experiments/seller-repair-service-100266/cases/retained-case.json",
    "--resource",
    "/catalog/items",
  ]);
  assert.equal(refused.code, 2, refused.stderr);
  const body = JSON.parse(refused.stdout);
  assert.equal(body.reason, "stale_applicability");
  assert.equal(body.currentTarget, false);
  assert.equal(body.probed, false);
  assert.equal(body.paymentSent, false);

  const later = await runNode([
    "experiments/seller-repair-service-100266/bin/cold-later.mjs",
    "experiments/seller-repair-service-100266/cases/retained-case.json",
    "--caller",
    "later-agent",
  ]);
  assert.equal(later.code, 0, later.stderr);
  const reused = JSON.parse(later.stdout);
  assert.equal(reused.laterCaller, true);
  assert.equal(reused.sameInputQa, false);
  assert.equal(reused.reused, true);
  assert.equal(reused.usefulTransferred, false);
  assert.equal(reused.independentRetest, true);
  assert.equal(reused.trustedPriorUseful, false);
  assert.equal(reused.paymentSent, false);
});
