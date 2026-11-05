import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ownedPageChangeWorkerCount } from "../../page-change-http.mjs";
import {
  evaluate,
  loadCapture,
  publicScore,
  readCaptureIndex,
} from "./decide.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (name) => JSON.parse(readFileSync(path.join(here, name), "utf8"));

test("saved captures match the recorded blob and sha256 or the case is refused", () => {
  const entries = readCaptureIndex();
  assert.equal(entries.length, 6);
  const absent = entries.filter((entry) => entry.path.endsWith("query-key-1.1.0.json") && entry.commit.startsWith("39b05e2f"));
  assert.equal(absent.length, 1);
  assert.equal(absent[0].present, false);
  assert.equal(loadCapture(absent[0]).reason, "absent");
  for (const entry of entries) {
    if (!entry.present) continue;
    const loaded = loadCapture(entry);
    assert.equal(loaded.ok, true, entry.commit);
    assert.equal(loaded.sha256, entry.sha256);
    assert.equal(loaded.blob, entry.blob);
  }
  const present = entries.find((entry) => entry.present);
  const mismatched = loadCapture({ ...present, sha256: "0".repeat(64) });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.refused, true);
  assert.equal(mismatched.reason, "capture-sha256-mismatch");
});

test("recheck or reuse matches git history and emits the produced decision", { timeout: 60_000 }, async () => {
  const result = await evaluate();
  try {
    assert.equal(result.cases.unchanged.decision, "reuse");
    assert.equal(result.cases.unchanged.freshness, "unknown");
    assert.deepEqual(result.cases.unchanged.changedFields, []);
    assert.equal(result.cases.changed.decision, "recheck");
    assert.equal(result.cases.changed.verdict, "changed");
    assert.equal(result.cases.changed.changedFields.length > 0, true);
    assert.equal(result.cases.stale.decision, "recheck");
    assert.equal(result.cases.stale.freshness, "inverted");
    assert.equal(result.cases.stale.verdict, "unchanged");
    assert.deepEqual(result.cases.stale.changedFields, []);
    assert.equal(result.cases.malformed.decision, "missing-input");
    assert.equal(result.cases.malformed.verdict, "incomparable");
    assert.equal(result.cases.mismatched.refused, true);
    assert.equal(result.cases.mismatched.compared, false);
    assert.equal(result.score.falseAlerts, 0);
    assert.equal(result.score.missedChanges, 0);
    assert.equal(result.score.unknownPairs, 2);
    assert.equal(result.score.comparablePairs, 4);
    assert.equal(result.score.use, null);
    assert.equal(result.history.filter((row) => row.contentDiff === "unknown").length, 2);
    const view = publicScore(result);
    const { produced, ...score } = view;
    assert.deepEqual(score, readJson("score.json"));
    assert.deepEqual(produced, readJson("produced-decision.json"));
    assert.equal(produced.recipeId, "source-change-alert");
    assert.equal(produced.schema, "samedaydesk.recurring-job-recipe-result.v1");
    assert.equal(produced.outcome, "unchanged");
    assert.equal(produced.decision, "reuse");
    assert.equal(produced.evidence.contentHash, "sha256:67445e443ec1e6c08f082a135d82d28df168a84c4d9078c8e89caa5310a9d6e7");
    assert.deepEqual(produced.evidence.changed, []);
    assert.equal(typeof produced.recovery.action, "string");
    assert.equal(typeof produced.recovery.operatorNext, "string");
    const packed = JSON.stringify(produced) + JSON.stringify(score);
    assert.equal(packed.includes("\u2014"), false);
    assert.equal(packed.includes("/home/"), false);
    assert.equal(packed.includes("/tmp/"), false);
  } finally {
    assert.equal(ownedPageChangeWorkerCount(), 0);
  }
});
