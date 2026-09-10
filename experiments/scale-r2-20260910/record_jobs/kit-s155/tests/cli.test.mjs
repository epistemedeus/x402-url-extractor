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
    env: { ...process.env },
    maxBuffer: 16 * 1024 * 1024,
  });
}

test("cli manifest: readyCount 7 metaCount 1 heavy pin", () => {
  const r = run(["manifest"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.summary.readyCount, 7);
  assert.equal(out.summary.metaCount, 1);
  assert.match(out.heavyPin.sha, /^65ce1867/);
});

test("cli journey: writes demo-out and summarizes", () => {
  const r = run(["journey"]);
  assert.equal(r.status, 0, r.stderr + r.stdout.slice(0, 500));
  const out = JSON.parse(r.stdout);
  assert.equal(out.journey, true);
  assert.equal(out.summary.cleanInstallOk, true);
  assert.equal(out.summary.exampleStatus, "ready");
  assert.equal(out.summary.partialStatus, "partial");
  assert.equal(out.summary.refusalStatus, "rejected");
  assert.equal(out.summary.csvProbeAllPass, true);
  assert.equal(out.summary.hasInvestmentRecommendation, false);
  for (const name of [
    "journey.json",
    "manifest.json",
    "example.json",
    "partial.json",
    "refusal-forbidden.json",
    "csv-s154-probe.json",
  ]) {
    assert.ok(existsSync(join(root, "demo-out", name)), name);
  }
});

test("cli run positive exits 0", () => {
  const r = run(["run", join(root, "fixtures", "positive-journey.json")]);
  assert.equal(r.status, 0, r.stderr);
  const pkg = JSON.parse(r.stdout);
  assert.equal(pkg.status, "ready");
});

test("cli run forbidden exits 1", () => {
  const r = run(["run", join(root, "fixtures", "negative-forbidden.json")]);
  assert.equal(r.status, 1);
  const pkg = JSON.parse(r.stdout);
  assert.equal(pkg.status, "rejected");
});

test("cli validate positive", () => {
  const r = run(["validate", join(root, "fixtures", "positive-journey.json")]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
});

test("cli demo alias works", () => {
  const r = run(["demo"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.demo, true);
});
