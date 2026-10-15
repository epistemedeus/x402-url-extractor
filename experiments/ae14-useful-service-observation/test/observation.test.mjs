import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createCallerResultFeedbackService } from "../../../caller-result-feedback.mjs";
import { CALLER_RESULT_FEEDBACK_FILENAME } from "../../../caller-result-feedback.mjs";
import { SERVICE_VERSION } from "../../../service-version.mjs";
import { OBSERVATION_FILENAME, SERVING_VERSION } from "../src/contract.mjs";
import { coldReplay } from "../src/cold-replay.mjs";
import {
  NOW,
  observationFor,
  observedPair,
  readText,
  removeDir,
  secret,
  submit,
  tempDir,
  tokenFor,
  writeCaptures,
} from "./helpers.mjs";

async function withPair() {
  const dir = await tempDir();
  const key = secret();
  const pair = observedPair();
  await writeCaptures(dir, [pair]);
  const observation = observationFor(dir, key);
  const token = tokenFor(pair, key);
  return { dir, key, pair, observation, token };
}

test("a real retained extract response stays schema-valid with usefulness unknown", async () => {
  const pair = observedPair();
  assert.equal(pair.validation.responseDigest, pair.digest);
  assert.equal(pair.validation.usefulness, "unknown");
  assert.equal(pair.validation.validatorVerdict, "pass");
  assert.equal(pair.validation.deliveryClass, "full_bounded_capture");
  assert.equal(SERVICE_VERSION, SERVING_VERSION);
});

test("callers that send only the existing disposition get the canonical response", async () => {
  const { dir, key, pair, observation, token } = await withPair();
  try {
    const direct = createCallerResultFeedbackService({ dataDir: dir, key, now: () => NOW });
    const body = { disposition: "useful", reasonCategory: "matched_task" };
    const wrapped = await submit(observation, token, body);
    const againDir = await tempDir();
    await writeCaptures(againDir, [pair]);
    const alone = createCallerResultFeedbackService({ dataDir: againDir, key, now: () => NOW });
    const raw = Buffer.from(JSON.stringify(body));
    const plain = await alone.submit({ token, body, rawBody: raw, query: {} });
    assert.deepEqual(wrapped, plain);
    assert.equal(wrapped.body.usefulness, "unknown");
    assert.equal(wrapped.body.charged, false);
    assert.equal(Object.hasOwn(wrapped.body, "e08UsefulWork"), false);
    const bad = { disposition: "maybe" };
    const badRaw = Buffer.from(JSON.stringify(bad));
    assert.deepEqual(
      await submit(observation, token, bad),
      await alone.submit({ token, body: bad, rawBody: badRaw, query: {} }),
    );
    assert.deepEqual(
      await submit(observation, token, body, { query: { extra: "1" } }),
      await alone.submit({ token, body, rawBody: raw, query: { extra: "1" } }),
    );
    const paddedRaw = Buffer.from(`{${" ".repeat(520)}"disposition":"useful"}`);
    assert.deepEqual(
      await observation.submitExtension({ token, body: { disposition: "useful" }, rawBody: paddedRaw, query: {} }),
      await alone.submit({ token, body: { disposition: "useful" }, rawBody: paddedRaw, query: {} }),
    );
    const extension = await readText(path.join(dir, OBSERVATION_FILENAME)).catch((error) => error.code);
    assert.equal(extension, "ENOENT");
    await removeDir(againDir);
  } finally {
    await removeDir(dir);
  }
});

