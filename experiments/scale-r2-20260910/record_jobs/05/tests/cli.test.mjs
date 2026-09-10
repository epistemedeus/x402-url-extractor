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
  assert.equal(out.results["positive.json"].deltaCounts.removed, 1);
  assert.equal(out.results["positive.json"].deltaCounts.redirected, 1);
  assert.equal(out.results["positive.json"].deltaCounts.inaccessible, 2);
  for (const v of Object.values(out.results)) {
    assert.equal(v.hasSeoRank, false);
    assert.equal(v.hasTrafficProjection, false);
    assert.equal(v.hasInvestmentRecommendation, false);
    assert.equal(v.hasSiteHealthScore, false);
    assert.equal(v.scopeNotePresent, true);
  }
});

test("cli report positive exits 0 with schema and scopeNote", () => {
  const r = run(["report", join(root, "fixtures", "positive.json")]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.schema, "x402.r2.record.route_regression_report.v1");
  assert.equal(report.status, "ready");
  assert.match(report.scopeNote, /not a claim about the entire internet/i);
});

test("cli report negative exits 1", () => {
  const r = run(["report", join(root, "fixtures", "negative-malformed.json")]);
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.status, "rejected");
});

test("cli validate stdin works", () => {
  const payload = JSON.stringify({
    reportId: "stdin-demo",
    baseline: {
      routes: [{ path: "/", url: "https://example.test/", status: 200, accessibility: "ok" }],
    },
    current: {
      routes: [{ path: "/", url: "https://example.test/", status: 200, accessibility: "ok" }],
    },
  });
  const r = run(["validate", "-"], { input: payload });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.normalized.reportId, "stdin-demo");
});
