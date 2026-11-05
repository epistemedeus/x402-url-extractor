import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  INSTALLED,
  PREPARED,
  assertProjectionHonest,
  loadClaimFiles,
  projectMerchantComposition,
} from "./projection.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("prepared pin projects blocked_suite until Console receives the suite", () => {
  const projection = projectMerchantComposition();
  assert.equal(projection.decision, "blocked_suite");
  assert.equal(projection.recognizedRevenueAtomic, "0");
  assert.equal(projection.prepared.commit, PREPARED.commit);
  assert.equal(projection.installed.commit, INSTALLED.commit);
  assert.ok(projection.gaps.some((g) => g.code === "suite_pending_console_route"));
  assert.ok(projection.gaps.some((g) => g.code === "railway_preflight_dated"));
  assertProjectionHonest(projection);
});

test("suite received still refuses deploy until Railway is re-read", () => {
  const projection = projectMerchantComposition({ suiteReceived: true });
  assert.equal(projection.decision, "re_read_railway_before_effect");
  assertProjectionHonest(projection);
});

test("suite and Railway re-read yield ready_remote_suite without inventing revenue", () => {
  const projection = projectMerchantComposition({
    suiteReceived: true,
    railwayReread: true,
  });
  assert.equal(projection.decision, "ready_remote_suite");
  assert.equal(projection.authority.deploy, "root");
  assert.equal(projection.recognizedRevenueAtomic, "0");
  assertProjectionHonest(projection);
});

test("claim files hash from repo root", () => {
  const files = loadClaimFiles(repoRoot);
  assert.equal(files.length, 5);
  for (const row of files) {
    assert.equal(typeof row.sha256, "string");
    assert.equal(row.sha256.length, 64);
    assert.ok(row.bytes > 0);
  }
});

test("runtime version drift is refused", () => {
  assert.throws(
    () => projectMerchantComposition({
      prepared: { ...PREPARED, runtimeVersion: "0.0.0" },
    }),
    /projection_runtime_version_drift/,
  );
});
