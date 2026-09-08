import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { comparePageBatches } from "../src/page-change/compare.mjs";

const corpus = new URL("../fixtures/page-change/w5-corpus/", import.meta.url);
const json = (url) => JSON.parse(readFileSync(url, "utf8"));
const expectedVerdicts = {
  unchanged_pages: "unchanged", changed_selected_fields: "changed",
  row_reorder: "reordered", duplicate_urls: "unchanged",
  missing_requested_field: "incomplete", failed_fetch: "incomplete",
  partial_batch: "changed", differing_requested_fields: "incomplete",
  unknown_observation_freshness: "unchanged",
};

for (const entry of json(new URL("manifest.json", corpus)).cases) {
  test(`independent W5 composition: ${entry.kind}`, async () => {
    const base = new URL(`cases/${entry.case_id}/`, corpus);
    const expected = json(new URL("expected.json", base));
    const before = json(new URL("observation-before.json", base));
    const after = json(new URL("observation-after.json", base));
    const report = await comparePageBatches(
      { mediaType: "application/json", body: before },
      { mediaType: "application/json", body: after },
      { fields: expected.buyer_owned_dependent_fields },
    );
    assert.equal(report.verdict, expectedVerdicts[entry.kind]);
    assert.equal(report.freshness, "unknown");
    assert.equal(report.claims.current, false);
    assert.equal(report.claims.fresh, false);
    const actualChanges = {};
    for (const change of report.changes.filter((change) => change.class === "semantic")) {
      const field = change.path.split("/")[1];
      (actualChanges[change.sourceKey] ??= []).push(field);
      const left = before.sources.find((row) => row.source === change.sourceKey && row.status !== "skipped_duplicate");
      const right = after.sources.find((row) => row.source === change.sourceKey && row.status !== "skipped_duplicate");
      assert.equal(change.before, left.data[field]);
      assert.equal(change.after, right.data[field]);
    }
    assert.deepEqual(actualChanges, expected.expected_observable_changed_fields_by_url);
    for (const [url, fields] of Object.entries(expected.expected_unobservable_fields_by_url)) {
      for (const field of fields) {
        assert.ok(report.coverageUnknown.some((item) => item.sourceKey === url && item.field === field)
          || report.rows.failed.some((item) => item.sourceKey === url));
      }
      assert.equal(report.claims.noChangeProven, false);
      assert.equal(report.claims.complete, false);
    }
  });
}

test("actual CLI consumes independent W5 deliveries and preserves exact change", () => {
  const entry = json(new URL("manifest.json", corpus)).cases.find((entry) => entry.kind === "changed_selected_fields");
  const base = new URL(`cases/${entry.case_id}/`, corpus);
  const result = spawnSync(process.execPath, [
    new URL("../bin/page-change.mjs", import.meta.url).pathname,
    "compare", "--before", new URL("observation-before.json", base).pathname,
    "--after", new URL("observation-after.json", base).pathname, "--fields", "title,description",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.changes[0].before, "Alpha v1");
  assert.equal(report.changes[0].after, "Alpha v2");
});
