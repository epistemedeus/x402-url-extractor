import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCommerceTelemetry } from "./commerce-events.mjs";
import { compareDiscoveryLive } from "./discovery-drift.mjs";
import {
  assessFreeDiagnosis,
  assessSellerIntegrityUsefulness,
  authorizePurchase,
  bindUnpaidOffer,
  createJourneySession,
  declineOffer,
  encodePaidUsefulJourneyHeader,
  joinPaidUsefulJourney,
  loadCommerceJourneyFiles,
  PAID_OPERATION_PATH,
  PAID_USEFUL_JOURNEY_HEADER,
  paidUsefulJourneyMetadata,
  parsePaidUsefulJourneyHeader,
  planRestart,
  presentOffer,
  purchaseAuthorized,
  recordLaterReuse,
} from "./paid-useful-journey.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NETWORK = "eip155:8453";
const TX = `0x${"3".repeat(64)}`;
const FALSE_TX = `0x${"9".repeat(64)}`;
const PAYER = `0x${"a".repeat(40)}`;
const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const TARGET = { origin: "https://example.com", route: "/extract", method: "GET" };

function driftReport(status, dimensions, resource = "https://example.com/extract") {
  return {
    schemaVersion: "samedaydesk.discovery-drift-report.v1",
    product: "samedaydesk-discovery-drift",
    status,
    observedMatch: status === "match",
    resolvedCause: false,
    catalog: { resource },
    live: { resource },
    dimensions,
    unknowns: [],
  };
}

function dimension(name, disposition) {
  return { dimension: name, disposition, catalog: "catalog", live: "live" };
}

function usefulBody(target = TARGET, patch = {}) {
  return {
    ok: false,
    product: "samedaydesk-seller-integrity-audit",
    version: "1.3.0",
    decision: "repair_required",
    request: { origin: target.origin, route: target.route, method: target.method },
    report: {
      auditCompleted: false,
      findings: ["bounded_transport_failure"],
      responseContract: null,
      repairPlan: null,
    },
    boundary: { targetPaymentSent: false },
    ...patch,
  };
}

function challengeDocument(resource, { amount = "10000", route } = {}) {
  const accepts = [{
    scheme: "exact",
    network: NETWORK,
    amount,
    asset: ASSET,
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
  }];
  if (route) accepts.push({ ...accepts[0], network: "eip155:1" });
  return {
    x402Version: 2,
    resource: { url: resource },
    accepts,
  };
}

function headerResponse(status, fields, body = "") {
  const headers = new Map(Object.entries(fields).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    type: "basic",
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    async json() {
      return body ? JSON.parse(body) : null;
    },
  };
}

function encodedChallenge(resource, options) {
  return Buffer.from(JSON.stringify(challengeDocument(resource, options))).toString("base64");
}

async function fixtureAssessment(now = Date.parse("2026-09-10T07:22:00.000Z")) {
  const catalog = JSON.parse(await readFile(path.join(cwd, "examples/paid-useful-journey/fixtures/catalog.json"), "utf8"));
  const live = JSON.parse(await readFile(path.join(cwd, "examples/paid-useful-journey/fixtures/live.json"), "utf8"));
  const report = compareDiscoveryLive(catalog, live, { now, staleMs: 86_400_000 });
  return assessFreeDiagnosis(report);
}

