import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.mjs");

function run(args, { input } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input,
    cwd: root,
  });
}

test("cli demo: emits statuses for all fixtures without forbidden claims", () => {
  const r = run(["demo"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.demo, true);
  assert.equal(out.results["positive.json"].status, "ready");
  assert.equal(out.results["negative-malformed.json"].status, "rejected");
  assert.equal(out.results["partial-incomplete.json"].status, "partial_input");
  assert.ok(out.results["positive.json"].explicitCount >= 2);
  assert.ok(out.results["positive.json"].ambiguousCount >= 2);
  assert.equal(out.results["positive.json"].ambiguousRetained, true);
  for (const v of Object.values(out.results)) {
    assert.equal(v.hasSeoRank, false);
    assert.equal(v.hasTrafficProjection, false);
    assert.equal(v.hasInvestmentRecommendation, false);
    assert.equal(v.hasComplianceScore, false);
    assert.equal(v.hasLegalCertification, false);
    assert.equal(v.scopeNotePresent, true);
  }
});

test("cli calendar positive exits 0 with schema and scopeNote", () => {
  const r = run(["calendar", join(root, "fixtures", "positive.json")]);
  assert.equal(r.status, 0, r.stderr);
  const cal = JSON.parse(r.stdout);
  assert.equal(cal.schema, "x402.r2.record.deadline_calendar.v1");
  assert.equal(cal.status, "ready");
  assert.match(cal.scopeNote, /only the supplied public notices/i);
  const ambig = cal.entries.filter((e) => e.ambiguous);
  assert.ok(ambig.length >= 2);
  for (const e of ambig) {
    assert.equal(e.date, null);
    assert.ok(e.dateRaw);
  }
});

test("cli report alias works like calendar", () => {
  const r = run(["report", join(root, "fixtures", "positive.json")]);
  assert.equal(r.status, 0, r.stderr);
  const cal = JSON.parse(r.stdout);
  assert.equal(cal.status, "ready");
});

test("cli calendar negative exits 1", () => {
  const r = run(["calendar", join(root, "fixtures", "negative-malformed.json")]);
  assert.equal(r.status, 1);
  const cal = JSON.parse(r.stdout);
  assert.equal(cal.status, "rejected");
});

test("cli validate stdin works", () => {
  const payload = JSON.stringify({
    calendarId: "stdin-demo",
    notices: [
      {
        sourceId: "n1",
        sourceRef: "https://example.test/n1",
        text: "Due no later than 2026-08-01.",
      },
    ],
  });
  const r = run(["validate", "-"], { input: payload });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.normalized.calendarId, "stdin-demo");
});
