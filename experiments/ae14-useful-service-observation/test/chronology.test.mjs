import assert from "node:assert/strict";
import test from "node:test";

import { HISTORICAL_V1_REQUIRED_KEYS, isHistoricalV1PaidSuccess } from "../../../http-delivery-evidence/historical.mjs";
import { loadObservationInputs, observeLoaded, reportLoaded } from "../src/observe.mjs";
import {
  observationFor,
  observedPair,
  removeDir,
  secret,
  submit,
  tempDir,
  tokenFor,
  writeCaptures,
} from "./helpers.mjs";

function stamped(start, finish, overrides = {}) {
  const pair = observedPair(overrides);
  pair.paid.requestStartedAt = start;
  pair.paid.responseFinishedAt = finish;
  assert.equal(HISTORICAL_V1_REQUIRED_KEYS.every((key) => Object.hasOwn(pair.paid, key)), true);
  assert.equal(isHistoricalV1PaidSuccess(pair.paid), true);
  return pair;
}

async function linked(dir, key, prior, later, relation = "distinct_later_task") {
  const observation = observationFor(dir, key);
  const priorToken = tokenFor(prior, key);
  const priorTask = "task-a";
  const laterTask = relation === "same_task" ? "task-a" : "task-b";
  const opened = await submit(observation, priorToken, {
    disposition: "useful",
    retainedUse: "retained",
    nextTask: { relation: "distinct_later_task", taskRef: priorTask },
  });
  assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
  const bound = await submit(observation, tokenFor(later, key), {
    disposition: "useful",
    retainedUse: "retained",
    nextTask: { relation, taskRef: laterTask },
    priorBinding: { paidEvidenceId: prior.paid.id, taskRef: priorTask },
  }, { priorCapability: priorToken });
  assert.equal(bound.statusCode, 200, JSON.stringify(bound.body));
  return observation;
}

test("D1 reversed chronology is not a distinct later-task purchase", async () => {
  const dir = await tempDir();
  const key = secret();
  const prior = stamped("2026-09-10T00:00:02.000Z", "2026-09-10T00:00:03.000Z");
  const later = stamped("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:01.000Z");
  await writeCaptures(dir, [prior, later]);
  try {
    const observation = await linked(dir, key, prior, later);
    const view = await observation.observe(prior.paid.id);
    assert.equal(view.observedRepeat.class, "unknown");
    assert.equal(view.observedRepeat.countsAsRepeatPurchase, false);
    assert.equal(view.observedRepeat.reason, "chronology_not_after");
    assert.notEqual(view.observedRepeat.reason, "no_repeat");
  } finally {
    await removeDir(dir);
  }
});

test("D1 equal chronology is not a distinct later-task purchase", async () => {
  const dir = await tempDir();
  const key = secret();
  const prior = stamped("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:01.000Z");
  const later = stamped("2026-09-10T00:00:01.000Z", "2026-09-10T00:00:02.000Z");
  await writeCaptures(dir, [prior, later]);
  try {
    const observation = await linked(dir, key, prior, later);
    const view = await observation.observe(prior.paid.id);
    assert.equal(view.observedRepeat.reason, "chronology_not_after");
    assert.equal(view.observedRepeat.countsAsRepeatPurchase, false);
    assert.notEqual(view.observedRepeat.class, "distinct_later_task_purchase");
  } finally {
    await removeDir(dir);
  }
});