function runCli(args, { input } = {}) {
  const child = spawn(process.execPath, ["examples/paid-useful-journey/cli.mjs", ...args], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  if (input) child.stdin.end(input);
  else child.stdin.end();
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("free mismatch offers seller-integrity and sufficient diagnoses do not", async () => {
  const eligible = await fixtureAssessment();
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.reason, "seller_contract_unresolved");
  assert.equal(eligible.purchaseAuthorized, false);
  assert.equal(eligible.revenueRecognized, false);
  assert.equal(eligible.offeredOperation.method, "GET");
  assert.equal(eligible.offeredOperation.path, PAID_OPERATION_PATH);
  assert.deepEqual(eligible.offeredOperation.query, TARGET);
  assert.equal(eligible.freeResult.resolvedCause, false);

  assert.equal(assessFreeDiagnosis(driftReport("match", [dimension("amountAtomic", "matched")])).reason, "free_result_sufficient");
  assert.equal(assessFreeDiagnosis(driftReport("stale", [dimension("amountAtomic", "matched")])).eligible, false);
  assert.equal(assessFreeDiagnosis(driftReport("reordered-multiple-offer", [])).eligible, false);
  assert.equal(assessFreeDiagnosis(driftReport("unknown", [dimension("freshness", "unknown")])).reason, "diagnosis_not_specific");
  const amountUnknown = assessFreeDiagnosis(driftReport("unknown", [dimension("amountAtomic", "unknown")]));
  assert.equal(amountUnknown.eligible, true);
  assert.equal(amountUnknown.offeredOperation.path, PAID_OPERATION_PATH);
  assert.equal(assessFreeDiagnosis({ ...driftReport("mismatch", []), resolvedCause: true }).reason, "resolved_cause_not_accepted");
  assert.equal(assessFreeDiagnosis({ status: "mismatch" }).reason, "not_a_discovery_drift_report");
  assert.equal(assessFreeDiagnosis(driftReport("mismatch", [], "https://example.com/extract?x=1")).reason, "target_unknown");
});

test("journey header keeps an explicit actor and drops wallets and extra keys", () => {
  const claim = {
    journey: "a".repeat(32),
    diagnosis: "b".repeat(64),
    decision: "offer",
    actor: "recruited",
  };
  const encoded = encodePaidUsefulJourneyHeader(claim);
  assert.equal(encoded.length <= 700, true);
  assert.deepEqual(parsePaidUsefulJourneyHeader(encoded), {
    v: 1,
    journey: claim.journey,
    diagnosis: claim.diagnosis,
    actor: "recruited",
    decision: "offer",
  });
  const wallet = encodePaidUsefulJourneyHeader({ ...claim, actor: PAYER });
  const parsedWallet = parsePaidUsefulJourneyHeader(wallet);
  assert.equal(parsedWallet.actor, "unknown");
  assert.equal(JSON.stringify(parsedWallet).includes(PAYER), false);
  assert.equal(Buffer.from(wallet, "base64url").toString("utf8").includes(PAYER), false);
  const extra = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")), wallet: PAYER })).toString("base64url");
  assert.equal(parsePaidUsefulJourneyHeader(extra), null);
  assert.equal(parsePaidUsefulJourneyHeader(""), null);
  assert.equal(paidUsefulJourneyMetadata(parsedWallet, {
    status: 402,
    paymentPresent: false,
    route: "/extract",
    target: TARGET,
  }), null);
});

test("terms binding reads the live challenge and rejects ambiguity, expiry, and target changes", () => {
  const requested = `https://agents.samedaydesk.com${PAID_OPERATION_PATH}?origin=https%3A%2F%2Fexample.com&route=%2Fextract&method=GET`;
  const bound = bindUnpaidOffer({
    challenge: challengeDocument(requested),
    requestedUrl: requested,
    target: TARGET,
    receivedAt: NOW,
  });
  assert.equal(bound.ok, true);
  assert.equal(bound.terms.amount, "10000");
  assert.equal(bound.terms.payTo, PAY_TO.toLowerCase());
  assert.equal(bound.revenueRecognized, false);
  const auth = {
    authorizePurchase: true,
    termsDigest: bound.termsDigest,
    expiresAt: bound.expiresAt,
    target: TARGET,
    expectedTarget: TARGET,
    actor: "independent",
  };
  assert.equal(authorizePurchase({ authorization: auth, offer: bound, now: NOW }).ok, true);
  assert.equal(authorizePurchase({
    authorization: { ...auth, authorizePurchase: false },
    offer: bound,
    now: NOW,
  }).reason, "authorization_required");
  assert.equal(authorizePurchase({
    authorization: { ...auth, termsDigest: "0".repeat(64) },
    offer: bound,
    now: NOW,
  }).reason, "wrong_terms");
  assert.equal(authorizePurchase({
    authorization: { ...auth, expiresAt: "2020-01-01T00:00:00.000Z" },
    offer: bound,
    now: NOW,
  }).reason, "terms_expired");
  assert.equal(authorizePurchase({
    authorization: { ...auth, target: { ...TARGET, route: "/changed" } },
    offer: bound,
    now: NOW,
  }).reason, "target_changed");
  const changedUrl = new URL(requested);
  changedUrl.searchParams.set("route", "/changed");
  const changed = bindUnpaidOffer({
    challenge: challengeDocument(changedUrl.toString()),
    requestedUrl: requested,
    target: TARGET,
    receivedAt: NOW,
  });
  assert.equal(changed.reason, "target_changed");
  const ambiguous = bindUnpaidOffer({
    challenge: {
      ...challengeDocument(requested),
      accepts: [
        challengeDocument(requested).accepts[0],
        { ...challengeDocument(requested).accepts[0], payTo: `0x${"b".repeat(40)}` },
      ],
    },
    requestedUrl: requested,
    target: TARGET,
    receivedAt: NOW,
  });
  assert.equal(ambiguous.reason, "terms_ambiguous");
  assert.equal(bindUnpaidOffer({
    challenge: { accepts: [] },
    requestedUrl: requested,
    target: TARGET,
    receivedAt: NOW,
  }).reason, "terms_incomplete");
});

test("restart stops settled and unknown financial outcomes and allows a known rejection", () => {
  const journeyId = "c".repeat(32);
  const attempt = (patch) => ({
    paymentPresent: true,
    settlementReference: null,
    result: "paid_success",
    paidUsefulJourney: { journey: journeyId, decision: "attempt", usefulDelivery: "unknown" },
    ...patch,
  });
  assert.equal(planRestart({ journeyId, events: [] }).action, "allow");
  assert.equal(planRestart({
    journeyId,
    events: [attempt({ settlementReference: TX })],
  }).reason, "duplicate_settled");
  assert.equal(planRestart({ journeyId, events: [attempt({ settlementReference: null })] }).reason, "unknown_financial_outcome");
  assert.equal(planRestart({
    journeyId,
    events: [attempt({ result: "service_failure" })],
  }).reason, "unknown_financial_outcome");
  assert.equal(planRestart({
    journeyId,
    events: [attempt({ result: "validation_failure" })],
  }).financialOutcome, "known_rejection");
  assert.equal(planRestart({
    journeyId,
    events: [attempt({ result: "challenge" })],
  }).action, "allow");
  const session = createJourneySession();
  session.mark(journeyId, "in_flight");
  assert.equal(planRestart({ journeyId, session }).reason, "duplicate_in_flight");
  session.mark(journeyId, "unknown_financial");
  assert.equal(planRestart({ journeyId, session }).financialOutcome, "unknown");
  session.mark(journeyId, "settled");
  assert.equal(planRestart({ journeyId, session }).reason, "duplicate_settled");
});

test("useful delivery requires seller-integrity work for the same target", () => {
  assert.equal(assessSellerIntegrityUsefulness(usefulBody(), TARGET).reason, "additional_work_present");
  assert.equal(assessSellerIntegrityUsefulness({
    schemaVersion: "samedaydesk.discovery-drift-report.v1",
    product: "samedaydesk-discovery-drift",
  }, TARGET).reason, "echoes_free_diagnostic");
  const empty = usefulBody();
  empty.report.findings = [];
  assert.equal(assessSellerIntegrityUsefulness(empty, TARGET).reason, "additional_work_missing");
  const moved = usefulBody({ ...TARGET, route: "/other" });
  assert.equal(assessSellerIntegrityUsefulness(moved, TARGET).reason, "target_mismatch");
  const paidTarget = usefulBody();
  paidTarget.boundary.targetPaymentSent = true;
  assert.equal(assessSellerIntegrityUsefulness(paidTarget, TARGET).reason, "schema_invalid");
});

test("offer-only join keeps missing stages unknown and ignores a wallet", async () => {
  const events = JSON.parse(await readFile(path.join(cwd, "examples/paid-useful-journey/fixtures/offer-only-events.json"), "utf8"));
  const expected = JSON.parse(await readFile(path.join(cwd, "examples/paid-useful-journey/joined-example.json"), "utf8"));
  const assessment = await fixtureAssessment();
  assert.equal(assessment.journeyId, expected.journey);
  assert.equal(assessment.diagnosisId, events[0].paidUsefulJourney.diagnosis);
  const joined = joinPaidUsefulJourney({ events, journeyId: expected.journey });
  assert.deepEqual(joined, expected);
  assert.equal(JSON.stringify(joined).includes(PAYER), false);
  assert.equal(joined.revenueRecognized, false);
  assert.equal(joined.stages.explicit_attempt, "unknown");
  assert.equal(joined.stages.settlement, "unknown");
  const falseClaim = joinPaidUsefulJourney({
    events,
    journeyId: expected.journey,
    claimedSettlement: FALSE_TX,
  });
  assert.equal(falseClaim.stages.settlement, "false_claim");
  assert.equal(falseClaim.revenueRecognized, false);
  assert.equal(falseClaim.rejectedSettlementClaim, FALSE_TX);
});

test("join counts one matching settlement, rejects a false claim, and requires useful delivery before reuse", () => {
  const journeyId = "d".repeat(32);
  const diagnosis = "e".repeat(64);
  const base = {
    v: 3,
    result: "paid_success",
    status: 200,
    paymentPresent: true,
    route: PAID_OPERATION_PATH,
  };
  const journey = (decision, actor, usefulDelivery = "unknown") => ({
    v: 1,
    journey: journeyId,
    diagnosis,
    actor,
    decision,
    usefulDelivery,
    usefulReason: usefulDelivery === "true" ? "additional_work_present" : "not_delivery",
  });
  const attempt = {
    ...base,
    id: "attempt-1",
    settlementReference: TX,
    paidUsefulJourney: journey("attempt", "owner_test", "true"),
  };
  const present = joinPaidUsefulJourney({ events: [attempt], journeyId });
  assert.equal(present.stages.settlement, "present");
  assert.equal(present.stages.useful_delivery, "true");
  assert.equal(present.revenueRecognized, false);
  assert.equal(present.settlementReference, TX);
  const claimed = joinPaidUsefulJourney({ events: [attempt], journeyId, claimedSettlement: FALSE_TX });
  assert.equal(claimed.stages.settlement, "false_claim");
  const reusedTooSoon = joinPaidUsefulJourney({
    events: [{
      ...base,
      id: "reuse-1",
      result: "challenge",
      status: 402,
      paymentPresent: false,
      settlementReference: null,
      paidUsefulJourney: journey("reuse", "owner_test"),
    }],
    journeyId,
  });
  assert.equal(reusedTooSoon.stages.later_task_reuse, "unknown");
  const reused = joinPaidUsefulJourney({
    events: [attempt, {
      id: "reuse-2",
      result: "challenge",
      status: 402,
      paymentPresent: false,
      settlementReference: null,
      paidUsefulJourney: journey("reuse", "recruited"),
    }],
    journeyId,
  });
  assert.equal(reused.stages.later_task_reuse, "present");
  assert.equal(reused.actorLabel, "unknown");
  const forwarded = joinPaidUsefulJourney({
    events: [attempt],
    forwardRecords: [{
      schemaVersion: "samedaydesk.outcome-binding.forward.v2",
      stage: "retained_use",
      operationId: journeyId,
    }],
    journeyId,
  });
  assert.equal(forwarded.stages.later_task_reuse, "present");
});

function mockFetch({ statusForPayment = 200, bodyForPayment = usefulBody(), redirect = false, resourceRoute = "/extract" } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    if (redirect) return headerResponse(302, { location: "https://elsewhere.example/taken" });
    const resource = new URL(url);
    resource.searchParams.set("route", resourceRoute);
    if (init.headers["payment-signature"]) {
      const receipt = Buffer.from(JSON.stringify({ success: true, transaction: TX, network: NETWORK })).toString("base64url");
      return headerResponse(statusForPayment, { "payment-response": statusForPayment === 200 ? receipt : "" }, statusForPayment === 200 ? JSON.stringify(bodyForPayment) : "");
    }
    return headerResponse(402, { "payment-required": encodedChallenge(resource.toString()) });
  };
  return { calls, fetchImpl };
}

