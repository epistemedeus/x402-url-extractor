import assert from "node:assert/strict";
import test from "node:test";

import { loadObservationInputs, reportLoaded } from "../src/observe.mjs";
import { observationFor, observedPair, removeDir, secret, tempDir, writeCaptures } from "./helpers.mjs";

test("D4 a later qualified fact is reported and absence or a gap stays unknown", async () => {
  const dir = await tempDir();
  const key = secret();
  const pair = observedPair();
  await writeCaptures(dir, [pair]);
  try {
    const observation = observationFor(dir, key);
    const absent = await observation.report();
    assert.equal(absent.outsideUsefulAnswerArrived.value, "unknown");
    assert.notEqual(absent.outsideUsefulAnswerArrived.value, false);
    assert.equal(absent.outsideCustomerCount, null);
    assert.equal(absent.e08UsefulWork.value, "unknown");
    assert.equal(absent.hJoin.ran, "unknown");
    assert.equal(absent.hJoin.ran === false, false);

    const loaded = await loadObservationInputs(dir);
    const qualified = reportLoaded({
      ...loaded,
      tenant: "serving",
      feedbackDeclarations: [],
      extensionRows: [{
        kind: "observed_fact",
        tenant: "serving",
        fact: "outside_useful_answer",
        value: true,
        evidence: "observed",
        synthetic: false,
        recordId: "fact-outside-1",
        sourcePaidEvidenceIds: [pair.paid.id],
      }, {
        kind: "observed_fact",
        tenant: "serving",
        fact: "e08_useful_work",
        value: false,
        evidence: "observed",
        synthetic: false,
        recordId: "fact-e08-1",
        sourcePaidEvidenceIds: [pair.paid.id],
      }, {
        kind: "observed_fact",
        tenant: "serving",
        fact: "h_join",
        value: { ran: true, status: "joined" },
        evidence: "observed",
        synthetic: false,
        recordId: "fact-h-1",
        sourcePaidEvidenceIds: [pair.paid.id],
      }],
    });
    assert.equal(qualified.outsideUsefulAnswerArrived.value, true);
    assert.equal(qualified.outsideUsefulAnswerArrived.reason, "outside_useful_answer_qualified");
    assert.equal(qualified.outsideUsefulAnswerArrived.sources.includes("fact-outside-1"), true);
    assert.equal(qualified.e08UsefulWork.value, false);
    assert.equal(qualified.e08UsefulWork.reason, "e08_useful_work_qualified_negative");
    assert.equal(qualified.hJoin.ran, true);
    assert.equal(qualified.hJoin.reason, "h_result_present");
    assert.equal(qualified.outsideCustomerCount, null);

    const labeled = reportLoaded({
      ...loaded,
      tenant: "serving",
      feedbackDeclarations: [],
      extensionRows: [{
        kind: "handback",
        tenant: "serving",
        paidEvidenceId: pair.paid.id,
        originLabel: "external_unknown",
        disposition: "useful",
      }],
    });
    assert.equal(labeled.outsideUsefulAnswerArrived.value, "unknown");
    assert.equal(labeled.outsideUsefulAnswerArrived.reason, "label_is_not_outsider");
    assert.equal(labeled.outsideCustomerCount, null);

    const gap = reportLoaded({
      ...loaded,
      tenant: "serving",
      windowCoverage: "gap",
      feedbackDeclarations: [],
      extensionRows: [{
        kind: "observed_fact",
        tenant: "serving",
        fact: "outside_useful_answer",
        value: true,
        evidence: "observed",
        synthetic: false,
        recordId: "fact-outside-gap",
        sourcePaidEvidenceIds: [pair.paid.id],
      }],
    });
    assert.equal(gap.outsideUsefulAnswerArrived.value, "unknown");
    assert.equal(gap.outsideUsefulAnswerArrived.reason, "coverage_gap");
    assert.equal(gap.e08UsefulWork.value, "unknown");
    assert.equal(gap.hJoin.ran, "unknown");
    assert.equal(gap.rates, null);
    assert.equal(gap.outsideCustomerCount, null);
  } finally {
    await removeDir(dir);
  }
});
