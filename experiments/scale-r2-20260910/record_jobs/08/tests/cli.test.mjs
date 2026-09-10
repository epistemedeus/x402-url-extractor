import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("cli bundle: readyCount 3 and ownedByHeavyCount 4", () => {
  const r = run(["bundle"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.summary.readyCount, 3);
  assert.equal(out.summary.ownedByHeavyCount, 4);
});

test("cli demo: positive/partial/negative without investmentRecommendation", () => {
  const r = run(["demo"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.demo, true);
  assert.equal(out.results["manifest.readyCount"], 3);
  assert.equal(out.results["manifest.ownedByHeavyCount"], 4);
  assert.equal(out.results["positive-bundle.json"].status, "ready");
  assert.equal(out.results["partial-missing-sibling.json"].status, "partial");
  assert.equal(out.results["negative-forbidden.json"].status, "rejected");
  assert.equal(out.results["negative-unknown-job.json"].status, "rejected");
  for (const key of [
    "positive-bundle.json",
    "partial-missing-sibling.json",
    "negative-forbidden.json",
    "negative-unknown-job.json",
  ]) {
    assert.equal(out.results[key].hasInvestmentRecommendation, false);
  }
  // Positive should have real dependency modes from siblings
  const modes = out.results["positive-bundle.json"].jobStatuses.map((j) => j.dependencyMode);
  assert.ok(modes.every((m) => m === "absolute_worktree" || m === "relative" || m === "override"));
});

test("cli demo writes demo-out artifacts", () => {
  const r = run(["demo"]);
  assert.equal(r.status, 0, r.stderr);
  for (const name of [
    "journey.json",
    "manifest.json",
    "positive.json",
    "partial.json",
    "negative.json",
    "unknown.json",
  ]) {
    const path = join(root, "demo-out", name);
    assert.ok(existsSync(path), `missing ${name}`);
    JSON.parse(readFileSync(path, "utf8"));
  }
});

test("cli run positive exits 0", () => {
  const r = run(["run", join(root, "fixtures", "positive-bundle.json")]);
  assert.equal(r.status, 0, r.stderr);
  const pkg = JSON.parse(r.stdout);
  assert.equal(pkg.status, "ready");
  assert.equal(pkg.schema, "x402.r2.record.recurring_job_bundle.v1");
});

test("cli run negative exits 1", () => {
  const r = run(["run", join(root, "fixtures", "negative-forbidden.json")]);
  assert.equal(r.status, 1);
  const pkg = JSON.parse(r.stdout);
  assert.equal(pkg.status, "rejected");
});

test("cli validate positive", () => {
  const r = run(["validate", join(root, "fixtures", "positive-bundle.json")]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.normalized.jobs.length, 3);
});

test("cli run stdin works", () => {
  const payload = JSON.stringify({
    requestId: "stdin-demo",
    jobs: [
      {
        id: "route-regression",
        inputPath: "fixtures/jobs/05-route-regression-positive.json",
      },
    ],
  });
  const r = run(["run", "-"], { input: payload });
  assert.equal(r.status, 0, r.stderr);
  const pkg = JSON.parse(r.stdout);
  assert.equal(pkg.status, "ready");
  assert.equal(pkg.requestId, "stdin-demo");
});