function authorizationFor(offer, patch = {}) {
  return {
    authorizePurchase: true,
    termsDigest: offer.termsDigest,
    expiresAt: offer.expiresAt,
    target: TARGET,
    actor: "owner_test",
    ...patch,
  };
}

test("client refusals send no payment and test mode delivers additional work once", async () => {
  const assessment = await fixtureAssessment();
  const merchantBase = "http://127.0.0.1:9";
  const ineligible = assessFreeDiagnosis(driftReport("match", [dimension("amountAtomic", "matched")]));
  const idle = mockFetch();
  const diagnosed = await presentOffer({
    fetchImpl: idle.fetchImpl,
    merchantBase,
    assessment: ineligible,
    now: NOW,
  });
  assert.equal(diagnosed.paymentSent, false);
  assert.equal(idle.calls.length, 0);

  const declined = mockFetch();
  const decline = await declineOffer({ fetchImpl: declined.fetchImpl, merchantBase, assessment, actor: "owner_test" });
  assert.equal(decline.reason, "explicit_decline");
  assert.equal(decline.paymentSent, false);
  assert.equal(declined.calls.some((call) => call.headers["payment-signature"]), false);

  const previewCalls = mockFetch();
  const preview = await presentOffer({ fetchImpl: previewCalls.fetchImpl, merchantBase, assessment, actor: "owner_test", now: NOW });
  assert.equal(preview.ok, true);
  assert.equal(preview.revenueRecognized, false);

  async function refused(patch, expected) {
    const transport = mockFetch();
    const result = await purchaseAuthorized({
      fetchImpl: transport.fetchImpl,
      merchantBase,
      assessment,
      authorization: authorizationFor(preview.offer, patch),
      now: NOW,
      testMode: patch.testMode === false ? false : true,
    });
    assert.equal(result.reason, expected, JSON.stringify(result));
    assert.equal(result.paymentSent, false);
    assert.equal(result.revenueRecognized, false);
    assert.equal(transport.calls.some((call) => call.headers["payment-signature"]), false);
  }
  await refused({ authorizePurchase: false }, "authorization_required");
  await refused({ termsDigest: "0".repeat(64) }, "wrong_terms");
  await refused({ expiresAt: "2020-01-01T00:00:00.000Z" }, "terms_expired");
  await refused({ testMode: false }, "live_payment_refused");

  const redirected = mockFetch({ redirect: true });
  const redirect = await purchaseAuthorized({
    fetchImpl: redirected.fetchImpl,
    merchantBase,
    assessment,
    authorization: authorizationFor(preview.offer),
    now: NOW,
    testMode: true,
  });
  assert.equal(redirect.reason, "redirect_refused");
  assert.equal(redirect.paymentSent, false);

  const moved = mockFetch({ resourceRoute: "/changed" });
  const targetChanged = await purchaseAuthorized({
    fetchImpl: moved.fetchImpl,
    merchantBase,
    assessment,
    authorization: authorizationFor(preview.offer),
    now: NOW,
    testMode: true,
  });
  assert.equal(targetChanged.reason, "target_changed");
  assert.equal(targetChanged.paymentSent, false);

  const session = createJourneySession();
  const paid = mockFetch();
  const purchased = await purchaseAuthorized({
    fetchImpl: paid.fetchImpl,
    merchantBase,
    assessment,
    authorization: authorizationFor(preview.offer),
    now: NOW,
    testMode: true,
    session,
  });
  assert.equal(purchased.ok, true, JSON.stringify({ reason: purchased.reason, status: purchased.status }));
  assert.equal(purchased.paymentSent, true);
  assert.equal(purchased.revenueRecognized, false);
  assert.equal(purchased.usefulDelivery, "true");
  assert.equal(purchased.settlementReference, TX);
  assert.equal(paid.calls.filter((call) => call.headers["payment-signature"]).length, 1);
  const again = await purchaseAuthorized({
    fetchImpl: paid.fetchImpl,
    merchantBase,
    assessment,
    authorization: authorizationFor(preview.offer),
    now: NOW,
    testMode: true,
    session,
  });
  assert.equal(again.reason, "duplicate_settled");
  assert.equal(again.paymentSent, false);
  assert.equal(paid.calls.filter((call) => call.headers["payment-signature"]).length, 1);

  const failed = mockFetch({ statusForPayment: 500 });
  const failure = await purchaseAuthorized({
    fetchImpl: failed.fetchImpl,
    merchantBase,
    assessment,
    authorization: authorizationFor(preview.offer),
    now: NOW,
    testMode: true,
    session: createJourneySession(),
  });
  assert.equal(failure.paymentSent, true);
  assert.equal(failure.usefulDelivery, "false");
  assert.equal(failure.reason, "delivery_failed");
  assert.equal(failure.financialOutcome, "unknown");
  const replay = await purchaseAuthorized({
    fetchImpl: failed.fetchImpl,
    merchantBase,
    assessment,
    authorization: authorizationFor(preview.offer),
    now: NOW,
    testMode: true,
    session: createJourneySession(),
    priorEvents: [{
      paymentPresent: true,
      result: "paid_success",
      settlementReference: null,
      paidUsefulJourney: { journey: assessment.journeyId, decision: "attempt" },
    }],
  });
  assert.equal(replay.reason, "unknown_financial_outcome");
  assert.equal(replay.paymentSent, false);
  assert.equal(failed.calls.filter((call) => call.headers["payment-signature"]).length, 1);

  const echo = mockFetch({
    bodyForPayment: {
      schemaVersion: "samedaydesk.discovery-drift-report.v1",
      product: "samedaydesk-discovery-drift",
    },
  });
  const echoed = await purchaseAuthorized({
    fetchImpl: echo.fetchImpl,
    merchantBase,
    assessment,
    authorization: authorizationFor(preview.offer),
    now: NOW,
    testMode: true,
  });
  assert.equal(echoed.usefulDelivery, "false");
  assert.equal(echoed.usefulReason, "echoes_free_diagnostic");
  assert.equal(echoed.revenueRecognized, false);
  const hollow = usefulBody();
  hollow.report.findings = [];
  const missingWork = await purchaseAuthorized({
    fetchImpl: mockFetch({ bodyForPayment: hollow }).fetchImpl,
    merchantBase,
    assessment,
    authorization: authorizationFor(preview.offer),
    now: NOW,
    testMode: true,
  });
  assert.equal(missingWork.usefulReason, "additional_work_missing");
  const reuse = await recordLaterReuse({
    fetchImpl: mockFetch().fetchImpl,
    merchantBase,
    assessment,
    actor: "independent",
    usefulDelivery: "false",
  });
  assert.equal(reuse.reason, "useful_delivery_required");
  assert.equal(reuse.paymentSent, false);
});