test("retained-use and next-task stay declared, survive restart, and omit bearers", async () => {
  const { dir, key, pair, observation, token } = await withPair();
  try {
    const body = {
      disposition: "useful",
      reasonCategory: "saved_a_step",
      retainedUse: "retained",
      nextTask: { relation: "distinct_later_task", taskRef: "task-a" },
      originLabel: "owner_qa",
    };
    const accepted = await submit(observation, token, body);
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.body.accepted, true);
    assert.equal(accepted.body.retainedUse, "retained");
    assert.equal(accepted.body.observedRepeat, "unknown");
    assert.equal(accepted.body.usefulness, "unknown");
    assert.equal(accepted.body.e08UsefulWork, "unknown");
    const replay = await submit(observation, token, body);
    assert.equal(replay.body.idempotentReplay, true);
    const reopened = observationFor(dir, key);
    const view = await reopened.observe(pair.paid.id);
    assert.equal(view.delivered.schemaValid, true);
    assert.equal(view.delivered.usefulness, "unknown");
    assert.equal(view.declared.usefulnessDisposition, "useful");
    assert.equal(view.declared.retainedUse, "retained");
    assert.equal(view.declared.nextTask.taskRef, "task-a");
    assert.equal(view.observedRepeat.class, "unknown");
    assert.equal(view.outsideUsefulAnswerArrived.value, "unknown");
    const stored = await readText(path.join(dir, OBSERVATION_FILENAME));
    assert.equal(stored.includes(token), false);
    assert.equal(stored.includes("ok.example"), false);
    assert.equal(stored.includes("Example Domain"), false);
    const feedback = await readText(path.join(dir, CALLER_RESULT_FEEDBACK_FILENAME));
    assert.equal(feedback.includes("retainedUse"), false);
    assert.equal(feedback.includes(token), false);
  } finally {
    await removeDir(dir);
  }
});

test("decline, omission, malformation, tamper, wrong result, receipt, source, and tenant stay unbound", async () => {
  const dir = await tempDir();
  const key = secret();
  const pair = observedPair();
  const other = observedPair();
  await writeCaptures(dir, [pair, other]);
  const observation = observationFor(dir, key);
  const token = tokenFor(pair, key);
  try {
    const declined = await submit(observation, token, { decline: true });
    assert.equal(declined.statusCode, 200);
    assert.equal(declined.body.declined, true);
    assert.equal(declined.body.accepted, false);
    let view = await observation.observe(pair.paid.id);
    assert.equal(view.declared.declined, true);
    assert.equal(view.declared.usefulnessDisposition, "unknown");
    assert.notEqual(view.delivered.reason, "failure");

    const omitted = await observationFor(dir, key).observe(other.paid.id);
    assert.equal(omitted.declared.usefulnessDisposition, "unknown");
    assert.equal(omitted.declared.reason, "declaration_absent");
    assert.equal(omitted.delivered.schemaValid, true);

    const malformed = await submit(observation, tokenFor(other, key), { disposition: "useful", customer: "synthetic" });
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.body.code, "unbounded_field");

    const [payload, mac] = tokenFor(other, key).split(".");
    const changed = Buffer.from(mac, "base64url");
    changed[0] ^= 1;
    const tampered = await submit(observation, `${payload}.${changed.toString("base64url")}`, { disposition: "useful", retainedUse: "retained" });
    assert.equal(tampered.body.code, "tampered_capability");

    const mismatched = observedPair();
    mismatched.paid.responseDigest = "ab".repeat(32);
    mismatched.validation.responseDigest = "ab".repeat(32);
    const wrongDir = await tempDir();
    await writeCaptures(wrongDir, [mismatched]);
    const wrongResult = await submit(observationFor(wrongDir, key), tokenFor(observedPair({
      id: mismatched.paid.id,
      requestDigest: mismatched.paid.requestDigest,
      settlement: mismatched.paid.settlementReference,
    }), key), { disposition: "not_useful", retainedUse: "not_retained" });
    assert.equal(wrongResult.body.code, "response_mismatch");

    const unpaid = observedPair();
    unpaid.paid.settlementReference = null;
    unpaid.validation.settlementReference = null;
    const receiptDir = await tempDir();
    await writeCaptures(receiptDir, [unpaid]);
    const wrongReceipt = await submit(
      observationFor(receiptDir, key),
      tokenFor(unpaid, key),
      { disposition: "useful", retainedUse: "retained" },
    );
    assert.equal(wrongReceipt.body.code, "settlement_unbound");

    const wrongSource = await submit(observation, tokenFor(other, key), {
      disposition: "useful",
      retainedUse: "not_retained",
      sourceSha: "0123456789abcdef0123456789abcdef01234567",
    });
    assert.equal(wrongSource.statusCode, 403);
    assert.equal(wrongSource.body.code, "source_refused");

    const wrongTenant = await submit(observation, tokenFor(other, key), {
      disposition: "useful",
      retainedUse: "retained",
      tenant: "other-tenant",
    });
    assert.equal(wrongTenant.statusCode, 403);
    assert.equal(wrongTenant.body.code, "tenant_refused");

    view = await observation.observe(other.paid.id);
    assert.equal(view.declared.usefulnessDisposition, "unknown");
    await removeDir(wrongDir);
    await removeDir(receiptDir);
  } finally {
    await removeDir(dir);
  }
});