test("D1 missing or malformed time stays chronology_unproven", async () => {
  const dir = await tempDir();
  const key = secret();
  const prior = stamped("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:01.000Z");
  const missing = observedPair();
  delete missing.paid.requestStartedAt;
  const malformed = observedPair();
  malformed.paid.requestStartedAt = "not-a-time";
  assert.equal(isHistoricalV1PaidSuccess(missing.paid), false);
  assert.equal(isHistoricalV1PaidSuccess(malformed.paid), false);
  await writeCaptures(dir, [prior, missing, malformed]);
  try {
    const loaded = await loadObservationInputs(dir);
    const handback = (later) => ({
      kind: "handback",
      tenant: "serving",
      paidEvidenceId: later.paid.id,
      priorBinding: { paidEvidenceId: prior.paid.id, taskRef: "task-a" },
      nextTask: { relation: "distinct_later_task", taskRef: "task-b" },
    });
    for (const later of [missing, malformed]) {
      const view = observeLoaded({
        ...loaded,
        paidEvidenceId: prior.paid.id,
        tenant: "serving",
        feedbackDeclarations: [],
        extensionRows: [handback(later)],
      });
      assert.equal(view.observedRepeat.class, "unknown");
      assert.equal(view.observedRepeat.reason, "chronology_unproven");
      assert.equal(view.observedRepeat.countsAsRepeatPurchase, false);
      const continuation = observeLoaded({
        ...loaded,
        paidEvidenceId: prior.paid.id,
        tenant: "serving",
        feedbackDeclarations: [],
        extensionRows: [{
          kind: "continuation",
          tenant: "serving",
          priorPaidEvidenceId: prior.paid.id,
          laterPaidEvidenceId: later.paid.id,
          access: "purchased",
          taskRef: "task-b",
          priorTaskRef: "task-a",
          synthetic: true,
        }],
      });
      assert.equal(continuation.observedRepeat.reason, "chronology_unproven");
      assert.notEqual(continuation.observedRepeat.class, "distinct_later_task_purchase");
    }
  } finally {
    await removeDir(dir);
  }
});

test("D1 duplicate and case-differing settlements are not distinct purchases", async () => {
  const dir = await tempDir();
  const key = secret();
  const prior = stamped("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:01.000Z");
  const same = stamped("2026-09-10T00:00:02.000Z", "2026-09-10T00:00:03.000Z", {
    settlement: prior.paid.settlementReference,
  });
  const cased = stamped("2026-09-10T00:00:04.000Z", "2026-09-10T00:00:05.000Z");
  const casedSettlement = `0x${prior.paid.settlementReference.slice(2).toUpperCase()}`;
  cased.paid.settlementReference = casedSettlement;
  cased.validation.settlementReference = casedSettlement;
  assert.equal(isHistoricalV1PaidSuccess(cased.paid), true);
  await writeCaptures(dir, [prior, same, cased]);
  try {
    const observation = observationFor(dir, key);
    for (const later of [same, cased]) {
      const recorded = await observation.recordObservedContinuation({
        priorPaidEvidenceId: prior.paid.id,
        laterPaidEvidenceId: later.paid.id,
        access: "purchased",
        taskRef: "task-b",
        priorTaskRef: "task-a",
        actorContinuity: "none",
        synthetic: true,
      });
      assert.equal(recorded.statusCode, 200, JSON.stringify(recorded.body));
    }
    const view = await observation.observe(prior.paid.id);
    assert.equal(view.observedRepeat.reason, "settlement_effect_ambiguous");
    assert.equal(view.observedRepeat.countsAsRepeatPurchase, false);
    assert.notEqual(view.observedRepeat.class, "distinct_later_task_purchase");
  } finally {
    await removeDir(dir);
  }
});

test("D1 positive control counts only a strictly later distinct settlement", async () => {
  const dir = await tempDir();
  const key = secret();
  const prior = stamped("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:01.000Z");
  const later = stamped("2026-09-10T00:00:01.001Z", "2026-09-10T00:00:02.000Z");
  await writeCaptures(dir, [prior, later]);
  try {
    const observation = await linked(dir, key, prior, later);
    const continued = await observation.recordObservedContinuation({
      priorPaidEvidenceId: prior.paid.id,
      laterPaidEvidenceId: later.paid.id,
      access: "purchased",
      taskRef: "task-b",
      priorTaskRef: "task-a",
      actorContinuity: "none",
      synthetic: true,
    });
    assert.equal(continued.statusCode, 200, JSON.stringify(continued.body));
    const view = await observation.observe(prior.paid.id);
    assert.equal(view.observedRepeat.class, "distinct_later_task_purchase");
    assert.equal(view.observedRepeat.countsAsRepeatPurchase, true);
    assert.equal(view.observedRepeat.reason, "distinct_task_and_later_settlement");
  } finally {
    await removeDir(dir);
  }
});