test("commerce events record the journey without a second store or raw buyer material", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "paid-useful-journey-"));
  const telemetry = createCommerceTelemetry({ dataDir, secret: "paid-useful-journey-test-secret" });
  const assessment = await fixtureAssessment();
  const encoded = encodePaidUsefulJourneyHeader({
    journey: assessment.journeyId,
    diagnosis: assessment.diagnosisId,
    decision: "attempt",
    actor: "owner_test",
  });
  const sentinel = "SENTINEL_BODY_SHOULD_NOT_PERSIST";
  const body = usefulBody();
  body.report.findings = [sentinel];
  function finish(headers, status, responseBody) {
    const listeners = new Map();
    const req = {
      path: PAID_OPERATION_PATH,
      url: `${PAID_OPERATION_PATH}?origin=https%3A%2F%2Fexample.com&route=%2Fextract&method=GET`,
      method: "GET",
      headers,
      query: { origin: "https://example.com", route: "/extract", method: "GET" },
      ip: "203.0.113.50",
      socket: {},
    };
    const res = {
      statusCode: status,
      once(name, listener) { listeners.set(name, listener); },
      getHeader() { return undefined; },
      json(value) { return value; },
    };
    telemetry.middleware(req, res, () => {});
    if (responseBody) res.json(responseBody);
    listeners.get("finish")();
  }
  finish({
    "user-agent": "paid-useful-journey-test",
    "payment-signature": Buffer.from(JSON.stringify({ payer: PAYER, marker: sentinel })).toString("base64"),
    [PAID_USEFUL_JOURNEY_HEADER]: encoded,
  }, 200, body);
  finish({ "user-agent": "paid-useful-journey-test" }, 402, null);
  await telemetry.flush();
  const storedText = await readFile(path.join(dataDir, "commerce-events.ndjson"), "utf8");
  const stored = storedText.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(stored.length, 2);
  assert.equal(stored[0].paidUsefulJourney.usefulDelivery, "true");
  assert.equal(stored[0].paidUsefulJourney.actor, "owner_test");
  assert.equal(stored[0].paidUsefulJourney.decision, "attempt");
  assert.equal(Object.hasOwn(stored[1], "paidUsefulJourney"), false);
  assert.equal(storedText.includes(encoded), false);
  assert.equal(storedText.includes(PAYER), false);
  assert.equal(storedText.includes("https://example.com"), false);
  assert.equal(storedText.includes(sentinel), false);
  assert.equal(stored[0].result, "paid_success");
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.coverage.integrity.currentFile.unusableRecordCount, 0);
  assert.equal(snapshot.coverage.integrity.currentFile.parseableRecordCount, 2);
  assert.equal(JSON.stringify(snapshot).includes(assessment.journeyId), false);
  assert.equal((snapshot.byResult.paid_success || 0) >= 1, true);
  const names = await readFile(path.join(dataDir, "commerce-events.ndjson"), "utf8");
  assert.equal(names.includes("commerce-journey"), false);
  await rm(dataDir, { recursive: true, force: true });
});

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
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      return send(200, { kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, { isValid: true, payer: `0x${"2".repeat(40)}` });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(200, { success: true, payer: `0x${"2".repeat(40)}`, transaction: TX, network: NETWORK });
    }
    return send(404, { error: "unexpected_test_facilitator_request" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    calls,
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
    child.once("error", reject);
  });
  return { base: `http://127.0.0.1:${port}`, child, output: () => output };
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

