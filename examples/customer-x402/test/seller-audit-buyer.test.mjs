import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { AuthorizationRefusal, assertRequestMatchesAuthorization, normalizeAuthorization } from "../src/authorization.mjs";
import { readAttemptReceipt, RECEIPT_STAGES, SETTLEMENT_STATES } from "../src/attempt-receipt.mjs";
import { OUTCOMES } from "../src/constants.mjs";
import { classifyPaidResponse } from "../src/outcome.mjs";
import { runPreflight } from "../src/preflight.mjs";
import { runAuthorizedPurchase } from "../src/purchase.mjs";
import { reconcileAttemptReceipt } from "../src/reconcile.mjs";
import { classifyRequestConstruction } from "../src/request-construction.mjs";
import {
  canonicalSellerAuditUrl,
  classifySellerAuditBody,
  normalizeSellerAuditInput,
  sellerAuditTerms,
} from "../src/seller-audit.mjs";
import { createFakeReconcileClient } from "../fixtures/fake-reconcile-client.mjs";
import { buildChallenge } from "../fixtures/transport.mjs";

const FIXTURE_URL = new URL("../fixtures/authorization-seller-audit.json", import.meta.url);
const BOUNDARY = Object.freeze({
  credentialsUsed: false,
  targetPaymentSigned: false,
  targetPaymentSent: false,
  targetRequestSent: false,
  redirectsFollowed: false,
  responseBodyRead: false,
  schemaRetained: false,
  queryValuesRetained: false,
});

function account() {
  return privateKeyToAccount(generatePrivateKey());
}

function fixtureAuth() {
  return normalizeAuthorization(JSON.parse(readFileSync(FIXTURE_URL, "utf8")));
}

function boundAuth(input = { origin: "https://seller.example", route: "/extract", method: "GET" }) {
  const query = normalizeSellerAuditInput(input);
  return normalizeAuthorization(sellerAuditTerms(canonicalSellerAuditUrl("https://agents.samedaydesk.com", query)));
}

function auditBody(query, patch = {}) {
  const body = {
    ok: true,
    product: "samedaydesk-seller-integrity-audit",
    version: "1.3.0",
    checkedAt: "2026-08-12T07:50:00.000Z",
    decision: "machine_buyable",
    request: {
      origin: query.origin,
      route: query.route,
      method: query.method,
      requiredPaths: [...query.requiredPaths],
      requireBazaar: query.requireBazaar,
      referral: query.referral,
    },
    report: {
      auditCompleted: true,
      failureCode: null,
      responseContract: { requiredPaths: [...query.requiredPaths] },
      repairPlan: { guaranteedPaths: [] },
    },
    boundary: { ...BOUNDARY },
  };
  return {
    ...body,
    ...patch,
    request: patch.request || body.request,
    report: patch.report ? { ...body.report, ...patch.report } : body.report,
    boundary: patch.boundary || body.boundary,
  };
}

function challengeFor(authorization, overrides = {}) {
  return buildChallenge({
    url: authorization.url,
    amount: authorization.amountCapAtomic,
    ...overrides,
  });
}

function challengeResponse(challenge) {
  return new Response(JSON.stringify(challenge), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge),
    },
  });
}

function purchaseFetch(authorization, { body, onPaid, challenge } = {}) {
  const offered = challenge || challengeFor(authorization);
  let paidSends = 0;
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const paid = request.headers.has("payment-signature") || request.headers.has("PAYMENT-SIGNATURE");
    if (!paid) return challengeResponse(offered);
    paidSends += 1;
    if (onPaid) return onPaid(request);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, paidSends: () => paidSends };
}

async function buy(authorization, options) {
  const transport = purchaseFetch(authorization, options);
  const result = await runAuthorizedPurchase({
    authorization,
    account: account(),
    fetchImpl: transport.fetchImpl,
    approve: true,
    ...options.purchase,
  });
  return { result, paidSends: transport.paidSends() };
}

