import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DECISIONS, EVIDENCE_CLASSES, requireCitedFinding } from "../../../src/packet.mjs";
import { validateInput } from "../../../src/table-reconcile/schema.mjs";
import { sha256File } from "./hash.mjs";
import {
  CLOCK,
  FIXTURE_ROOT,
  JOB_ID,
  loadCase,
  loadManifest,
  rowKey,
  toSchemaInput,
} from "./load-case.mjs";

const PROVENANCE_PATH = join(FIXTURE_ROOT, "PROVENANCE.json");

function indexRows(table) {
  const keys = table.keys;
  const map = new Map();
  for (const row of table.rows || []) {
    map.set(rowKey(row, keys), row);
  }
  return map;
}

test("manifest lists required kinds and every case file exists", () => {
  const manifest = loadManifest();
  assert.equal(manifest.schema, "s137.table-reconcile.synthetic-manifest.v1");
  assert.equal(manifest.jobId, JOB_ID);
  assert.equal(manifest.evidenceClass, "synthetic");
  assert.equal(manifest.liveCapture, false);
  assert.equal(manifest.paidDemand, false);
  assert.equal(manifest.clock, CLOCK);
  assert.deepEqual(manifest.requiredKinds, ["positive", "negative", "partial", "conflict"]);
  const kinds = new Set(manifest.cases.map((c) => c.kind));
  for (const kind of manifest.requiredKinds) {
    assert.equal(kinds.has(kind), true, `missing kind ${kind}`);
  }
  for (const entry of manifest.cases) {
    assert.equal(existsSync(join(FIXTURE_ROOT, entry.path)), true, entry.path);
    const { spec, tables } = loadCase(entry.id);
    assert.equal(spec.id, entry.id);
    assert.equal(spec.kind, entry.kind);
    assert.equal(spec.expect.decision, entry.expectDecision);
    assert.equal(DECISIONS.includes(spec.expect.decision), true, spec.expect.decision);
    assert.equal(spec.expect.inventTotals, false);
    assert.equal(tables.length, 2);
    for (const t of tables) {
      assert.equal(existsSync(join(FIXTURE_ROOT, t.path)), true, t.path);
    }
  }
});

test("every expected finding cites a citation with matching sha256", () => {
  const manifest = loadManifest();
  for (const entry of manifest.cases) {
    const { spec, tables } = loadCase(entry.id);
    const citations = new Map((spec.citations || []).map((c) => [c.id, c]));
    assert.ok(spec.citations.length >= 2, entry.id);
    for (const finding of spec.expect.findings) {
      requireCitedFinding(finding);
      for (const cid of finding.citationIds) {
        const cite = citations.get(cid);
        assert.ok(cite, `${entry.id} missing citation ${cid}`);
        assert.ok(cite.path, cid);
        assert.ok(cite.sha256, cid);
        assert.equal(sha256File(join(FIXTURE_ROOT, cite.path)), cite.sha256, cite.path);
      }
    }
    for (const t of tables) {
      const cite = spec.citations.find((c) => c.path === t.path);
      assert.ok(cite, t.path);
      assert.equal(cite.sha256, t.body.sha256);
    }
  }
});

test("wrapped source tables declare keys, unit, and timeWindow", () => {
  const { spec, tables } = loadCase("positive-agree");
  assert.equal(spec.evidenceClass, "synthetic");
  assert.equal(EVIDENCE_CLASSES.includes(spec.evidenceClass), true);
  for (const t of tables) {
    const body = t.body;
    assert.equal(body.raw, false);
    assert.deepEqual(body.keys, spec.join.keys);
    assert.equal(body.unit, spec.join.unit);
    assert.equal(body.timeWindow.grain, spec.join.timeWindow.grain);
    assert.equal(body.timeWindow.start, spec.join.timeWindow.start);
    assert.equal(body.timeWindow.end, spec.join.timeWindow.end);
    assert.ok(Array.isArray(body.rows) && body.rows.length > 0);
  }
});

