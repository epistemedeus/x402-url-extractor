import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.mjs");

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    cwd: root,
  });
}

test("cli demo writes export artifact and covers fixtures", () => {
  const r = run("demo");
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.demo, true);
  assert.equal(out.results["positive.json"].status, "ready");
  assert.equal(out.results["partial-incomplete-current.json"].status, "partial_input");
  assert.equal(out.results["partial-incomplete-current.json"].currentCaptureIncomplete, true);
  assert.equal(out.results["negative-forbidden.json"].status, "rejected");
  assert.ok(out.exportArtifact);
  assert.ok(existsSync(out.exportArtifact));
  const exported = JSON.parse(readFileSync(out.exportArtifact, "utf8"));
  assert.equal(exported.schema, "pilot.nl.record.dist_repair_feed.v1");
});

test("cli feed positive exits 0", () => {
  const r = run("feed", join(root, "fixtures", "positive.json"));
  assert.equal(r.status, 0, r.stderr);
  const feed = JSON.parse(r.stdout);
  assert.equal(feed.status, "ready");
});

test("cli feed negative exits 1", () => {
  const r = run("feed", join(root, "fixtures", "negative-forbidden.json"));
  assert.equal(r.status, 1);
});