test("duplicate capture, lost response, and a source gap stay unknown rather than demand", async () => {
  const dir = await tempDir();
  const key = secret();
  const pair = observedPair();
  await writeCaptures(dir, [pair, { paid: { ...pair.paid }, validation: pair.validation }]);
  const observation = observationFor(dir, key);
  const duplicate = await submit(observation, tokenFor(pair, key), { disposition: "useful", retainedUse: "retained" });
  assert.equal(duplicate.body.code, "duplicate_capture");
  const lost = observedPair();
  const missing = await submit(observation, tokenFor(lost, key), { disposition: "useful", retainedUse: "retained" });
  assert.equal(missing.body.code, "missing_capture");
  const absent = await observation.observe(lost.paid.id);
  assert.equal(absent.delivered.schemaValid, "unknown");
  assert.equal(absent.delivered.reason, "missing_capture");
  assert.equal(absent.declared.usefulnessDisposition, "unknown");
  assert.equal(absent.outsideUsefulAnswerArrived.value, "unknown");
  const gap = await observation.report({ windowCoverage: "gap" });
  assert.equal(gap.rates, null);
  assert.equal(gap.outsideCustomerCount, null);
  assert.equal(gap.absenceIsNotNoRepeat, true);
  assert.equal(gap.unclassifiedSettlementsAreNotCustomers, true);
  assert.equal(gap.observations.every((row) => row.observedRepeat.class === "unknown"), true);
  await removeDir(dir);
});