test("positive-agree: join keys match and measures agree", () => {
  const { spec, tables } = loadCase("positive-agree");
  const [a, b] = tables.map((t) => t.body);
  const aMap = indexRows(a);
  const bMap = indexRows(b);
  assert.equal(aMap.size, bMap.size);
  assert.equal(aMap.size, spec.expect.findings.length);
  for (const [k, row] of aMap) {
    const other = bMap.get(k);
    assert.ok(other, k);
    assert.equal(other.value, row.value);
    assert.equal(other.windowEnd, row.windowEnd);
  }
  assert.equal(spec.expect.decision, "pass");
});

test("negative-empty: lab-a has zero rows and is not treated as zero-fill", () => {
  const { spec, tables } = loadCase("negative-empty");
  const empty = tables.find((t) => t.id === "lab-a").body;
  const other = tables.find((t) => t.id === "lab-b").body;
  assert.equal(empty.rows.length, 0);
  assert.ok(other.rows.length > 0);
  assert.equal(spec.expect.decision, "fail");
  assert.equal(spec.expect.findings[0].code, "empty-rows");
  assert.equal(spec.doNotInvent.includes("zero-fill-empty"), true);
});

test("negative-missing-keys: lab-a is a raw array without keys/unit/window", () => {
  const { spec, tables } = loadCase("negative-missing-keys");
  const raw = tables.find((t) => t.id === "lab-a").body;
  assert.equal(raw.raw, true);
  assert.equal(raw.keys, null);
  assert.equal(raw.unit, null);
  assert.equal(raw.timeWindow, null);
  assert.ok(Array.isArray(raw.rows) && raw.rows.length > 0);
  assert.equal(spec.expect.decision, "fail");
  assert.equal(spec.expect.findings[0].code, "missing-keys");
  assert.equal(spec.doNotInvent.includes("infer-keys"), true);
});

test("partial-row-coverage: lab-b keys are a proper subset and overlap agrees", () => {
  const { spec, tables } = loadCase("partial-row-coverage");
  const a = tables.find((t) => t.id === "lab-a").body;
  const b = tables.find((t) => t.id === "lab-b").body;
  const aMap = indexRows(a);
  const bMap = indexRows(b);
  assert.ok(aMap.size > bMap.size);
  for (const [k, row] of bMap) {
    assert.equal(aMap.get(k).value, row.value);
  }
  const missing = spec.expect.findings.filter((f) => f.kind === "missing-in-source");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].sourceId, "lab-b");
  const missingKey = rowKey(missing[0].keys, a.keys);
  assert.equal(aMap.has(missingKey), true);
  assert.equal(bMap.has(missingKey), false);
  assert.equal(spec.expect.decision, "partial");
});

test("conflict-value: same key/unit/window, different measure, no invented total", () => {
  const { spec, tables } = loadCase("conflict-value");
  const a = tables.find((t) => t.id === "lab-a").body;
  const b = tables.find((t) => t.id === "lab-b").body;
  assert.equal(a.unit, b.unit);
  assert.equal(a.timeWindow.grain, b.timeWindow.grain);
  const conflict = spec.expect.findings.find((f) => f.kind === "value-conflict");
  assert.ok(conflict);
  assert.equal(conflict.valuesBySource["lab-a"], 4);
  assert.equal(conflict.valuesBySource["lab-b"], 9);
  const k = rowKey(conflict.keys, spec.join.keys);
  assert.equal(indexRows(a).get(k).value, 4);
  assert.equal(indexRows(b).get(k).value, 9);
  assert.equal(Object.hasOwn(conflict, "value"), false);
  assert.equal(spec.expect.inventTotals, false);
  assert.equal(spec.expect.decision, "conflict");
});

