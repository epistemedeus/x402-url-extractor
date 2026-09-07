import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey } from "viem/accounts";
import { DEFAULT_BATCH_AUTHORIZATION, OUTCOMES } from "../src/constants.mjs";
import { normalizeAuthorization } from "../src/authorization.mjs";
import { admitExtractBatchBody } from "../src/batch-admission.mjs";
import { validateBatchBuyerOutput } from "../src/batch-output.mjs";
import { runPreflight } from "../src/preflight.mjs";
import { runAuthorizedPurchase } from "../src/purchase.mjs";
import { buildBatchUsefulBody, buildBatchPartialBody, createBatchFixtureFetch } from "../fixtures/transport.mjs";

const auth = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
const useful = () => buildBatchUsefulBody({ urls: [...auth.batch.urls], fields: [...auth.batch.fields] });

test("review: every required seller field and nullable row type is enforced", () => {
  for (const field of ["stopReason", "accounting", "costInputs", "boundary", "quote"]) {
    const body = useful(); delete body[field];
    assert.equal(validateBatchBuyerOutput(body, auth).valid, false, `missing ${field}`);
  }
  for (const change of [
    b => { b.jobId = "not-a-job"; }, b => { b.jobStatus = "invented"; },
    b => { b.accounting = null; }, b => { b.costInputs = []; },
    b => { b.quote.displayUsdc = "0.02"; }, b => { delete b.quote.meaning; },
    b => { b.sources[0].id = "different-stable-id"; },
    b => { delete b.sources[0].notes; }, b => { b.sources[0].error = "error"; },
    b => { b.sources[0].provenance = []; }, b => { b.sources[0].httpStatus = 200.5; },
    b => { b.sources[0].data = "malformed partial data"; },
  ]) {
    const body = buildBatchPartialBody({ urls: [...auth.batch.urls], fields: [...auth.batch.fields] });
    body.sources[0].status = "partial"; change(body);
    assert.equal(validateBatchBuyerOutput(body, auth).valid, false, change.toString());
  }
  assert.equal(validateBatchBuyerOutput(useful(), auth).delivery, "useful");
});

test("review: a nonterminal or contradictory body cannot be useful delivery", () => {
  for (const change of [
    b => { b.jobStatus = "running"; }, b => { b.stopReason = "interrupted"; },
    b => { b.error = "execution_interrupted"; }, b => { b.charged = false; },
  ]) {
    const body = useful(); change(body);
    assert.notEqual(validateBatchBuyerOutput(body, auth).delivery, "useful", change.toString());
  }
  const required = normalizeAuthorization({ ...DEFAULT_BATCH_AUTHORIZATION,
    requiredOutput: { ...DEFAULT_BATCH_AUTHORIZATION.requiredOutput, requiredFields: ["accounting.toString"] } });
  assert.equal(validateBatchBuyerOutput(useful(), required).valid, false, "inherited paths are not delivered fields");
});

test("review: malformed successful response uses official SDK once and is paid-invalid", async () => {
  const body = useful(); delete body.accounting;
  const fixture = createBatchFixtureFetch({ authorization: auth, paidBody: body });
  const result = await runAuthorizedPurchase({ authorization: auth, privateKey: generatePrivateKey(),
    approve: true, fetchImpl: fixture.fetchImpl });
  assert.equal(result.outcome, OUTCOMES.PAID_INVALID_OUTPUT);
  assert.equal(result.paymentSigned, true);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls.filter(c => c.hasPaymentSignature).length, 1);
});

test("review: sparse input and explicit preflight body drift are rejected before fetch", async () => {
  assert.throws(() => admitExtractBatchBody({ urls: Array(1) }), /url/i);
  let calls = 0;
  const changed = JSON.stringify({ urls: ["https://changed.example/"], fields: ["title"] });
  await assert.rejects(runPreflight({ authorization: auth, body: changed,
    fetchImpl: async () => { calls++; throw new Error("unexpected fetch"); } }), /body.*match/i);
  assert.equal(calls, 0);
});

test("review: normalized approval refuses changed bytes with stale digest or conflicting body", () => {
  const changed = admitExtractBatchBody({ urls: ["https://changed.example/"], fields: ["title"] });
  assert.throws(() => normalizeAuthorization({ ...auth, bodyRaw: changed.bodyRaw }), /digest|drift|match/i);
  assert.throws(() => normalizeAuthorization({ ...auth, body: JSON.parse(changed.bodyRaw) }), /body|match/i);
});