test("distinct later-task purchase, same-task retry, pseudonym continuity, and free retrieval stay apart", async () => {
  const dir = await tempDir();
  const key = secret();
  const prior = observedPair();
  const later = observedPair();
  const retry = observedPair({ requestDigest: prior.paid.requestDigest });
  prior.paid.requestStartedAt = "2026-09-10T00:00:00.000Z";
  prior.paid.responseFinishedAt = "2026-09-10T00:00:01.000Z";
  later.paid.requestStartedAt = "2026-09-10T00:00:02.000Z";
  later.paid.responseFinishedAt = "2026-09-10T00:00:03.000Z";
  retry.paid.requestStartedAt = "2026-09-10T00:00:04.000Z";
  retry.paid.responseFinishedAt = "2026-09-10T00:00:05.000Z";
  const solo = observedPair();
  const pseudoLater = observedPair();
  await writeCaptures(dir, [prior, later, retry, solo, pseudoLater]);
  const observation = observationFor(dir, key);
  const priorToken = tokenFor(prior, key);
  const laterToken = tokenFor(later, key);
  const retryToken = tokenFor(retry, key);
  try {
    const first = await submit(observation, priorToken, {
      disposition: "useful",
      retainedUse: "retained",
      nextTask: { relation: "distinct_later_task", taskRef: "task-a" },
      originLabel: "external_unknown",
    });
    assert.equal(first.statusCode, 200);
    const linked = await submit(observation, laterToken, {
      disposition: "useful",
      retainedUse: "retained",
      nextTask: { relation: "distinct_later_task", taskRef: "task-b" },
      priorBinding: { paidEvidenceId: prior.paid.id, taskRef: "task-a" },
      originLabel: "external_unknown",
    }, { priorCapability: priorToken });
    assert.equal(linked.statusCode, 200, JSON.stringify(linked.body));
    const priorView = await observation.observe(prior.paid.id);
    assert.equal(priorView.observedRepeat.class, "distinct_later_task_purchase");
    assert.equal(priorView.observedRepeat.countsAsRepeatPurchase, true);
    assert.equal(priorView.observedRepeat.payment, "observed");
    assert.equal(priorView.observedRepeat.link, "caller_declared");
    assert.equal(priorView.outsideUsefulAnswerArrived.value, "unknown");
    assert.equal(priorView.outsideUsefulAnswerArrived.reason, "label_is_not_outsider");
    assert.equal(priorView.declared.originLabel, "external_unknown");

    const wrongCaller = await submit(observationFor(dir, key), tokenFor(pseudoLater, key), {
      disposition: "not_useful",
      retainedUse: "not_retained",
      nextTask: { relation: "distinct_later_task", taskRef: "task-c" },
      priorBinding: { paidEvidenceId: prior.paid.id, taskRef: "task-a" },
    }, { priorCapability: laterToken });
    assert.equal(wrongCaller.body.code, "wrong_caller");

    const sameTask = await submit(observation, retryToken, {
      disposition: "useful",
      retainedUse: "retained",
      nextTask: { relation: "same_task", taskRef: "task-a" },
      priorBinding: { paidEvidenceId: prior.paid.id, taskRef: "task-a" },
    }, { priorCapability: priorToken });
    assert.equal(sameTask.statusCode, 200, JSON.stringify(sameTask.body));
    assert.equal((await observation.observe(prior.paid.id)).observedRepeat.class, "distinct_later_task_purchase");

    const retryOnlyDir = await tempDir();
    const retryPrior = observedPair();
    const retryLater = observedPair({ requestDigest: retryPrior.paid.requestDigest });
    retryLater.paid.requestStartedAt = "2026-09-10T00:00:02.000Z";
    retryLater.paid.responseFinishedAt = "2026-09-10T00:00:03.000Z";
    await writeCaptures(retryOnlyDir, [retryPrior, retryLater]);
    const retryObservation = observationFor(retryOnlyDir, key);
    const retryPriorToken = tokenFor(retryPrior, key);
    await submit(retryObservation, retryPriorToken, {
      disposition: "useful",
      retainedUse: "retained",
      nextTask: { relation: "same_task", taskRef: "task-a" },
    });
    const retryAccepted = await submit(retryObservation, tokenFor(retryLater, key), {
      disposition: "useful",
      nextTask: { relation: "distinct_later_task", taskRef: "task-b" },
      priorBinding: { paidEvidenceId: retryPrior.paid.id, taskRef: "task-a" },
    }, { priorCapability: retryPriorToken });
    assert.equal(retryAccepted.statusCode, 200, JSON.stringify(retryAccepted.body));
    const retryView = await retryObservation.observe(retryPrior.paid.id);
    assert.equal(retryView.observedRepeat.class, "same_task_retry");
    assert.equal(retryView.observedRepeat.countsAsRepeatPurchase, false);

    const pseudo = await observation.recordObservedContinuation({
      priorPaidEvidenceId: solo.paid.id,
      laterPaidEvidenceId: pseudoLater.paid.id,
      access: "pseudonym_only",
      actorContinuity: "pseudonym",
      synthetic: true,
    });
    assert.equal(pseudo.statusCode, 200, JSON.stringify(pseudo.body));
    const pseudoView = await observation.observe(solo.paid.id);
    assert.equal(pseudoView.observedRepeat.class, "pseudonym_continuity");
    assert.equal(pseudoView.observedRepeat.countsAsRepeatPurchase, false);
    assert.equal(pseudoView.observedRepeat.boundToPriorPaidResult, false);
    assert.equal((await observation.observe(prior.paid.id)).observedRepeat.countsAsRepeatPurchase, true);
    const stored = await readText(path.join(dir, OBSERVATION_FILENAME));
    assert.equal(stored.includes(priorToken), false);
    assert.equal(stored.includes(laterToken), false);

    const freeDir = await tempDir();
    const freePrior = observedPair();
    await writeCaptures(freeDir, [freePrior]);
    const freeObservation = observationFor(freeDir, key);
    const free = await freeObservation.recordObservedContinuation({
      priorPaidEvidenceId: freePrior.paid.id,
      access: "free_entitled",
      synthetic: true,
    });
    assert.equal(free.statusCode, 200, JSON.stringify(free.body));
    const freeView = await freeObservation.observe(freePrior.paid.id);
    assert.equal(freeView.observedRepeat.class, "entitled_reuse");
    assert.equal(freeView.observedRepeat.countsAsRepeatPurchase, false);
    assert.equal(freeView.observedRepeat.countsAsEntitledReuse, true);
    assert.equal(freeView.observedRepeat.payment, "absent");

    const purchasedAsFree = await freeObservation.recordObservedContinuation({
      priorPaidEvidenceId: freePrior.paid.id,
      laterPaidEvidenceId: freePrior.paid.id,
      access: "free_entitled",
      synthetic: true,
    });
    assert.equal(purchasedAsFree.body.code, "inconsistent_access");

    const report = await observation.report();
    assert.equal(report.rates, null);
    assert.equal(report.outsideCustomerCount, null);
    assert.equal(report.outsideUsefulAnswerArrived.value, "unknown");
    assert.equal(report.e08UsefulWork.value, "unknown");
    assert.equal(report.measurement.ingested, "unknown");
    assert.equal(report.measurement.e18HeadUsed, "11871c33e294ad6acecd0fa7049d9104d9152723");
    assert.equal(report.hJoin.ran, "unknown");
    assert.ok(report.tally.observedDistinctLaterTaskPurchases >= 1);
    assert.ok(report.tally.observedPseudonymContinuity >= 1);
    const comparison = await freeObservation.compareEquippedRoutes(freePrior.paid.id);
    assert.equal(comparison.direct.retainedUse, "unknown");
    assert.equal(comparison.extended.observedRepeat, "entitled_reuse");
    assert.equal(comparison.direct.setupReads < comparison.extended.setupReads, true);
    assert.equal(typeof comparison.direct.latencyMs, "number");
    assert.equal(typeof comparison.extended.latencyMs, "number");
    assert.equal(comparison.outsideUsefulAnswerArrived.value, "unknown");

    const replay = await coldReplay(freeDir);
    assert.equal(replay.network, false);
    assert.equal(replay.outsideUsefulAnswerArrived.value, "unknown");
    assert.equal(replay.tally.observedEntitledReuses, 1);
    await removeDir(retryOnlyDir);
    await removeDir(freeDir);
  } finally {
    await removeDir(dir);
  }
});