test("seller-audit authorization binds the canonical query and refuses drift before a wallet", () => {
  const auth = fixtureAuth();
  assert.equal(auth.sellerAudit, true);
  assert.equal(auth.batch, null);
  assert.equal(auth.lockfile, undefined);
  assert.equal(auth.method, "GET");
  assert.equal(auth.path, "/commerce/seller-integrity-audit");
  const posted = boundAuth({ origin: "https://seller.example", route: "/simulate", method: "POST" });
  assert.equal(posted.method, "GET");
  assert.equal(posted.sellerAuditQuery.method, "POST");
  assert.equal(posted.url.includes("method=POST"), true);
  assert.equal(auth.amountCapAtomic, "10000");
  assert.deepEqual(auth.sellerAuditQuery, {
    origin: "https://seller.example",
    route: "/extract",
    method: "GET",
    requiredPaths: [],
    requireBazaar: false,
    referral: null,
  });
  const construction = classifyRequestConstruction(auth.url, { method: "GET" });
  assert.equal(construction.kind, "bound_request");
  assert.equal(construction.purchaseReady, true);
  assert.equal(classifyRequestConstruction("https://agents.samedaydesk.com/commerce/seller-integrity-audit").kind, "unsigned_discovery");
  assert.throws(() => normalizeAuthorization(sellerAuditTerms("https://agents.samedaydesk.com/commerce/seller-integrity-audit")), /unpaid discovery/);
  assert.throws(() => normalizeAuthorization(sellerAuditTerms(`${auth.url}&token=secret`)), /unsupported seller-audit query field/);
  assert.throws(() => normalizeAuthorization(sellerAuditTerms(auth.url.replace("method=GET", "method=get"))), /exact canonical/);
  assert.throws(() => normalizeAuthorization(sellerAuditTerms(`${auth.url}&requireBazaar=false`)), /exact canonical/);
  assert.throws(() => normalizeAuthorization(sellerAuditTerms(canonicalSellerAuditUrl("https://agents.samedaydesk.com", normalizeSellerAuditInput({
    origin: "https://10.0.0.1",
    route: "/extract",
    method: "GET",
  })))), /public HTTPS origin/);
  assert.throws(() => normalizeAuthorization({ ...JSON.parse(readFileSync(FIXTURE_URL, "utf8")), method: "POST" }), /\/extract\/batch/);
  assert.throws(() => normalizeAuthorization({
    ...JSON.parse(readFileSync(FIXTURE_URL, "utf8")),
    requiredOutput: { ...auth.requiredOutput, task: "markdown" },
  }), /extract task/);
  assert.throws(() => assertRequestMatchesAuthorization(auth.url, auth, { method: "GET", body: "{}" }), /seller-integrity-audit/);
  assert.throws(() => assertRequestMatchesAuthorization("https://agents.samedaydesk.com/commerce/seller-integrity-audit?origin=https%3A%2F%2Fother.example&route=%2Fextract&method=GET", auth), /exact authorized/);
});

