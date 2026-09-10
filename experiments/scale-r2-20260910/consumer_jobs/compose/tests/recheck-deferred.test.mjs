import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  KNOWN_EXTERNAL_HEAVY_DEFECTS,
  S152_POSITIVE_PARTIAL_MATRIX,
} from "../src/acquisition-status.mjs";
import {
  DEFERRED_RECHECK_SCHEMA,
  RECHECK_CELL_STATUS,
  assertClearedRequiresPass,
  assertDeferredInclude,
  classifyRecheckCell,
  deferredRecheckExitCode,
  knownDeferredIds,
  recheckDeferredCell,
  runDeferredRecheck,
} from "../src/recheck-deferred.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.mjs");

const DEFERRED = ["table-reconcile", "link-index", "replay-pack"];
const GREEN = [
  "migration-checklist",
  "release-brief",
  "freshness-receipt",
  "procurement-brief",
];

function runCli(args, cwd = root) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function withTempOut(fn) {
  const outDir = mkdtempSync(join(tmpdir(), "r2-deferred-recheck-"));
  try {
    return fn(outDir);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function stubSpawn(decisionById) {
  return (recipeId, options = {}) => {
    const decision = decisionById[recipeId];
    if (decision === undefined) {
      throw new Error(`stub missing decision for ${recipeId}`);
    }
    const packetPath = join(
      options.outDir || tmpdir(),
      "packets",
      `${recipeId}.json`,
    );
    return {
      id: recipeId,
      decision,
      slotStatus: decision === "pass" ? "ready" : decision === "fail" ? "failed" : "partial",
      exitCode: 0,
      fixture: `/stub/fixtures/${recipeId}.json`,
      packetPath,
      error: null,
      stderr: null,
      output: { schema: "s137.consumer-evidence.packet.v1", decision },
      spawnSource: "stub",
    };
  };
}

test("schema shape + known deferred ids match matrix / defects", () => {
  assert.deepEqual(knownDeferredIds(), DEFERRED);
  const analyze = KNOWN_EXTERNAL_HEAVY_DEFECTS.find(
    (d) => d.kind === "heavy_cli_analyze_fail",
  );
  assert.deepEqual(analyze.ids, DEFERRED);
  const matrixFail = S152_POSITIVE_PARTIAL_MATRIX.filter(
    (r) => r.heavyDecision === "fail",
  ).map((r) => r.id);
  assert.deepEqual(matrixFail, DEFERRED);
});

test("classify: fail→still_deferred; pass→cleared; other→unexpected", () => {
  assert.equal(classifyRecheckCell("fail"), RECHECK_CELL_STATUS.STILL_DEFERRED);
  assert.equal(classifyRecheckCell("pass"), RECHECK_CELL_STATUS.CLEARED);
  assert.equal(classifyRecheckCell("conflict"), RECHECK_CELL_STATUS.UNEXPECTED);
  assert.equal(classifyRecheckCell(null), RECHECK_CELL_STATUS.UNEXPECTED);
  assert.equal(classifyRecheckCell(undefined), RECHECK_CELL_STATUS.UNEXPECTED);
});

test("refuse inventing cleared without actualDecision===pass", () => {
  assert.throws(
    () =>
      assertClearedRequiresPass({
        id: "table-reconcile",
        status: RECHECK_CELL_STATUS.CLEARED,
        actualDecision: "fail",
      }),
    (err) => err.code === "invent_cleared_refused",
  );
  assert.throws(
    () =>
      assertClearedRequiresPass({
        id: "table-reconcile",
        status: RECHECK_CELL_STATUS.CLEARED,
        actualDecision: null,
      }),
    (err) => err.code === "invent_cleared_refused",
  );
  // Legitimate clear
  assert.equal(
    assertClearedRequiresPass({
      id: "table-reconcile",
      status: RECHECK_CELL_STATUS.CLEARED,
      actualDecision: "pass",
    }),
    true,
  );
  // still_deferred with fail is fine
  assert.equal(
    assertClearedRequiresPass({
      id: "table-reconcile",
      status: RECHECK_CELL_STATUS.STILL_DEFERRED,
      actualDecision: "fail",
    }),
    true,
  );
});

test("--include refuses non-deferred / green ids", () => {
  for (const id of GREEN) {
    assert.throws(
      () => assertDeferredInclude([id]),
      (err) =>
        err.code === "non_deferred_refused" && err.unknownIds.includes(id),
    );
  }
  assert.throws(
    () => assertDeferredInclude(["table-reconcile", "migration-checklist"]),
    (err) =>
      err.code === "non_deferred_refused" &&
      err.unknownIds.includes("migration-checklist"),
  );
  assert.deepEqual(assertDeferredInclude(["link-index"]), ["link-index"]);
  assert.deepEqual(assertDeferredInclude([]), DEFERRED);
});

test("stubbed current fail → still_deferred for all deferred cells", () => {
  withTempOut((outDir) => {
    const doc = runDeferredRecheck({
      outDir,
      spawnRecipe: stubSpawn({
        "table-reconcile": "fail",
        "link-index": "fail",
        "replay-pack": "fail",
      }),
    });
    assert.equal(doc.schema, DEFERRED_RECHECK_SCHEMA);
    assert.equal(doc.packageNote, "partial_deferred_recheck");
    assert.equal(doc.packageStatusHint, "partial");
    assert.equal(doc.fullPackageReady, false);
    assert.equal(doc.overallStillDeferred, true);
    assert.equal(doc.summary.stillDeferredCount, 3);
    assert.equal(doc.summary.clearedCount, 0);
    assert.deepEqual(doc.summary.stillDeferredIds, DEFERRED);
    assert.deepEqual(doc.summary.clearedIds, []);
    for (const c of doc.cells) {
      assert.equal(c.actualDecision, "fail");
      assert.equal(c.status, RECHECK_CELL_STATUS.STILL_DEFERRED);
      assert.equal(c.expectedDefect.kind, "heavy_cli_analyze_fail");
      assert.equal(c.expectedDefect.expectedDecision, "fail");
      assert.equal(c.delta.cleared, false);
      assertClearedRequiresPass(c);
    }
    assert.equal(deferredRecheckExitCode(doc), 0);
    assert.equal(deferredRecheckExitCode(doc, { requireCleared: true }), 1);
    assert.ok(existsSync(doc.recheckPath));
    const disk = JSON.parse(readFileSync(doc.recheckPath, "utf8"));
    assert.equal(disk.schema, DEFERRED_RECHECK_SCHEMA);
    assert.equal(disk.overallStillDeferred, true);
  });
});

test("cleared only when stub returns pass — never hardcode", () => {
  withTempOut((outDir) => {
    const doc = runDeferredRecheck({
      outDir,
      includeIds: ["table-reconcile", "link-index"],
      spawnRecipe: stubSpawn({
        "table-reconcile": "pass",
        "link-index": "fail",
      }),
    });
    assert.equal(doc.cells.length, 2);
    const cleared = doc.cells.find((c) => c.id === "table-reconcile");
    const still = doc.cells.find((c) => c.id === "link-index");
    assert.equal(cleared.status, RECHECK_CELL_STATUS.CLEARED);
    assert.equal(cleared.actualDecision, "pass");
    assert.equal(cleared.delta.cleared, true);
    assert.equal(still.status, RECHECK_CELL_STATUS.STILL_DEFERRED);
    assert.equal(doc.overallStillDeferred, true);
    assert.equal(doc.packageNote, "partial_deferred_recheck");
    assert.deepEqual(doc.deltaVsKnownDefects.newlyCleared.map((x) => x.id), [
      "table-reconcile",
    ]);
  });
});

test("all stub pass → deferred_cells_cleared note; still no fullPackageReady", () => {
  withTempOut((outDir) => {
    const doc = runDeferredRecheck({
      outDir,
      spawnRecipe: stubSpawn({
        "table-reconcile": "pass",
        "link-index": "pass",
        "replay-pack": "pass",
      }),
    });
    assert.equal(doc.overallStillDeferred, false);
    assert.equal(doc.packageNote, "deferred_cells_cleared");
    assert.equal(doc.fullPackageReady, false);
    assert.equal(doc.packageStatusHint, "partial");
    assert.equal(doc.summary.clearedCount, 3);
    for (const c of doc.cells) {
      assert.equal(c.status, RECHECK_CELL_STATUS.CLEARED);
      assert.equal(c.actualDecision, "pass");
    }
  });
});

test("unexpected decision recorded (not invented as cleared)", () => {
  withTempOut((outDir) => {
    const cell = recheckDeferredCell("replay-pack", {
      outDir,
      spawnRecipe: stubSpawn({ "replay-pack": "conflict" }),
    });
    assert.equal(cell.status, RECHECK_CELL_STATUS.UNEXPECTED);
    assert.equal(cell.actualDecision, "conflict");
    assert.notEqual(cell.status, RECHECK_CELL_STATUS.CLEARED);
  });
});

test("real Heavy CLI: deferred positives still_deferred (expect fail)", () => {
  withTempOut((outDir) => {
    const doc = runDeferredRecheck({ outDir });
    assert.equal(doc.schema, DEFERRED_RECHECK_SCHEMA);
    assert.equal(doc.cells.length, 3);
    assert.equal(doc.overallStillDeferred, true);
    assert.equal(doc.packageNote, "partial_deferred_recheck");
    assert.equal(doc.fullPackageReady, false);
    for (const c of doc.cells) {
      assert.ok(DEFERRED.includes(c.id));
      assert.equal(c.actualDecision, "fail", `${c.id} expected fail, got ${c.actualDecision}`);
      assert.equal(c.status, RECHECK_CELL_STATUS.STILL_DEFERRED);
      assert.equal(c.spawnSource, "heavy_cli");
      assert.ok(c.fixture);
      assert.ok(c.packetPath);
      assert.ok(existsSync(c.packetPath), `missing packet ${c.packetPath}`);
      // Must not invent cleared today
      assert.notEqual(c.status, RECHECK_CELL_STATUS.CLEARED);
    }
    assert.deepEqual(doc.summary.clearedIds, []);
    assert.deepEqual(doc.summary.stillDeferredIds, DEFERRED);
    assert.match(JSON.stringify(doc.notes), /Does not invent pass/);
    assert.match(JSON.stringify(doc.notes), /Green bundle remains/);
  });
});

test("cli recheck-deferred: still_deferred exits 0; require-cleared → 1", () => {
  withTempOut((outDir) => {
    const r = runCli(["recheck-deferred", "--out", outDir, "--json"]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.schema, DEFERRED_RECHECK_SCHEMA);
    assert.equal(out.overallStillDeferred, true);
    assert.deepEqual(
      out.cells.map((c) => c.status),
      [
        RECHECK_CELL_STATUS.STILL_DEFERRED,
        RECHECK_CELL_STATUS.STILL_DEFERRED,
        RECHECK_CELL_STATUS.STILL_DEFERRED,
      ],
    );
    assert.ok(existsSync(join(outDir, "recheck.json")));

    const r2 = runCli([
      "recheck-deferred",
      "--out",
      outDir,
      "--json",
      "--require-cleared",
    ]);
    assert.equal(r2.status, 1, "require-cleared should fail while still deferred");
  });
});

test("cli recheck-deferred: --include non-deferred refused", () => {
  const r = runCli([
    "recheck-deferred",
    "--include",
    "migration-checklist",
    "--json",
  ]);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stderr || r.stdout);
  assert.equal(out.error, "non_deferred_refused");
  assert.ok(out.unknownIds.includes("migration-checklist"));
});

test("cli recheck-deferred: --include subset of deferred", () => {
  withTempOut((outDir) => {
    const r = runCli([
      "recheck-deferred",
      "--include",
      "table-reconcile",
      "--out",
      outDir,
      "--json",
    ]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.cells.length, 1);
    assert.equal(out.cells[0].id, "table-reconcile");
    assert.equal(out.cells[0].status, RECHECK_CELL_STATUS.STILL_DEFERRED);
  });
});
