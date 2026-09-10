import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    cwd: root,
  });
}

test("cli report positive exits 0 with ready + duplicates", () => {
  const r = run(["report", "fixtures/positive.json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, "ready");
  assert.ok(out.duplicateRuntimeDependencies.length >= 2);
  assert.equal(out.separateFrom, "S127");
});

test("cli overlap alias works", () => {
  const r = run(["overlap", "fixtures/positive.json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, "ready");
});

test("cli validate positive ok", () => {
  const r = run(["validate", "fixtures/positive.json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
});

test("cli report negative exits 1", () => {
  const r = run(["report", "fixtures/negative-malformed.json"]);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, "rejected");
});

test("cli demo walks fixtures", () => {
  const r = run(["demo"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.demo, true);
  assert.equal(out.results["positive.json"].status, "ready");
  assert.equal(out.results["partial-incomplete.json"].status, "partial_input");
  assert.equal(out.results["negative-malformed.json"].status, "rejected");
  assert.equal(out.results["positive.json"].separateFrom, "S127");
  assert.equal(out.results["positive.json"].hasCveScore, false);
  assert.equal(out.results["positive.json"].hasS127ApiImpact, false);
});