test("local merchant unpaid regression and one test-mode settlement", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "paid-useful-merchant-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const health = await fetch(`${merchant.base}/healthz`);
  assert.equal(health.status, 200);
  const extract = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://example.com/")}`);
  assert.equal(extract.status, 402);
  const invalid = await fetch(`${merchant.base}${PAID_OPERATION_PATH}?origin=notaurl&route=%2Fextract`);
  assert.equal(invalid.status, 400);
  const assessment = await fixtureAssessment();
  const offered = await presentOffer({
    merchantBase: merchant.base,
    assessment,
    actor: "owner_test",
    now: Date.now(),
  });
  assert.equal(offered.status, 402, JSON.stringify(offered));
  assert.equal(offered.ok, true, JSON.stringify({ reason: offered.reason, challenge: offered.challenge?.resource }));
  assert.equal(offered.offer.terms.amount, "10000");
  assert.equal(offered.offer.terms.payTo, PAY_TO.toLowerCase());
  assert.equal(offered.paymentSent, false);
  const linkResponse = await fetch(`${merchant.base}${PAID_OPERATION_PATH}?origin=https%3A%2F%2Fexample.com&route=%2Fextract&method=GET`);
  const link = linkResponse.headers.get("link") || "";
  assert.match(link, /service-desc/);
  assert.match(link, /purchase-evidence/);
  const evidence = await fetch(`${merchant.base}/.well-known/agent-payment-evidence.json`);
  const manifest = await evidence.json();
  assert.equal(manifest.operations.some((item) => item.method === "GET" && item.path === PAID_OPERATION_PATH), true);
  const declined = await declineOffer({ merchantBase: merchant.base, assessment, actor: "owner_test" });
  assert.equal(declined.reason, "explicit_decline");
  const refused = await purchaseAuthorized({
    merchantBase: merchant.base,
    assessment,
    authorization: { authorizePurchase: false, actor: "owner_test" },
    now: Date.now(),
    testMode: true,
  });
  assert.equal(refused.reason, "authorization_required");
  assert.equal(refused.paymentSent, false);
  const wrong = await purchaseAuthorized({
    merchantBase: merchant.base,
    assessment,
    authorization: authorizationFor(offered.offer, { termsDigest: "0".repeat(64) }),
    now: Date.now(),
    testMode: true,
  });
  assert.equal(wrong.reason, "wrong_terms");
  assert.equal(wrong.paymentSent, false);
  const expired = await purchaseAuthorized({
    merchantBase: merchant.base,
    assessment,
    authorization: authorizationFor(offered.offer, { expiresAt: "2020-01-01T00:00:00.000Z" }),
    now: Date.now(),
    testMode: true,
  });
  assert.equal(expired.reason, "terms_expired");
  assert.equal(expired.paymentSent, false);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);

  const session = createJourneySession();
  const purchased = await purchaseAuthorized({
    merchantBase: merchant.base,
    assessment,
    authorization: authorizationFor(offered.offer),
    now: Date.now(),
    testMode: true,
    session,
  });
  assert.equal(purchased.paymentSent, true, JSON.stringify(purchased));
  assert.equal(purchased.revenueRecognized, false);
  assert.equal(purchased.usefulDelivery, "true", JSON.stringify({
    reason: purchased.usefulReason,
    status: purchased.status,
    decision: purchased.body?.decision,
    log: merchant.output().slice(-1500),
  }));
  assert.equal(purchased.settlementReference, TX);
  assert.equal(facilitator.calls.settle, 1);
  const duplicate = await purchaseAuthorized({
    merchantBase: merchant.base,
    assessment,
    authorization: authorizationFor(offered.offer),
    now: Date.now(),
    testMode: true,
    session,
  });
  assert.equal(duplicate.paymentSent, false);
  assert.equal(duplicate.reason, "duplicate_settled");
  assert.equal(facilitator.calls.settle, 1);

  const deadline = Date.now() + 3_000;
  let loaded = await loadCommerceJourneyFiles(dataDir);
  while (Date.now() < deadline && !loaded.events.some((event) => event.paidUsefulJourney?.decision === "attempt")) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    loaded = await loadCommerceJourneyFiles(dataDir);
  }
  const joined = joinPaidUsefulJourney({
    events: loaded.events,
    forwardRecords: loaded.forwardRecords,
    journeyId: assessment.journeyId,
  });
  assert.equal(joined.stages.eligible_diagnosis, "present");
  assert.equal(joined.stages.offered_operation, "present");
  assert.equal(joined.stages.explicit_decline, "present");
  assert.equal(joined.stages.explicit_attempt, "present");
  assert.equal(joined.stages.settlement, "present");
  assert.equal(joined.stages.useful_delivery, "true");
  assert.equal(joined.stages.later_task_reuse, "unknown");
  assert.equal(joined.revenueRecognized, false);
  assert.equal(joined.actorLabel, "owner_test");
  const stored = await readFile(path.join(dataDir, "commerce-events.ndjson"), "utf8");
  assert.equal(stored.includes("https://example.com"), false);
  assert.equal(stored.includes(PAYER), false);
});