test("a foreign tenant cannot adopt another tenant's declaration", async () => {
  const { dir, key, pair, observation, token } = await withPair();
  try {
    await submit(observation, token, {
      disposition: "useful",
      retainedUse: "retained",
      originLabel: "sponsored",
    });
    const other = observationFor(dir, key, { tenant: "other-tenant" });
    const refused = await submit(other, token, {
      disposition: "not_useful",
      retainedUse: "not_retained",
      tenant: "other-tenant",
    });
    assert.equal(refused.body.code, "tenant_refused");
    const view = await other.observe(pair.paid.id);
    assert.equal(view.declared.usefulnessDisposition, "useful");
    assert.equal(view.declared.retainedUse, "unknown");
    assert.equal(view.declared.originLabel, "unknown");
  } finally {
    await removeDir(dir);
  }
});

test("the serving mount is applied on this branch and the price file is untouched by this package", async () => {
  const server = await readFile(new URL("../../../server.js", import.meta.url), "utf8");
  const commerce = await readFile(new URL("../../../commerce-events.mjs", import.meta.url), "utf8");
  assert.equal(server.includes("usefulServiceObservation.submitExtension"), true);
  assert.equal(server.includes("usefulServiceObservationPublicContract"), true);
  assert.equal(/callerResultFeedback\.submit\(/.test(server), false);
  assert.equal(server.includes("callerResultFeedback.submitMcp"), true);
  assert.equal(commerce.includes("decoratePaidResponse"), true);
  const mount = await readFile(new URL("../src/mount.mjs", import.meta.url), "utf8");
  assert.equal(mount.includes("5000"), false);
  assert.equal(mount.includes("payTo"), false);
});
