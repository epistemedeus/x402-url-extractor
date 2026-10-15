import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import test from "node:test";

import { OBSERVATION_SCHEMA } from "../src/contract.mjs";
import { observationPath, readObservationFile } from "../src/journal.mjs";
import { loadObservationInputs, observeLoaded, reportLoaded } from "../src/observe.mjs";
import { observationFor, observedPair, removeDir, secret, submit, tempDir, tokenFor, writeCaptures } from "./helpers.mjs";

// Root t207u: an operator fact qualifies only when exactly one canonical paid capture matches its subject.
// Absent, duplicate, or mismatched captures stay unknown: not positive, not negative, not a conflict,
// and not visible to another tenant.
const SUBJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SUBJECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fact(name, value, extra) {
  return { kind: "observed_fact", fact: name, value, evidence: "observed", synthetic: false, ...extra };
}

function scopedFacts(subject) {
  return [
    fact("outside_useful_answer", true, { tenant: "serving", recordId: "fact-out", sourcePaidEvidenceIds: [subject] }),
    fact("e08_useful_work", false, { tenant: "serving", recordId: "fact-e08", sourcePaidEvidenceIds: [subject] }),
    fact("h_join", { ran: true, status: "joined" }, { tenant: "serving", recordId: "fact-h", sourcePaidEvidenceIds: [subject] }),
  ];
}

async function writeFacts(dir, rows) {
  const text = rows.map((row) => JSON.stringify({ schemaVersion: OBSERVATION_SCHEMA, ...row })).join("\n");
  await appendFile(observationPath(dir), `${text}\n`);
}

function assertUnknown(out, label) {
  assert.equal(out.outsideUsefulAnswerArrived.value, "unknown", `${label}: outside`);
  assert.notEqual(out.outsideUsefulAnswerArrived.reason, "qualification_conflict", `${label}: outside conflict`);
  assert.deepEqual(out.outsideUsefulAnswerArrived.sources, [], `${label}: outside sources`);
  assert.equal(out.e08UsefulWork.value, "unknown", `${label}: e08`);
  assert.notEqual(out.e08UsefulWork.reason, "e08_useful_work_qualified_negative", `${label}: e08 negative`);
  assert.notEqual(out.e08UsefulWork.reason, "qualification_conflict", `${label}: e08 conflict`);
  assert.deepEqual(out.e08UsefulWork.sources, [], `${label}: e08 sources`);
  assert.equal(out.hJoin.value, "unknown", `${label}: hJoin`);
  assert.equal(out.hJoin.ran, "unknown", `${label}: hJoin.ran`);
  assert.notEqual(out.hJoin.reason, "qualification_conflict", `${label}: hJoin conflict`);
  assert.deepEqual(out.hJoin.sources, [], `${label}: hJoin sources`);
}

function assertQualified(out, label) {
  assert.equal(out.outsideUsefulAnswerArrived.value, true, `${label}: positive`);
  assert.equal(out.outsideUsefulAnswerArrived.reason, "outside_useful_answer_qualified", `${label}: positive reason`);
  assert.deepEqual(out.outsideUsefulAnswerArrived.sources, ["fact-out"], `${label}: positive source`);
  assert.equal(out.e08UsefulWork.value, false, `${label}: negative`);
  assert.equal(out.e08UsefulWork.reason, "e08_useful_work_qualified_negative", `${label}: negative reason`);
  assert.deepEqual(out.e08UsefulWork.sources, ["fact-e08"], `${label}: negative source`);
  assert.equal(out.hJoin.ran, true, `${label}: hJoin`);
  assert.equal(out.hJoin.reason, "h_result_present", `${label}: hJoin reason`);
  assert.deepEqual(out.hJoin.sources, ["fact-h"], `${label}: hJoin source`);
}

async function loadedAndCold(dir, subject) {
  const loaded = await loadObservationInputs(dir);
  const extension = await readObservationFile(dir);
  const input = { ...loaded, tenant: "serving", feedbackDeclarations: [], extensionRows: extension.rows };
  const key = secret();
  const serving = observationFor(dir, key, { tenant: "serving" });
  const other = observationFor(dir, key, { tenant: "other" });
  return {
    loadedResult: observeLoaded({ ...input, paidEvidenceId: subject }),
    loadedReport: reportLoaded(input),
    coldResult: await serving.observe(subject),
    coldReport: await serving.report(),
    otherResult: await other.observe(subject),
    otherReport: await other.report(),
    otherLoaded: reportLoaded({ ...input, tenant: "other" }),
  };
}

test("a absent canonical capture stays unknown on the loaded and cold paths", async () => {
  const dir = await tempDir();
  try {
    await writeFacts(dir, scopedFacts(SUBJECT));
    const view = await loadedAndCold(dir, SUBJECT);
    for (const [label, out] of [
      ["loaded result", view.loadedResult],
      ["loaded report", view.loadedReport],
      ["cold result", view.coldResult],
      ["cold report", view.coldReport],
      ["other result", view.otherResult],
      ["other report", view.otherReport],
      ["other loaded", view.otherLoaded],
    ]) assertUnknown(out, label);
  } finally {
    await removeDir(dir);
  }
});