test("contract command is unpaid and does not ask for a signer", () => {
  const run = spawnSync(process.execPath, ["bin/seller-audit.mjs", "contract"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(run.status, 0, run.stderr);
  const contract = JSON.parse(run.stdout);
  assert.equal(contract.preflight.walletAccessed, false);
  assert.equal(contract.preflight.paymentSigned, false);
  assert.equal(contract.preflight.paymentSent, false);
  assert.equal(contract.preflight.charged, false);
  assert.equal(contract.paid.livePaymentRefusedByDefault, true);
  assert.equal(contract.paid.sdk, "@x402/fetch@2.16.0");
  assert.equal(contract.recovery.respend, false);
  assert.equal(contract.feedbackRequired, false);
  assert.equal(contract.route.path, "/commerce/seller-integrity-audit");
  assert.equal(contract.product, "samedaydesk-seller-integrity-audit");
  assert.equal(contract.outputVersion, "1.3.0");
});

test("preflight observes the challenge and does not sign", async () => {
  const authorization = fixtureAuth();
  let wallet = false;
  const result = await runPreflight({
    authorization,
    fetchImpl: async () => challengeResponse(challengeFor(authorization)),
    loadAccount: () => { wallet = true; },
  });
  assert.equal(result.outcome, OUTCOMES.PREFLIGHT_OK);
  assert.equal(result.walletAccessed, false);
  assert.equal(result.paymentSigned, false);
  assert.equal(result.paymentSent, false);
  assert.equal(wallet, false);
  assert.equal(result.offer.amountAtomic, "10000");
});

test("one synthetic paid send delivers a complete compatible audit", async () => {
  const authorization = boundAuth({
    origin: "https://seller.example",
    route: "/extract",
    method: "GET",
    requiredPaths: ["ok", "title"],
    requireBazaar: "true",
  });
  const { result, paidSends } = await buy(authorization, {
    body: auditBody(authorization.sellerAuditQuery),
  });
  assert.equal(paidSends, 1);
  assert.equal(result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(result.evidence.outputDelivery, "audit_complete");
  assert.equal(result.paymentSent, true);
  assert.equal(result.callerResultFeedback.available, false);
  assert.match(result.message, /feedback was not required/);
  assert.match(result.message, /settlement remains unverified/);
  const ready = await buy(authorization, {
    body: auditBody(authorization.sellerAuditQuery, { decision: "contract_ready" }),
  });
  assert.equal(ready.paidSends, 1);
  assert.equal(ready.result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(ready.result.evidence.outputDelivery, "audit_complete");
});

test("useful refusal and incomplete audits are delivered once and are not a respend", async () => {
  const authorization = boundAuth({
    origin: "https://seller.example",
    route: "/extract",
    method: "GET",
    requiredPaths: ["ok", "title"],
  });
  const refused = await buy(authorization, {
    body: auditBody(authorization.sellerAuditQuery, {
      ok: false,
      decision: "repair_required",
    }),
  });
  assert.equal(refused.paidSends, 1);
  assert.equal(refused.result.outcome, OUTCOMES.PARTIAL_DELIVERED);
  assert.equal(refused.result.evidence.outputDelivery, "audit_refused");
  const missing = await buy(authorization, {
    body: auditBody(authorization.sellerAuditQuery, {
      report: { responseContract: { requiredPaths: ["ok"] }, repairPlan: { guaranteedPaths: [] } },
    }),
  });
  assert.equal(missing.result.outcome, OUTCOMES.PARTIAL_DELIVERED);
  assert.equal(missing.result.evidence.outputReason, "required_output_not_guaranteed");
  const incomplete = await buy(authorization, {
    body: auditBody(authorization.sellerAuditQuery, {
      ok: false,
      decision: "repair_required",
      report: { auditCompleted: false, failureCode: "openapi_unavailable" },
    }),
  });
  assert.equal(incomplete.paidSends, 1);
  assert.equal(incomplete.result.outcome, OUTCOMES.PARTIAL_DELIVERED);
  assert.equal(incomplete.result.evidence.outputDelivery, "audit_incomplete");
  assert.match(incomplete.result.message, /not a second purchase/);
});

test("wrong product, request, and boundary are paid invalid output", async () => {
  const authorization = fixtureAuth();
  const mismatch = await buy(authorization, {
    body: auditBody(authorization.sellerAuditQuery, { product: "other-product" }),
  });
  assert.equal(mismatch.result.outcome, OUTCOMES.PAID_INVALID_OUTPUT);
  const drifted = await buy(authorization, {
    body: auditBody(authorization.sellerAuditQuery, {
      request: { ...auditBody(authorization.sellerAuditQuery).request, route: "/other" },
    }),
  });
  assert.equal(drifted.result.outcome, OUTCOMES.PAID_INVALID_OUTPUT);
  const boundary = await buy(authorization, {
    body: auditBody(authorization.sellerAuditQuery, {
      boundary: { ...BOUNDARY, targetPaymentSent: true },
    }),
  });
  assert.equal(boundary.result.outcome, OUTCOMES.PAID_INVALID_OUTPUT);
  assert.equal(boundary.paidSends, 1);
});

test("wrong target, method, price, network, and payee are refused before signing", async () => {
  const authorization = fixtureAuth();
  const cases = [
    challengeFor(authorization, { url: "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com" }),
    challengeFor(authorization, { amount: "10001" }),
    challengeFor(authorization, { network: "eip155:1" }),
    challengeFor(authorization, { payTo: "0x0000000000000000000000000000000000000001" }),
  ];
  for (const challenge of cases) {
    let wallet = false;
    const result = await runAuthorizedPurchase({
      authorization,
      approve: true,
      loadAccount: () => { wallet = true; throw new Error("wallet"); },
      fetchImpl: async () => challengeResponse(challenge),
    });
    assert.equal(wallet, false);
    assert.equal(result.walletAccessed, false);
    assert.equal(result.paymentSigned, false);
    assert.equal(result.paymentSent, false);
    assert.equal(result.outcome, OUTCOMES.AUTHORIZATION_REFUSED);
  }
  assert.throws(() => normalizeAuthorization({
    ...JSON.parse(readFileSync(FIXTURE_URL, "utf8")),
    method: "POST",
  }), AuthorizationRefusal);
});

test("redirects are refused before a wallet read", async () => {
  const authorization = fixtureAuth();
  let loaded = false;
  const redirected = await runAuthorizedPurchase({
    authorization,
    approve: true,
    loadAccount: () => { loaded = true; throw new Error("wallet"); },
    fetchImpl: async () => ({
      status: 302,
      redirected: true,
      headers: new Headers({ location: "https://evil.example/steal" }),
      body: null,
    }),
  });
  assert.equal(loaded, false);
  assert.equal(redirected.paymentSent, false);
  assert.equal(redirected.walletAccessed, false);
  assert.equal(redirected.outcome, OUTCOMES.UNKNOWN);
  const thrown = await runAuthorizedPurchase({
    authorization,
    approve: true,
    loadAccount: () => { loaded = true; throw new Error("wallet"); },
    fetchImpl: async (_input, init) => {
      assert.equal(init.redirect, "error");
      throw new Error("redirect_refused");
    },
  });
  assert.equal(loaded, false);
  assert.equal(thrown.paymentSent, false);
  assert.equal(thrown.paymentSigned, false);
});

test("a lost paid response reconciles without a second spend", async () => {
  const authorization = fixtureAuth();
  const dir = mkdtempSync(join(tmpdir(), "seller-audit-receipt-"));
  const receiptPath = join(dir, "attempt.json");
  const challenge = challengeFor(authorization);
  let paidSends = 0;
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const paid = request.headers.has("payment-signature") || request.headers.has("PAYMENT-SIGNATURE");
    if (!paid) return challengeResponse(challenge);
    paidSends += 1;
    throw new Error("socket hang up");
  };
  try {
    const buyer = account();
    const first = await runAuthorizedPurchase({
      authorization, account: buyer, fetchImpl, approve: true, attemptReceiptPath: receiptPath,
    });
    assert.equal(first.outcome, OUTCOMES.UNKNOWN);
    assert.equal(first.paymentSent, true);
    assert.equal(paidSends, 1);
    const receipt = readAttemptReceipt(receiptPath);
    assert.equal(receipt.stage, RECEIPT_STAGES.PAID_SEND_DISPATCHED);
    assert.equal(receipt.settlementState, SETTLEMENT_STATES.UNKNOWN);
    assert.equal(receipt.request.url, authorization.url);
    const reconciled = await reconcileAttemptReceipt({
      receipt,
      client: createFakeReconcileClient({ readContract: () => false }),
    });
    assert.equal(reconciled.decision, "unused_within_window");
    assert.equal(paidSends, 1);
    const second = await runAuthorizedPurchase({
      authorization, account: buyer, fetchImpl, approve: true, attemptReceiptPath: receiptPath,
    });
    assert.equal(second.paymentSent, false);
    assert.equal(paidSends, 1);
    assert.match(second.message, /attempt receipt failed before paid send/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seller-audit delivery does not use the extract task classifier", () => {
  const authorization = fixtureAuth();
  const response = new Response(JSON.stringify(auditBody(authorization.sellerAuditQuery)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const classified = classifyPaidResponse({
    response,
    body: auditBody(authorization.sellerAuditQuery),
    authorization,
    requiredOutput: authorization.requiredOutput,
  });
  assert.equal(classified.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(classified.evidence.task, null);
  assert.equal(classifySellerAuditBody({ ok: true }, authorization).delivery, "invalid");
});

test('caller-required seller-audit fields reject missing/null values and preserve false/nested values', async () => {
  const base = fixtureAuth();
  const requiredFields = [...base.requiredOutput.requiredFields, 'caller.extra'];
  const authorization = normalizeAuthorization({ ...base, requiredOutput:{...base.requiredOutput,requiredFields} });
  for (const [extra, valid] of [[undefined,false], [null,false], [false,true], [{nested:false},true]]) {
    const body = auditBody(authorization.sellerAuditQuery);
    if (extra !== undefined) body.caller = {extra};
    const {result,paidSends} = await buy(authorization,{body});
    assert.equal(paidSends,1);
    assert.equal(result.outcome, valid ? OUTCOMES.VALID_DELIVERED : OUTCOMES.PAID_INVALID_OUTPUT, `extra=${JSON.stringify(extra)}`);
  }
  const nested = normalizeAuthorization({...base, requiredOutput:{...base.requiredOutput, requiredFields:[...base.requiredOutput.requiredFields,'caller.extra.nested']}});
  for (const value of [null,undefined,false,0,'']) {
    const body = auditBody(nested.sellerAuditQuery); body.caller={extra:{nested:value}};
    const {result} = await buy(nested,{body});
    assert.equal(result.outcome, value == null ? OUTCOMES.PAID_INVALID_OUTPUT : OUTCOMES.VALID_DELIVERED);
  }
});

test('caller seller-audit byte limit applies to complete/refused/incomplete output without extract semantics', async () => {
  const base = fixtureAuth();
  for (const patch of [{}, {ok:false,decision:'repair_required'}, {ok:false,decision:'repair_required',report:{auditCompleted:false,failureCode:'openapi_unavailable'}}]) {
    const body = auditBody(base.sellerAuditQuery,patch);
    const bytes = Buffer.byteLength(JSON.stringify(body));
    for (const [limit, valid] of [[bytes-1,false],[bytes,true]]) {
      const authorization = normalizeAuthorization({...base,requiredOutput:{...base.requiredOutput,maxResponseBytes:limit}});
      const {result,paidSends}=await buy(authorization,{body});
      assert.equal(paidSends,1);
      assert.equal(result.evidence.outputValid,valid);
      if (!valid) assert.equal(result.outcome,OUTCOMES.PAID_INVALID_OUTPUT);
      else assert.equal(result.evidence.outputDelivery, patch.report ? 'audit_incomplete' : patch.ok===false ? 'audit_refused' : 'audit_complete');
    }
  }
});
