import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import test from "node:test";

import { OBSERVATION_SCHEMA } from "../src/contract.mjs";
import { observationPath } from "../src/journal.mjs";
import { loadObservationInputs, observeLoaded, reportLoaded } from "../src/observe.mjs";
import { observationFor, observedPair, removeDir, secret, submit, tempDir, tokenFor, writeCaptures } from "./helpers.mjs";

// Root t187u: a fact qualifies a tenant or result only with the requested tenant, a bound paid-evidence subject and a
// non-blank source recordId. Missing/cross-tenant scope stays unknown (not positive, negative or conflict) and never
// contaminates another tenant. A global H fact is operator-scope only.
const FACTS = [
  ["outside_useful_answer", true, "outsideUsefulAnswerArrived"],
  ["e08_useful_work", false, "e08UsefulWork"],
  ["h_join", { ran: true, status: "joined" }, "hJoin"],
];
const fact = (name, value, extra) => ({ kind: "observed_fact", fact: name, value, evidence: "observed", synthetic: false, ...extra });
const allFacts = (extra) => FACTS.map(([name, value]) => fact(name, value, extra));

async function withPair(fn) {
  const dir = await tempDir();
  const pair = observedPair();
  await writeCaptures(dir, [pair]);
  try { return await fn(dir, pair, await loadObservationInputs(dir)); } finally { await removeDir(dir); }
}
const views = (loaded, pair, rows, tenant = "serving") => {
  const input = { ...loaded, tenant, feedbackDeclarations: [], extensionRows: rows };
  return { result: observeLoaded({ ...input, paidEvidenceId: pair.paid.id }), report: reportLoaded(input) };
};
function assertQualified(out, label) {
  assert.equal(out.outsideUsefulAnswerArrived.value, true, `${label}: positive kept`);
  assert.equal(out.e08UsefulWork.value, false, `${label}: negative kept`);
  assert.equal(out.e08UsefulWork.reason, "e08_useful_work_qualified_negative", `${label}: negative reason`);
  assert.equal(out.hJoin.ran, true, `${label}: hJoin`);
}
function assertUnknown(out, label) {
  for (const [name, , key] of FACTS) {
    assert.equal(out[key].value, "unknown", `${label}: ${name} must stay unknown, got ${JSON.stringify(out[key])}`);
    assert.notEqual(out[key].reason, "qualification_conflict", `${label}: ${name} is not a conflict`);
  }
  assert.equal(out.hJoin.ran, "unknown", `${label}: hJoin.ran`);
}

test("matching scope (tenant + paid subject + recordId) qualifies result and tenant report, positives and negatives", () => withPair((dir, pair, loaded) => {
  const v = views(loaded, pair, allFacts({ tenant: "serving", recordId: "fact-1", sourcePaidEvidenceIds: [pair.paid.id] }));
  assertQualified(v.result, "result"); assertQualified(v.report, "report");
  assert.deepEqual(v.report.outsideUsefulAnswerArrived.sources, ["fact-1"]);
}));

for (const [label, extra] of [
  ["recordId absent", { tenant: "serving" }], ["recordId empty", { tenant: "serving", recordId: "" }],
  ["recordId whitespace", { tenant: "serving", recordId: "   " }], ["recordId non-string", { tenant: "serving", recordId: 42 }],
  ["recordId null", { tenant: "serving", recordId: null }],
  ["tenant missing", { recordId: "fact-1" }], ["tenant blank", { tenant: " ", recordId: "fact-1" }],
  ["cross tenant", { tenant: "other", recordId: "fact-1" }],
]) {
  test(`missing scope: ${label} stays unknown for result and tenant report`, () => withPair((dir, pair, loaded) => {
    const v = views(loaded, pair, allFacts({ ...extra, sourcePaidEvidenceIds: [pair.paid.id] }));
    assertUnknown(v.result, `${label} result`); assertUnknown(v.report, `${label} report`);
  }));
}

for (const [label, ids] of [["missing", undefined], ["other paid id", ["paid-other"]], ["non-array", "x"], ["blank ids", [" "]]]) {
  test(`paid binding ${label} stays unknown`, () => withPair((dir, pair, loaded) => {
    const v = views(loaded, pair, allFacts({ tenant: "serving", recordId: "fact-1", ...(ids === undefined ? {} : { sourcePaidEvidenceIds: ids }) }));
    assertUnknown(v.result, `${label} result`); assertUnknown(v.report, `${label} report`);
  }));
}

test("mixed tenant: another tenant's opposite fact neither qualifies nor conflicts; each tenant sees only its own", () => withPair((dir, pair, loaded) => {
  const rows = [
    ...allFacts({ tenant: "serving", recordId: "fact-s", sourcePaidEvidenceIds: [pair.paid.id] }),
    fact("outside_useful_answer", false, { tenant: "other", recordId: "fact-o", sourcePaidEvidenceIds: [pair.paid.id] }),
    fact("h_join", { ran: false, status: "x" }, { tenant: "other", recordId: "fact-oh", sourcePaidEvidenceIds: [pair.paid.id] }),
  ];
  const serving = views(loaded, pair, rows, "serving");
  assertQualified(serving.result, "serving result"); assertQualified(serving.report, "serving report");
  assert.deepEqual(serving.result.outsideUsefulAnswerArrived.sources, ["fact-s"]);
  const other = views(loaded, pair, rows, "other");
  assert.equal(other.result.outsideUsefulAnswerArrived.value, false); assert.equal(other.result.hJoin.ran, false);
  assert.equal(other.result.e08UsefulWork.value, "unknown");
  const third = views(loaded, pair, rows, "third");
  assertUnknown(third.result, "third result"); assertUnknown(third.report, "third report");
}));