test("b duplicate canonical capture stays unknown on the loaded and cold paths", async () => {
  const dir = await tempDir();
  try {
    const first = observedPair({ id: SUBJECT });
    const second = observedPair({ id: SUBJECT });
    await writeCaptures(dir, [first, second]);
    await writeFacts(dir, scopedFacts(SUBJECT));
    const view = await loadedAndCold(dir, SUBJECT);
    assert.equal(view.loadedResult.delivered.reason, "duplicate_capture");
    for (const [label, out] of [
      ["loaded result", view.loadedResult],
      ["loaded report", view.loadedReport],
      ["cold result", view.coldResult],
      ["cold report", view.coldReport],
      ["other result", view.otherResult],
      ["other report", view.otherReport],
      ["other loaded", view.otherLoaded],
    ]) assertUnknown(out, label);
    const inner = view.loadedReport.observations.find((row) => row.paidEvidenceId === SUBJECT);
    assertUnknown(inner, "loaded observation");
  } finally {
    await removeDir(dir);
  }
});

test("c mismatched canonical capture stays unknown on the loaded and cold paths", async () => {
  const dir = await tempDir();
  try {
    const real = observedPair({ id: OTHER_SUBJECT });
    await writeCaptures(dir, [real]);
    await writeFacts(dir, scopedFacts(SUBJECT));
    const view = await loadedAndCold(dir, SUBJECT);
    for (const [label, out] of [
      ["named loaded result", view.loadedResult],
      ["named loaded report", view.loadedReport],
      ["named cold result", view.coldResult],
      ["named cold report", view.coldReport],
      ["other result", view.otherResult],
      ["other report", view.otherReport],
      ["other loaded", view.otherLoaded],
    ]) assertUnknown(out, label);
    const loaded = await loadObservationInputs(dir);
    const extension = await readObservationFile(dir);
    const realLoaded = observeLoaded({
      ...loaded,
      tenant: "serving",
      feedbackDeclarations: [],
      extensionRows: extension.rows,
      paidEvidenceId: OTHER_SUBJECT,
    });
    assertUnknown(realLoaded, "real capture loaded");
    const realCold = await observationFor(dir, secret(), { tenant: "serving" }).observe(OTHER_SUBJECT);
    assertUnknown(realCold, "real capture cold");
  } finally {
    await removeDir(dir);
  }
});

test("d a unique matching capture still qualifies positive and negative facts", async () => {
  const dir = await tempDir();
  try {
    const pair = observedPair({ id: SUBJECT });
    const untouched = observedPair({ id: OTHER_SUBJECT });
    await writeCaptures(dir, [pair, untouched]);
    await writeFacts(dir, scopedFacts(SUBJECT));
    const view = await loadedAndCold(dir, SUBJECT);
    for (const [label, out] of [
      ["loaded result", view.loadedResult],
      ["loaded report", view.loadedReport],
      ["cold result", view.coldResult],
      ["cold report", view.coldReport],
    ]) assertQualified(out, label);
    assertUnknown(view.otherResult, "other result");
    assertUnknown(view.otherReport, "other report");
    assertUnknown(view.otherLoaded, "other loaded");
    const untouchedCold = await observationFor(dir, secret(), { tenant: "serving" }).observe(OTHER_SUBJECT);
    assertUnknown(untouchedCold, "untouched capture");
  } finally {
    await removeDir(dir);
  }
});

test("e a global H fact stays in operator scope and does not qualify a tenant or result", async () => {
  const dir = await tempDir();
  try {
    await writeCaptures(dir, [observedPair({ id: SUBJECT })]);
    await writeFacts(dir, [
      fact("h_join", { ran: true, status: "joined" }, {
        scope: "global",
        recordId: "fact-h-global",
        sourcePaidEvidenceIds: [SUBJECT],
      }),
    ]);
    const view = await loadedAndCold(dir, SUBJECT);
    for (const [label, out] of [
      ["loaded result", view.loadedResult],
      ["loaded report", view.loadedReport],
      ["cold result", view.coldResult],
      ["cold report", view.coldReport],
      ["other result", view.otherResult],
      ["other report", view.otherReport],
    ]) assertUnknown(out, label);
    assert.equal(view.loadedReport.operatorScope.qualifiesTenantOrResult, false);
    assert.equal(view.loadedReport.operatorScope.hJoin.ran, true);
    assert.deepEqual(view.loadedReport.operatorScope.hJoin.sources, ["fact-h-global"]);
    assert.equal(view.coldReport.operatorScope.qualifiesTenantOrResult, false);
    assert.equal(view.coldReport.operatorScope.hJoin.ran, true);
    assert.equal(view.otherReport.operatorScope.hJoin.ran, true);
    assert.equal(view.otherReport.hJoin.ran, "unknown");
  } finally {
    await removeDir(dir);
  }
});

test("public extension still cannot submit observed_fact when a unique capture exists", async () => {
  const dir = await tempDir();
  const key = secret();
  try {
    const pair = observedPair({ id: SUBJECT });
    await writeCaptures(dir, [pair]);
    const observation = observationFor(dir, key);
    const refused = await submit(observation, tokenFor(pair, key), {
      disposition: "useful",
      kind: "observed_fact",
      fact: "outside_useful_answer",
      value: true,
      evidence: "observed",
      recordId: "fact-out",
      tenant: "serving",
      sourcePaidEvidenceIds: [SUBJECT],
    });
    assert.equal(refused.statusCode, 400);
    assert.equal(refused.body.code, "unbounded_field");
    assert.equal(refused.body.accepted, false);
    const report = await observation.report();
    assertUnknown(report, "after refused submit");
  } finally {
    await removeDir(dir);
  }
});
