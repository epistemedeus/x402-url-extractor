import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  KNOWN_EXTERNAL_HEAVY_DEFECTS,
  S152_POSITIVE_PARTIAL_MATRIX,
} from "../src/acquisition-status.mjs";
import {
  PACKAGE_NOTE_PARTIAL_FIRST_RESULT,
} from "../src/first-result.mjs";
import {
  GREEN_FIRST_RESULT_BUNDLE_SCHEMA,
  executeGreenFirstResultBundle,
  greenBundleExitCode,
} from "../src/green-bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.mjs");

const GREEN = [
  "migration-checklist",
  "release-brief",
  "freshness-receipt",
  "procurement-brief",
];
const DEFERRED = ["table-reconcile", "link-index", "replay-pack"];

function runCli(args, cwd = root) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function withTempOut(fn) {
  const outDir = mkdtempSync(join(tmpdir(), "r2-green-bundle-"));
  try {
    return fn(outDir);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

test("execute green path produces bundle with 4 results", () => {
  withTempOut((outDir) => {
    const bundle = executeGreenFirstResultBundle({ outDir });
    assert.equal(bundle.schema, GREEN_FIRST_RESULT_BUNDLE_SCHEMA);
    assert.equal(bundle.packageNote, PACKAGE_NOTE_PARTIAL_FIRST_RESULT);
    assert.equal(bundle.packageStatusHint, "partial");
    assert.equal(bundle.fullPackageReady, false);
    assert.equal(bundle.firstResultReady, true);
    assert.equal(bundle.acquisitionOk, true);
    assert.equal(bundle.executedOk, true);
    assert.equal(bundle.mode, "executed_green_bundle");
    assert.equal(greenBundleExitCode(bundle), 0);
    assert.equal(bundle.results.length, 4);
    assert.deepEqual(
      bundle.results.map((r) => r.id),
      GREEN,
    );
    assert.deepEqual(
      bundle.offered.map((r) => r.id),
      GREEN,
    );
    for (const r of bundle.results) {
      assert.equal(r.offered, true);
      assert.equal(r.executed, true);
      assert.equal(r.ok, true);
      assert.ok(r.packetPath);
      assert.ok(existsSync(r.packetPath), `missing packet ${r.packetPath}`);
    }
    assert.ok(existsSync(bundle.bundlePath));
    const disk = JSON.parse(readFileSync(bundle.bundlePath, "utf8"));
    assert.equal(disk.schema, GREEN_FIRST_RESULT_BUNDLE_SCHEMA);
    assert.equal(disk.results.length, 4);
    // Truth reuse — same matrix green set
    const matrixReady = S152_POSITIVE_PARTIAL_MATRIX.filter(
      (r) => r.slotStatus === "ready",
    ).map((r) => r.id);
    assert.deepEqual(matrixReady, GREEN);
  });
});

test("deferred list present on executed bundle", () => {
  withTempOut((outDir) => {
    const bundle = executeGreenFirstResultBundle({ outDir });
    assert.deepEqual(
      bundle.deferredExternalDefects.map((r) => r.id),
      DEFERRED,
    );
    for (const row of bundle.deferredExternalDefects) {
      assert.equal(row.offered, false);
      assert.equal(row.kind, "heavy_cli_analyze_fail");
      assert.equal(row.heavyDecision, "fail");
      assert.match(row.note, /not unavailable_pending_heavy/);
    }
    const analyze = KNOWN_EXTERNAL_HEAVY_DEFECTS.find(
      (d) => d.kind === "heavy_cli_analyze_fail",
    );
    assert.deepEqual(analyze.ids, DEFERRED);
    assert.ok(Array.isArray(bundle.knownExternalHeavyDefects));
    assert.equal(
      bundle.knownExternalHeavyDefects.length,
      KNOWN_EXTERNAL_HEAVY_DEFECTS.length,
    );
  });
});

test("deferred recipe ids are refused (no invent / no run-as-pass)", () => {
  withTempOut((outDir) => {
    for (const id of DEFERRED) {
      assert.throws(
        () => executeGreenFirstResultBundle({ outDir, recipeIds: [id] }),
        (err) =>
          err.code === "deferred_recipe_refused" && err.refusedIds.includes(id),
      );
    }
    assert.throws(
      () =>
        executeGreenFirstResultBundle({
          outDir,
          recipeIds: ["migration-checklist", "table-reconcile"],
        }),
      (err) =>
        err.code === "deferred_recipe_refused" &&
        err.refusedIds.includes("table-reconcile"),
    );
  });
});

test("does not claim ready full package", () => {
  withTempOut((outDir) => {
    const bundle = executeGreenFirstResultBundle({ outDir });
    assert.equal(bundle.fullPackageReady, false);
    assert.notEqual(bundle.packageNote, "ready");
    assert.notEqual(bundle.packageStatusHint, "ready");
    assert.equal(bundle.packageNote, PACKAGE_NOTE_PARTIAL_FIRST_RESULT);
    assert.match(JSON.stringify(bundle.notes), /never full package ready/i);
    assert.match(JSON.stringify(bundle.notes), /do not invent pass/i);
  });
});

test("cli green-bundle: green execute exits 0", () => {
  withTempOut((outDir) => {
    const r = runCli(["green-bundle", "--out", outDir, "--json"]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.schema, GREEN_FIRST_RESULT_BUNDLE_SCHEMA);
    assert.equal(out.packageNote, PACKAGE_NOTE_PARTIAL_FIRST_RESULT);
    assert.equal(out.fullPackageReady, false);
    assert.deepEqual(
      out.results.map((x) => x.id),
      GREEN,
    );
    assert.deepEqual(
      out.deferredExternalDefects.map((x) => x.id),
      DEFERRED,
    );
    assert.ok(existsSync(join(outDir, "bundle.json")));
    for (const id of GREEN) {
      assert.ok(existsSync(join(outDir, "packets", `${id}.json`)));
    }
  });
});

test("cli first-result --execute: same green bundle path", () => {
  withTempOut((outDir) => {
    const r = runCli(["first-result", "--execute", "--out", outDir, "--json"]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.schema, GREEN_FIRST_RESULT_BUNDLE_SCHEMA);
    assert.equal(out.results.length, 4);
    assert.equal(out.executedOk, true);
  });
});

test("cli green-bundle: deferred id refused non-zero", () => {
  for (const id of DEFERRED) {
    const r = runCli(["green-bundle", "--recipe", id, "--json"]);
    assert.equal(r.status, 1, r.stdout);
    const out = JSON.parse(r.stderr || r.stdout);
    assert.equal(out.error, "deferred_recipe_refused");
    assert.equal(out.acquisitionOk, false);
    assert.ok(out.refusedIds.includes(id));
  }
});

test("commit pins present when Heavy pin file exists", () => {
  withTempOut((outDir) => {
    const bundle = executeGreenFirstResultBundle({ outDir });
    assert.ok(bundle.resolvedCommits);
    assert.ok(bundle.resolvedCommits.heavyResolvedInputCommit);
    assert.match(
      bundle.resolvedCommits.heavyResolvedInputCommit,
      /^[0-9a-f]{40}$/,
    );
  });
});
