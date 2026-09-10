import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ACQUISITION_STATUS_SCHEMA,
  acquisitionStatusExitCode,
  acquisitionStatusFromPath,
  buildAcquisitionStatus,
  formatAcquisitionStatusTable,
  S152_POSITIVE_PARTIAL_MATRIX,
} from "../src/acquisition-status.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.mjs");
const fixtures = join(root, "fixtures");

function runStatus(args) {
  return spawnSync(process.execPath, [cli, "status", ...args], {
    encoding: "utf8",
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
  });
}

test("partial journey → status ok + exact fail slots listed", () => {
  const status = acquisitionStatusFromPath(join(fixtures, "partial-journey.json"));
  assert.equal(status.schema, ACQUISITION_STATUS_SCHEMA);
  assert.equal(status.packageStatus, "partial");
  assert.equal(status.acquisitionOk, true);
  assert.equal(acquisitionStatusExitCode(status), 0);
  assert.deepEqual(status.summary.failHeavy, [
    "table-reconcile",
    "link-index",
    "replay-pack",
  ]);
  assert.deepEqual(status.summary.passHeavy, [
    "migration-checklist",
    "release-brief",
    "freshness-receipt",
  ]);
  assert.equal(status.recipes.length, 7);
  for (const expected of S152_POSITIVE_PARTIAL_MATRIX) {
    const row = status.recipes.find((r) => r.id === expected.id);
    assert.ok(row, `missing ${expected.id}`);
    assert.equal(row.jobRef, expected.jobRef);
    assert.equal(row.slotStatus, expected.slotStatus);
    assert.equal(row.heavyDecision, expected.heavyDecision);
  }
  assert.equal(status.hasInvestmentRecommendation, false);
  const table = formatAcquisitionStatusTable(status);
  assert.match(table, /table-reconcile/);
  assert.match(table, /packageStatus: partial/);
});

test("cli status: partial journey exits 0 and lists failHeavy", () => {
  const r = runStatus(["--journey", join(fixtures, "partial-journey.json"), "--json"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.schema, ACQUISITION_STATUS_SCHEMA);
  assert.equal(out.packageStatus, "partial");
  assert.equal(out.acquisitionOk, true);
  assert.deepEqual(out.summary.failHeavy, [
    "table-reconcile",
    "link-index",
    "replay-pack",
  ]);
});

test("rejected journey/package → non-zero", () => {
  const status = acquisitionStatusFromPath(join(fixtures, "rejected-package.json"));
  assert.equal(status.packageStatus, "rejected");
  assert.equal(status.acquisitionOk, false);
  assert.equal(acquisitionStatusExitCode(status), 1);

  const r = runStatus(["--package", join(fixtures, "rejected-package.json"), "--json"]);
  assert.equal(r.status, 1, r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.packageStatus, "rejected");
  assert.equal(out.acquisitionOk, false);
});

test("cli status: rejected step from journey via --step", () => {
  const r = runStatus([
    "--journey",
    join(fixtures, "partial-journey.json"),
    "--step",
    "negative-unknown-recipe",
    "--json",
  ]);
  assert.equal(r.status, 1, r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.packageStatus, "rejected");
  assert.equal(out.acquisitionOk, false);
});

test("missing file → error non-zero", () => {
  const missing = join(fixtures, "does-not-exist-journey.json");
  assert.throws(
    () => acquisitionStatusFromPath(missing),
    (err) => err.code === "missing_file",
  );
  const r = runStatus(["--journey", missing, "--json"]);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stderr || r.stdout);
  assert.equal(out.error, "missing_file");
  assert.equal(out.acquisitionOk, false);
});

test("buildAcquisitionStatus rejects invalid package", () => {
  assert.throws(
    () => buildAcquisitionStatus({}),
    (err) => err.code === "invalid_input",
  );
});