test("cli diagnose stays unpaid and purchase requires test mode", async () => {
  const diagnosed = await runCli([
    "diagnose",
    "--catalog", "examples/paid-useful-journey/fixtures/catalog.json",
    "--live", "examples/paid-useful-journey/fixtures/live.json",
    "--stale-ms", "86400000",
  ]);
  assert.equal(diagnosed.code, 0, diagnosed.stderr);
  const diagnosis = JSON.parse(diagnosed.stdout);
  assert.equal(diagnosis.eligible, true);
  assert.equal(diagnosis.paymentSent, false);
  assert.equal(diagnosis.revenueRecognized, false);
  assert.equal(diagnosis.offeredOperation.path, PAID_OPERATION_PATH);

  const calls = [];
  const server = createHttpServer((req, res) => {
    calls.push({ url: req.url, payment: req.headers["payment-signature"] || null });
    const resource = `http://127.0.0.1:${server.address().port}${req.url}`;
    if (req.headers["payment-signature"]) {
      const receipt = Buffer.from(JSON.stringify({ success: true, transaction: TX, network: NETWORK })).toString("base64url");
      res.writeHead(200, { "content-type": "application/json", "payment-response": receipt });
      res.end(JSON.stringify(usefulBody()));
      return;
    }
    res.writeHead(402, {
      "content-type": "application/json",
      "payment-required": encodedChallenge(resource),
    });
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const merchant = `http://127.0.0.1:${server.address().port}`;
  const catalogArgs = [
    "--catalog", "examples/paid-useful-journey/fixtures/catalog.json",
    "--live", "examples/paid-useful-journey/fixtures/live.json",
    "--stale-ms", "86400000",
    "--merchant", merchant,
    "--actor", "owner_test",
  ];
  try {
    const live = await runCli(["purchase", ...catalogArgs, "--authorize"]);
    assert.equal(live.code, 2, live.stdout || live.stderr);
    assert.equal(JSON.parse(live.stdout).reason, "live_payment_refused");
    assert.equal(calls.some((call) => call.payment), false);
    const paid = await runCli(["purchase", ...catalogArgs, "--authorize", "--test-mode"]);
    assert.equal(paid.code, 0, paid.stdout || paid.stderr);
    const summary = JSON.parse(paid.stdout);
    assert.equal(summary.paymentSent, true);
    assert.equal(summary.usefulDelivery, "true");
    assert.equal(summary.revenueRecognized, false);
    assert.equal(paid.stdout.includes("bounded_transport_failure"), false);
    assert.equal(calls.filter((call) => call.payment).length, 1);
    const assessment = await fixtureAssessment(Date.now());
    const dataDir = await mkdtemp(path.join(tmpdir(), "paid-useful-cli-"));
    await writeFile(path.join(dataDir, "commerce-events.ndjson"), `${JSON.stringify({
      id: "prior-attempt",
      paymentPresent: true,
      result: "paid_success",
      settlementReference: TX,
      paidUsefulJourney: { journey: assessment.journeyId, decision: "attempt", usefulDelivery: "true" },
    })}\n`);
    const duplicate = await runCli(["purchase", ...catalogArgs, "--authorize", "--test-mode", "--data-dir", dataDir]);
    assert.equal(duplicate.code, 2, duplicate.stdout || duplicate.stderr);
    assert.equal(JSON.parse(duplicate.stdout).reason, "duplicate_settled");
    assert.equal(calls.filter((call) => call.payment).length, 1);
    await rm(dataDir, { recursive: true, force: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