test("D1 same-task retry with unproven time stays unknown", async () => {
  const dir = await tempDir();
  const prior = stamped("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:01.000Z");
  const later = observedPair({ requestDigest: prior.paid.requestDigest });
  delete later.paid.responseFinishedAt;
  assert.equal(isHistoricalV1PaidSuccess(later.paid), false);
  await writeCaptures(dir, [prior, later]);
  try {
    const loaded = await loadObservationInputs(dir);
    const view = observeLoaded({
      ...loaded,
      paidEvidenceId: prior.paid.id,
      tenant: "serving",
      feedbackDeclarations: [],
      extensionRows: [{
        kind: "continuation",
        tenant: "serving",
        priorPaidEvidenceId: prior.paid.id,
        laterPaidEvidenceId: later.paid.id,
        access: "purchased",
        taskRef: "task-a",
        priorTaskRef: "task-a",
        synthetic: true,
      }],
    });
    assert.equal(view.observedRepeat.class, "unknown");
    assert.equal(view.observedRepeat.reason, "chronology_unproven");
    assert.notEqual(view.observedRepeat.class, "same_task_retry");
    assert.equal(view.observedRepeat.countsAsRepeatPurchase, false);
  } finally {
    await removeDir(dir);
  }
});

test("D1 unproven chronology increases repeatUnknown and not purchases", async () => {
  const dir = await tempDir();
  const prior = stamped("2026-09-10T00:00:02.000Z", "2026-09-10T00:00:03.000Z");
  const earlier = stamped("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:01.000Z");
  const equal = stamped("2026-09-10T00:00:03.000Z", "2026-09-10T00:00:04.000Z");
  const shared = stamped("2026-09-10T00:00:05.000Z", "2026-09-10T00:00:06.000Z", {
    settlement: prior.paid.settlementReference,
  });
  await writeCaptures(dir, [prior, earlier, equal, shared]);
  try {
    const loaded = await loadObservationInputs(dir);
    const extensionRows = [
      {
        kind: "handback",
        tenant: "serving",
        paidEvidenceId: earlier.paid.id,
        priorBinding: { paidEvidenceId: prior.paid.id, taskRef: "task-a" },
        nextTask: { relation: "distinct_later_task", taskRef: "task-b" },
      },
      {
        kind: "continuation",
        tenant: "serving",
        priorPaidEvidenceId: prior.paid.id,
        laterPaidEvidenceId: equal.paid.id,
        access: "purchased",
        taskRef: "task-c",
        priorTaskRef: "task-a",
        synthetic: true,
      },
      {
        kind: "continuation",
        tenant: "serving",
        priorPaidEvidenceId: prior.paid.id,
        laterPaidEvidenceId: shared.paid.id,
        access: "purchased",
        taskRef: "task-d",
        priorTaskRef: "task-a",
        synthetic: true,
      },
    ];
    const report = reportLoaded({
      ...loaded,
      tenant: "serving",
      feedbackDeclarations: [],
      extensionRows,
    });
    assert.equal(report.tally.observedDistinctLaterTaskPurchases, 0);
    assert.ok(report.tally.repeatUnknown >= 1);
    const priorRow = report.observations.find((row) => row.paidEvidenceId === prior.paid.id);
    assert.equal(priorRow.observedRepeat.countsAsRepeatPurchase, false);
    assert.notEqual(priorRow.observedRepeat.class, "distinct_later_task_purchase");
  } finally {
    await removeDir(dir);
  }
});
