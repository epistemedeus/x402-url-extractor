import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

export const QA_ROOT = fileURLToPath(new URL("../.runtime/merchant/", import.meta.url));
export const ownerModule = name => import(pathToFileURL(path.join(QA_ROOT, name)).href);
const require = createRequire(path.join(QA_ROOT, "package.json"));
const express = require("express");
const { mountScopedSurfaceDelivery } = await ownerModule("experiments/scoped-surface-delivery-100312/route/mount.mjs");
const { resolveHostedScanner } = await ownerModule("experiments/scoped-surface-delivery-100312/deploy/hosted-scanner.mjs");
const { handleUsefulResultReuse } = await ownerModule("useful-result-reuse/http.mjs");
const { createUsefulResultReuse } = await ownerModule("useful-result-reuse/service.mjs");
const { createCommerceTelemetry } = await ownerModule("commerce-events.mjs");
const { buildPurchaseEvidenceManifest } = await ownerModule("purchase-evidence-manifest.mjs");
export const TEST_TOKEN = "service-delivery-404-disposable-owner-test-boundary";

export async function testDirectory() {
  const parent = path.join(QA_ROOT, "../test-directories");
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, "case-"));
}
export async function startMounted({ directory, clock = { value: Date.now() }, intercept, initialState = {} } = {}) {
  directory ||= await testDirectory();
  const app = express(); app.use(express.json({ limit: "200kb" }));
  const state = { version: "1.23.49", requests: [], proofs: [], admission: null, ...initialState };
  const telemetry = createCommerceTelemetry({ dataDir: path.join(directory, "commerce"), secret: TEST_TOKEN,
    internalToken: TEST_TOKEN, maxBytes: 1024 * 1024 });
  const customer = createUsefulResultReuse({ dataDir: path.join(directory, "commerce"), internalToken: TEST_TOKEN, now: () => clock.value });
  app.use((req, res, next) => {
    state.requests.push({ method: req.method, path: req.path });
    if (state.admission && (req.path.startsWith("/commerce/scoped-surface-") || req.path === state.admission.route)) {
      req.headers["x-samedaydesk-internal"] = TEST_TOKEN;
      req.headers["x-samedaydesk-outcome-task"] = state.admission.taskId;
      req.headers["x-samedaydesk-outcome-operation"] = state.admission.operationId;
      req.headers["x-samedaydesk-outcome-cohort"] = "owner_qa";
    }
    telemetry.middleware(req, res, () => {
      const proof = telemetry.causalCommerceEventProof(res);
      if (proof) state.proofs.push({ route: req.path, proof });
      next();
    });
  });
  if (intercept) app.use((req, res, next) => intercept(req, res, next, state));
  app.get("/.well-known/agent-payment-evidence.json", (_req, res) => {
    // The existing descriptor builder. This fixture declares no new product.
    res.json(buildPurchaseEvidenceManifest({
      origin: "https://agents.samedaydesk.com", serviceVersion: state.version,
      resources: [{ method: "GET", url: "https://agents.samedaydesk.com/chain/transaction-receipt" }],
      // The owner's manifest unit-test response schema; QA descriptor only.
      // The separate full-server test receives the actual complete manifest.
      responseContractFor: () => ({ schema: { type: "object", properties: { ok: { type: "boolean" },
        result: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } }, required: ["ok", "result"] },
        example: { ok: true, result: { value: "ready" } } }),
      serviceDeployment: { statement: "/.well-known/service-deployment.json", publicKey: "/.well-known/service-deployment.pem",
        statementId: "disposable-owner-qa", expiresAt: "2026-11-01T00:00:00.000Z", paidActionEffects: "/.well-known/paid-action-effects.json" },
      replay: { ttlSeconds: 900, mismatchStatus: 409, requestBinding: ["method", "canonical_url", "exact_raw_body_sha256"] },
    }));
  });
  const mounted = mountScopedSurfaceDelivery(app, { ...resolveHostedScanner({}), journalDir: path.join(directory, "scanner"), authorityFile: null });
  app.use((req, res, next) => { if (!handleUsefulResultReuse(req, res, customer)) next(); });
  const server = createServer(app);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fixture = {
    app, directory, clock, state, origin, telemetry, customer, mounted,
    async close({ remove = true } = {}) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await telemetry.flush();
      if (remove) await rm(directory, { recursive: true, force: true });
    },
  };
  return fixture;
}

export async function createTestRetained(fixture, { retainUntil, credentialDigest = "aa".repeat(32) } = {}) {
  const { readCapture, clientFromCapture } = await ownerModule("useful-result-reuse/base-receipt.mjs");
  const { transactionReceipt } = await ownerModule("transaction-receipt.mjs");
  const { CLOSED_SPONSORED_REF } = await ownerModule("useful-result-reuse/constants.mjs");
  const capture = await readCapture(path.join(QA_ROOT, "useful-result-reuse/fixtures/h15-base-receipt.json"));
  const body = await transactionReceipt({ transactionHash: CLOSED_SPONSORED_REF, network: "base" }, {
    client: clientFromCapture(capture), now: () => new Date(fixture.clock.value),
  });
  const result = await fixture.customer.retainDeliveredReceipt({ body, optIn: true, method: "GET", route: "/chain/transaction-receipt",
    settlementStatus: "verified", settlementDigest: "cc".repeat(32), credentialDigest,
    retainUntil: retainUntil || new Date(fixture.clock.value + 3600000).toISOString(), taskLabel: null });
  if (!result.accepted) throw new Error("disposable_test_retention_refused");
  return { result, body };
}
