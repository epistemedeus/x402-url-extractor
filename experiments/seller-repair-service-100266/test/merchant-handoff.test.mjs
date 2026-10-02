import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compareDiscoveryLive } from "../../../discovery-drift.mjs";
import {
  assessFreeDiagnosis,
  createJourneySession,
  presentOffer,
  purchaseAuthorized,
} from "../../../paid-useful-journey.mjs";
import { buildHandoff, observePaidOutcome } from "../src/handoff.mjs";
import { normalizeIntake } from "../src/intake.mjs";

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const retained = JSON.parse(await readFile(new URL("../cases/retained-case.json", import.meta.url), "utf8"));

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

async function startFakeFacilitator() {
  const calls = { settle: 0, supported: 0, verify: 0 };
  const state = { verifyValid: true, settleOk: true };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      return send(200, { kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, { isValid: state.verifyValid, payer: `0x${"2".repeat(40)}` });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      if (!state.settleOk) return send(200, { success: false, errorReason: "settle_failed" });
      return send(200, {
        success: true,
        payer: `0x${"2".repeat(40)}`,
        transaction: `0x${"ab".repeat(32)}`,
        network: "eip155:8453",
      });
    }
    return send(404, { error: "unexpected_test_facilitator_request" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    calls,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function startMerchant({ dataDir, facilitatorUrl }) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-40_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
  });
  return { base: `http://127.0.0.1:${port}`, child };
}

async function stopChild(child) {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
}

async function fixtureAssessment() {
  const catalog = JSON.parse(await readFile(path.join(cwd, "examples/paid-useful-journey/fixtures/catalog.json"), "utf8"));
  const live = JSON.parse(await readFile(path.join(cwd, "examples/paid-useful-journey/fixtures/live.json"), "utf8"));
  return assessFreeDiagnosis(compareDiscoveryLive(catalog, live, { now: Date.parse("2026-09-10T07:22:00.000Z"), staleMs: 86_400_000 }));
}

test("merchant handoff stays unpaid and preserves no-charge, failure, replay, and unknown", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "seller-repair-merchant-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const intake = normalizeIntake(retained);

  const malformed = await fetch(`${merchant.base}/commerce/seller-integrity-audit?origin=notaurl&route=%2Fextract`);
  const malformedBody = await malformed.json();
  assert.equal(malformed.status, 400);
  assert.equal(malformedBody.charged, false);
  const noCharge = observePaidOutcome({ status: 400, charged: false, intake });
  assert.equal(noCharge.preserved, "no_charge_input_failure");
  assert.equal(noCharge.actualValidDelivery, false);
  assert.equal(noCharge.paymentSentByPackage, false);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);

  const handoff = await buildHandoff({ intake, merchantBase: merchant.base });
  assert.equal(handoff.purchasePerformed, false);
  assert.equal(handoff.paymentSent, false);
  assert.equal(handoff.live.status, 402);
  assert.equal(handoff.live.amountAtomic, "10000");
  assert.equal(handoff.live.priceMatchesDocumented, true);
  assert.equal(handoff.price.priceChanged, false);
  assert.equal(handoff.price.skuAdded, false);
  assert.equal(handoff.request.route, "/commerce/seller-integrity-audit");
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);

  const assessment = await fixtureAssessment();
  const offered = await presentOffer({ merchantBase: merchant.base, assessment, actor: "owner_test", now: Date.now() });
  assert.equal(offered.ok, true, JSON.stringify(offered));
  const authorization = {
    authorizePurchase: true,
    actor: "owner_test",
    target: assessment.target,
    termsDigest: offered.offer.termsDigest,
    expiresAt: offered.offer.expiresAt,
  };
  facilitator.state.verifyValid = false;
  const failed = await purchaseAuthorized({
    merchantBase: merchant.base,
    assessment,
    authorization,
    now: Date.now(),
    testMode: true,
  });
  assert.equal(failed.paymentSent, true, JSON.stringify({ reason: failed.reason, status: failed.status }));
  assert.notEqual(failed.usefulDelivery, "true");
  assert.equal(facilitator.calls.settle, 0);
  const failure = observePaidOutcome({
    usefulDelivery: failed.usefulDelivery,
    financialOutcome: failed.financialOutcome,
    reason: failed.reason,
    intake,
    body: failed.body,
  });
  assert.equal(failure.preserved, "failure");
  assert.equal(failure.actualValidDelivery, false);

  facilitator.state.verifyValid = true;
  const session = createJourneySession();
  const purchased = await purchaseAuthorized({
    merchantBase: merchant.base,
    assessment,
    authorization,
    now: Date.now(),
    testMode: true,
    session,
  });
  assert.equal(purchased.paymentSent, true, JSON.stringify({ reason: purchased.reason, status: purchased.status }));
  assert.equal(purchased.usefulDelivery, "false");
  assert.equal(purchased.revenueRecognized, false);
  const duplicate = await purchaseAuthorized({
    merchantBase: merchant.base,
    assessment,
    authorization,
    now: Date.now(),
    testMode: true,
    session,
  });
  assert.equal(duplicate.reason, "duplicate_settled");
  assert.equal(duplicate.paymentSent, false);
  const replay = observePaidOutcome({
    reason: duplicate.reason,
    session,
    journeyId: assessment.journeyId,
    intake,
  });
  assert.equal(replay.preserved, "replay");
  assert.equal(replay.actualValidDelivery, false);

  const unknown = observePaidOutcome({
    journeyId: assessment.journeyId,
    priorEvents: [{
      paymentPresent: true,
      result: "paid_success",
      settlementReference: null,
      paidUsefulJourney: { journey: assessment.journeyId, decision: "attempt" },
    }],
    intake,
  });
  assert.equal(unknown.preserved, "unknown");
  assert.equal(unknown.actualValidDelivery, false);
  assert.equal(unknown.historicalRevenue, "unknown");
  assert.equal(unknown.recognizedRevenueAtomic, "0");
});
