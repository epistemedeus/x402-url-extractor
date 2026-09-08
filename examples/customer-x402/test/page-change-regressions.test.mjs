import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import test from "node:test";
import { comparePageBatches } from "../src/page-change/compare.mjs";
import { excerpt } from "../src/page-change/limits.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const fx = (...parts) => join(root, "..", "fixtures", "page-change", ...parts);
const fixture = () => JSON.parse(readFileSync(fx("merchant", "unchanged-before.json"), "utf8"));
const wrap = (body) => ({ mediaType: "application/json", body });
const compare = (before, after, options = {}) => comparePageBatches(wrap(before), wrap(after), { fields: ["title"], ...options });

test("missing after artifact cannot prove no change", async () => {
  const report = await comparePageBatches(fx("merchant", "unchanged-before.json"), fx("merchant", "does-not-exist.json"), {
    fields: ["title"],
  });
  assert.equal(report.snapshot.after.status, "missing");
  assert.equal(report.verdict, "incomparable");
  assert.equal(report.claims.noChangeProven, false);
  assert.equal(report.claims.current, false);
});

test("malformed JSON is incomparable", async () => {
  const report = await comparePageBatches(fx("merchant", "unchanged-before.json"), fx("hostile", "malformed.json"), {
    fields: ["title"],
  });
  assert.equal(report.snapshot.after.status, "invalid");
  assert.equal(report.verdict, "incomparable");
  assert.equal(report.claims.noChangeProven, false);
});

test("byte ceiling cannot masquerade as unchanged", async () => {
  const tiny = {
    mediaType: "application/json",
    body: JSON.parse(readFileSync(fx("merchant", "unchanged-before.json"), "utf8")),
  };
  const report = await comparePageBatches(tiny, tiny, {
    fields: ["title"],
    limits: { maxBytes: 200 },
  });
  assert.equal(report.verdict, "incomparable");
  assert.equal(report.claims.noChangeProven, false);
});

test("absent selected field is coverage unknown, not deletion", async () => {
  const before = JSON.parse(readFileSync(fx("merchant", "unchanged-before.json"), "utf8"));
  const after = JSON.parse(readFileSync(fx("merchant", "unchanged-after.json"), "utf8"));
  delete after.sources[0].data.description;
  const report = await comparePageBatches(
    { mediaType: "application/json", body: before },
    { mediaType: "application/json", body: after },
    { fields: ["title", "description"] },
  );
  assert.equal(report.verdict, "incomplete");
  assert.equal(report.claims.noChangeProven, false);
  assert.ok(report.coverageUnknown.some((item) => item.field === "description"));
  assert.equal(report.changes.some((change) => change.op === "remove" && String(change.path).includes("description")), false);
});

test("charged true never implies useful output when every row failed", async () => {
  const failed = JSON.parse(readFileSync(fx("merchant", "unchanged-before.json"), "utf8"));
  for (const row of failed.sources) {
    row.status = "failure";
    row.data = null;
    row.error = { code: "http_error", message: "503" };
  }
  failed.ok = false;
  failed.charged = true;
  const report = await comparePageBatches(
    { mediaType: "application/json", body: failed },
    { mediaType: "application/json", body: failed },
    { fields: ["title"] },
  );
  assert.equal(report.claims.paymentImpliesUsefulOutput, false);
  assert.equal(report.claims.usefulOutputProven, false);
  assert.equal(report.claims.noChangeProven, false);
  assert.ok(report.rows.failed.length);
});

test("unrecognized JSON cannot masquerade as an unchanged page brief", async () => {
  const before = { mediaType: "application/json", body: { hello: "world" } };
  const after = { mediaType: "application/json", body: { hello: "world" } };
  const report = await comparePageBatches(before, after, { fields: ["title"] });
  assert.equal(report.verdict, "incomparable");
  assert.equal(report.claims.noChangeProven, false);
});

test("clock without horizon never claims current; fetchedAt is not freshness", async () => {
  const report = await comparePageBatches(fx("merchant", "unchanged-before.json"), fx("merchant", "unchanged-after.json"), {
    fields: ["title"],
    clock: "2026-09-08T12:00:00.000Z",
    allowFreshClaim: true,
  });
  assert.equal(report.claims.current, false);
  assert.equal(report.claims.fresh, false);
});

test("future timestamps never claim current", async () => {
  const body = JSON.parse(readFileSync(fx("merchant", "unchanged-before.json"), "utf8"));
  const envelope = {
    mediaType: "application/json",
    observedAt: "2026-09-08T18:00:00.000Z",
    body,
  };
  const report = await comparePageBatches(envelope, envelope, {
    fields: ["title"],
    clock: "2026-09-08T12:00:00.000Z",
    limits: { maxStaleMs: 86_400_000 },
    allowFreshClaim: true,
  });
  assert.equal(report.freshness, "inverted");
  assert.equal(report.claims.current, false);
  assert.equal(report.claims.fresh, false);
});

for (const [name, mutation] of [
  ["non-object row", (body) => body.sources.push(null)],
  ["missing source identity", (body) => { body.sources.push({ ...body.sources[0], source: "" }); }],
  ["missing required row key", (body) => { delete body.sources[0].provenance; }],
]) {
  test(`${name} cannot silently disappear into unchanged`, async () => {
    const body = fixture(); mutation(body);
    const report = await compare(body, body);
    assert.equal(report.claims.noChangeProven, false);
    assert.equal(report.claims.complete, false);
    assert.ok(report.coverageUnknown.length > 0);
  });
}

test("orphan skipped-duplicate rows yield unknown coverage without crashing", async () => {
  const body = fixture();
  body.sources.forEach((row) => { row.status = "skipped_duplicate"; row.data = null; });
  const report = await compare(body, body);
  assert.equal(report.verdict, "incomplete");
  assert.equal(report.claims.noChangeProven, false);
  assert.ok(report.rows.unknown.length > 0);
});

test("exact evidence preserves differences beyond the display excerpt", async () => {
  const before = fixture(), after = fixture();
  before.sources[0].data.title = `${"x".repeat(300)}OLD`;
  after.sources[0].data.title = `${"x".repeat(300)}NEW`;
  const report = await compare(before, after);
  const change = report.changes.find((entry) => entry.path === "/title");
  assert.equal(change.before, before.sources[0].data.title);
  assert.equal(change.after, after.sources[0].data.title);
  assert.equal(change.evidenceTruncated, true);
});

test("UTF-8 excerpts do not split a multibyte code point", () => {
  assert.equal(excerpt("ééé", 3), "é…");
});