test("conflict inside one scope stays a conflict; cross-tenant rows do not create one", () => withPair((dir, pair, loaded) => {
  const base = { recordId: "fact-a", sourcePaidEvidenceIds: [pair.paid.id] };
  const rows = [fact("outside_useful_answer", true, { ...base, tenant: "serving" }), fact("outside_useful_answer", false, { ...base, recordId: "fact-b", tenant: "serving" })];
  const v = views(loaded, pair, rows);
  assert.equal(v.result.outsideUsefulAnswerArrived.value, "unknown");
  assert.equal(v.result.outsideUsefulAnswerArrived.reason, "qualification_conflict");
  const cross = views(loaded, pair, [rows[0], { ...rows[1], tenant: "other" }]);
  assert.equal(cross.result.outsideUsefulAnswerArrived.value, true);
}));

test("global H fact stays in operator scope and never qualifies a tenant or result", () => withPair((dir, pair, loaded) => {
  const v = views(loaded, pair, [fact("h_join", { ran: true, status: "joined" }, { scope: "global", recordId: "fact-h-global", sourcePaidEvidenceIds: [pair.paid.id] })]);
  assert.equal(v.result.hJoin.ran, "unknown"); assert.equal(v.report.hJoin.ran, "unknown");
  assert.equal(v.report.operatorScope.qualifiesTenantOrResult, false);
  assert.equal(v.report.operatorScope.hJoin.ran, true);
  assert.deepEqual(v.report.operatorScope.hJoin.sources, ["fact-h-global"]);
  const tenanted = views(loaded, pair, [fact("h_join", { ran: true }, { scope: "global", tenant: "serving", recordId: "g2", sourcePaidEvidenceIds: [pair.paid.id] })]);
  assert.equal(tenanted.result.hJoin.ran, "unknown"); assert.equal(tenanted.report.operatorScope.hJoin.ran, "unknown");
}));

test("public extension cannot submit observed_fact (refused, nothing qualifies)", async () => {
  const dir = await tempDir(); const key = secret(); const pair = observedPair(); await writeCaptures(dir, [pair]);
  try {
    const observation = observationFor(dir, key);
    for (const body of [
      { disposition: "useful", kind: "observed_fact" },
      { disposition: "useful", fact: "outside_useful_answer", value: true, evidence: "observed", recordId: "x", sourcePaidEvidenceIds: [pair.paid.id] },
      { kind: "observed_fact", fact: "h_join", value: { ran: true }, evidence: "observed", recordId: "x", tenant: "serving" },
    ]) {
      const res = await submit(observation, tokenFor(pair, key), body);
      assert.equal(res.statusCode, 400, `refused: ${JSON.stringify(body)}`);
      assert.equal(res.body.code, "unbounded_field"); assert.equal(res.body.accepted, false);
    }
    const control = await submit(observation, tokenFor(pair, key), { disposition: "useful", originLabel: "external_unknown" });
    assert.equal(control.statusCode, 200);   // the same capability is otherwise valid
    const rows = (await readFile(observationPath(dir), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(rows.some((row) => row.kind === "observed_fact"), false);
    const report = await observation.report();
    assert.equal(report.outsideUsefulAnswerArrived.value, "unknown"); assert.equal(report.hJoin.ran, "unknown");
  } finally { await removeDir(dir); }
});

test("actual loaded path + restart: journal rows on disk qualify only in scope after a fresh handle", async () => {
  const dir = await tempDir(); const key = secret(); const pair = observedPair(); await writeCaptures(dir, [pair]);
  try {
    const rows = [
      ...allFacts({ tenant: "serving", recordId: "fact-disk", sourcePaidEvidenceIds: [pair.paid.id] }),
      fact("outside_useful_answer", false, { tenant: "other", recordId: "fact-disk-o", sourcePaidEvidenceIds: [pair.paid.id] }),
      fact("outside_useful_answer", true, { tenant: "serving", sourcePaidEvidenceIds: [pair.paid.id] }),
      fact("h_join", { ran: false }, { scope: "global", recordId: "fact-disk-g", sourcePaidEvidenceIds: [pair.paid.id] }),
    ].map((row) => JSON.stringify({ schemaVersion: OBSERVATION_SCHEMA, ...row })).join("\n");
    await appendFile(observationPath(dir), `${rows}\n`);
    for (let round = 0; round < 2; round += 1) {   // round 1 = restart: a new process handle on the same directory
      const serving = observationFor(dir, key);
      const report = await serving.report(); const result = await serving.observe(pair.paid.id);
      assertQualified(report, `serving report r${round}`); assertQualified(result, `serving result r${round}`);
      assert.deepEqual(report.outsideUsefulAnswerArrived.sources, ["fact-disk"]);
      assert.equal(report.operatorScope.hJoin.ran, false);
      const other = await observationFor(dir, key, { tenant: "other" }).report();
      assert.equal(other.outsideUsefulAnswerArrived.value, false); assert.equal(other.hJoin.ran, "unknown");
      assert.equal(other.e08UsefulWork.value, "unknown");
    }
  } finally { await removeDir(dir); }
});
