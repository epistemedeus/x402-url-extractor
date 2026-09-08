import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import test from "node:test";
import { comparePageBatches } from "../src/page-change/compare.mjs";
import { SCHEMA } from "../src/page-change/constants.mjs";
import { inspectMerchantArtifact } from "../src/page-change/schema-contract.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const fx = (...parts) => join(root, "..", "fixtures", "page-change", ...parts);
const example = (...parts) => join(root, "..", "fixtures", "page-change", "customer-job", ...parts);

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("customer RFQ job reports exact title change, failed/missing rows, and coverage unknowns", async () => {
  const before = loadJson(example("before.json"));
  const after = loadJson(example("after.json"));
  assert.equal(inspectMerchantArtifact(before).ok, true, inspectMerchantArtifact(before).errors.join(","));
  assert.equal(inspectMerchantArtifact(after).ok, true, inspectMerchantArtifact(after).errors.join(","));

  const report = await comparePageBatches(example("before.json"), example("after.json"), {
    fields: ["title", "description", "headings"],
    clock: "2026-09-08T12:00:00.000Z",
    limits: { maxStaleMs: 86_400_000 },
  });
  assert.equal(report.schema, SCHEMA);
  assert.equal(report.kind, "merchant_extract_batch");
  assert.equal(report.verdict, "changed");
  assert.equal(report.claims.fresh, false);
  assert.equal(report.claims.paymentImpliesUsefulOutput, false);
  assert.equal(report.claims.usefulOutputProven, true);
  assert.equal(report.claims.noChangeProven, false);
  assert.ok(report.changes.some((change) => change.class === "semantic" && String(change.path).includes("title")));
  assert.ok(report.changes.some((change) => change.sourceKey === "https://rfq.example/widgets/" || change.sourceKey === "https://rfq.example/widgets"));
  assert.ok(report.rows.failed.some((row) => row.sourceKey.includes("fasteners")));
  assert.ok(report.rows.unknown.some((row) => row.sourceKey.includes("vendor-beta")) || report.rows.missing.some((row) => row.sourceKey.includes("vendor-beta")));
  assert.ok(report.coverageUnknown.some((item) => item.field === "description" && String(item.sourceKey).includes("vendor-alpha")));
  assert.equal(before.charged, true);
  assert.equal(after.charged, true);
  assert.equal(after.ok, false);
});

test("reordered URLs with equal selected fields are order, not content change", async () => {
  const report = await comparePageBatches(fx("merchant", "unchanged-before.json"), fx("merchant", "reordered-after.json"), {
    fields: ["title", "description"],
  });
  assert.equal(report.verdict, "reordered");
  assert.equal(report.claims.noChangeProven, false);
  assert.equal(report.claims.contentUnchangedProven, true);
  assert.equal(report.summary.semantic, 0);
  assert.ok(report.changes.every((change) => change.class === "order"));
});

test("identical selected fields with later fetchedAt stay unchanged and not fresh", async () => {
  const report = await comparePageBatches(fx("merchant", "unchanged-before.json"), fx("merchant", "unchanged-after.json"), {
    fields: ["title", "description"],
    clock: "2026-09-08T12:00:00.000Z",
    limits: { maxStaleMs: 86_400_000 },
    allowFreshClaim: true,
  });
  assert.equal(report.verdict, "unchanged");
  assert.equal(report.claims.noChangeProven, true);
  assert.equal(report.claims.fresh, false);
  assert.equal(report.freshness, "unknown");
  assert.ok(report.observations.after.rows.some((row) => row.fetchedAt));
});

test("C1 artifacts match fixture sources independently of item id and order", async () => {
  const report = await comparePageBatches(fx("c1", "before.json"), fx("c1", "after.json"), {
    fields: ["title", "description"],
  });
  assert.equal(report.kind, "c1_batch_result");
  assert.equal(report.verdict, "changed");
  assert.ok(report.changes.some((change) => change.class === "semantic" && String(change.path).includes("title")));
  assert.equal(report.summary.duplicates, 0);
});

test("duplicate active URLs are ambiguous, not silently merged", async () => {
  const report = await comparePageBatches(fx("merchant", "duplicate-active.json"), fx("merchant", "duplicate-active.json"), {
    fields: ["title"],
  });
  assert.equal(report.verdict, "ambiguous");
  assert.equal(report.claims.noChangeProven, false);
  assert.ok(report.rows.duplicates.length);
});

test("merchant and C1 artifacts are incomparable kinds", async () => {
  const report = await comparePageBatches(fx("merchant", "unchanged-before.json"), fx("c1", "after.json"), {
    fields: ["title"],
  });
  assert.equal(report.verdict, "incomparable");
  assert.equal(report.claims.noChangeProven, false);
});

test("source ceiling cannot silently drop extra rows as unchanged", async () => {
  const before = loadJson(fx("merchant", "unchanged-before.json"));
  const report = await comparePageBatches(
    { mediaType: "application/json", body: before },
    { mediaType: "application/json", body: before },
    { fields: ["title"], limits: { maxSources: 1 } },
  );
  assert.equal(report.verdict, "incomplete");
  assert.equal(report.claims.noChangeProven, false);
});

test("field selection ignores unselected title edits", async () => {
  const before = {
    mediaType: "application/json",
    body: loadJson(fx("merchant", "unchanged-before.json")),
  };
  const afterBody = loadJson(fx("merchant", "unchanged-after.json"));
  afterBody.sources[0].data.title = "changed title";
  const report = await comparePageBatches(before, { mediaType: "application/json", body: afterBody }, {
    fields: ["description"],
  });
  assert.equal(report.verdict, "unchanged");
  assert.equal(report.summary.semantic, 0);
});