test("conflict-units: numeric equality is not agreement across units", () => {
  const { spec, tables } = loadCase("conflict-units");
  const a = tables.find((t) => t.id === "lab-a").body;
  const b = tables.find((t) => t.id === "lab-b").body;
  assert.equal(a.unit, "count");
  assert.equal(b.unit, "count_per_day");
  assert.equal(a.rows[0].value, b.rows[0].value);
  const finding = spec.expect.findings[0];
  assert.equal(finding.kind, "unit-conflict");
  assert.deepEqual(finding.unitsBySource, { "lab-a": "count", "lab-b": "count_per_day" });
  assert.equal(spec.doNotInvent.includes("convert-units"), true);
  assert.equal(spec.expect.decision, "conflict");
});

test("conflict-time-window: do not sum daily rows into the weekly cell", () => {
  const { spec, tables } = loadCase("conflict-time-window");
  const a = tables.find((t) => t.id === "lab-a").body;
  const b = tables.find((t) => t.id === "lab-b").body;
  assert.equal(a.timeWindow.grain, "P7D");
  assert.equal(b.timeWindow.grain, "P1D");
  assert.equal(a.timeWindow.start, b.timeWindow.start);
  assert.equal(a.timeWindow.end, b.timeWindow.end);
  const dailySum = b.rows.reduce((n, row) => n + row.value, 0);
  assert.equal(dailySum, 7);
  assert.equal(a.rows[0].value, 11);
  const finding = spec.expect.findings[0];
  assert.equal(finding.kind, "time-window-mismatch");
  assert.equal(Object.hasOwn(finding, "value"), false);
  assert.equal(spec.doNotInvent.includes("rollup-grain"), true);
  assert.equal(spec.doNotInvent.includes("sum"), true);
  assert.equal(spec.expect.decision, "conflict");
});

test("c11 schema: wrapped cases validate; raw missing-keys is invalid", () => {
  const positive = loadCase("positive-agree");
  const pos = validateInput(toSchemaInput(positive.spec, positive.tables));
  assert.equal(pos.ok, true);
  assert.equal(pos.caseKind, "positive");

  const partial = loadCase("partial-row-coverage");
  const part = validateInput(toSchemaInput(partial.spec, partial.tables));
  assert.equal(part.ok, true);

  const units = loadCase("conflict-units");
  const unitIn = validateInput(toSchemaInput(units.spec, units.tables));
  assert.equal(unitIn.ok, true);
  assert.equal(unitIn.caseKind, "conflict");

  const values = loadCase("conflict-value");
  const valIn = validateInput(toSchemaInput(values.spec, values.tables));
  assert.equal(valIn.ok, true, "value disagreement is c12, not a schema invalid");

  const missing = loadCase("negative-missing-keys");
  const miss = validateInput(toSchemaInput(missing.spec, missing.tables));
  assert.equal(miss.ok, false);
  assert.ok(miss.issues.some((i) => i.code === "minItems"));

  const empty = loadCase("negative-empty");
  const emptyIn = validateInput(toSchemaInput(empty.spec, empty.tables));
  assert.equal(emptyIn.ok, true, "empty rows are structurally valid");
  assert.equal(empty.spec.expect.decision, "fail", "catalog pin: do not pass an empty merge");
});

test("PROVENANCE hashes listed files and stays synthetic/offline", () => {
  const provenance = JSON.parse(readFileSync(PROVENANCE_PATH, "utf8"));
  assert.equal(provenance.evidenceClass, "synthetic");
  assert.equal(provenance.liveCapture, false);
  assert.equal(provenance.paidDemand, false);
  assert.equal(provenance.retrievedAt, CLOCK);
  assert.ok(provenance.license);
  assert.ok(provenance.files);
  for (const [rel, meta] of Object.entries(provenance.files)) {
    const abs = join(FIXTURE_ROOT, rel);
    assert.equal(existsSync(abs), true, rel);
    assert.equal(sha256File(abs), meta.sha256, rel);
    assert.equal(meta.label, "synthetic");
  }
});
