/**
 * Deferred Heavy cell recheck harness (S159).
 *
 * Re-runs ONLY deferred Heavy recipes (table-reconcile / link-index /
 * replay-pack) against their known positive fixtures, records actual CLI
 * decisions, and emits a delta vs KNOWN_EXTERNAL_HEAVY_DEFECTS / S152 matrix.
 *
 * Records truth — does not invent pass / cleared. `cleared` only when
 * actualDecision === "pass" from a real (or injected) CLI result.
 * Green bundle remains the buyer path until deferred cells clear.
 *
 * Reuses acquisition-status constants + 08 assemble spawn helpers — no truth fork.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runHeavyAnalyzeRecipe,
  SIBLING_S137_ROOT,
  PACKAGE_ROOT as EIGHT_PACKAGE_ROOT,
} from "../../08/src/assemble.mjs";
import { DEFAULT_OPERATOR_CLOCK } from "../../08/src/constants.mjs";
import {
  COMPOSE_ROOT,
  KNOWN_EXTERNAL_HEAVY_DEFECTS,
  S152_POSITIVE_PARTIAL_MATRIX,
} from "./acquisition-status.mjs";
import {
  EXPECTED_HEAVY_RESOLVED_COMMIT,
  deferredExternalDefectsFromMatrix,
  deferredRecipeIds,
} from "./first-result.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFERRED_RECHECK_SCHEMA = "x402.r2.consumer.deferred_recheck.v1";

export const RECHECK_CELL_STATUS = Object.freeze({
  STILL_DEFERRED: "still_deferred",
  CLEARED: "cleared",
  UNEXPECTED: "unexpected",
});

export const DEFAULT_RECHECK_OUT_DIR = join(
  COMPOSE_ROOT,
  "demo-out",
  "deferred-recheck",
);

const ANALYZE_FAIL_KIND = "heavy_cli_analyze_fail";

/**
 * Deferred ids from matrix + KNOWN_EXTERNAL_HEAVY_DEFECTS (no fork).
 */
export function knownDeferredIds(options = {}) {
  return deferredRecipeIds(options.matrix || S152_POSITIVE_PARTIAL_MATRIX);
}

function analyzeFailDefect(known = KNOWN_EXTERNAL_HEAVY_DEFECTS) {
  return known.find((d) => d.kind === ANALYZE_FAIL_KIND) || null;
}

function expectedDefectForId(id, options = {}) {
  const known = options.knownExternalHeavyDefects || KNOWN_EXTERNAL_HEAVY_DEFECTS;
  const defect = analyzeFailDefect(known);
  const matrix = options.matrix || S152_POSITIVE_PARTIAL_MATRIX;
  const row = matrix.find((r) => r.id === id);
  return {
    kind: defect?.kind || ANALYZE_FAIL_KIND,
    expectedDecision: row?.heavyDecision ?? "fail",
    expectedSlotStatus: row?.slotStatus ?? "failed",
    jobRef: row?.jobRef || null,
    note:
      defect?.note ||
      "Heavy CLI analyze on synthetic positive cases returns fail (external defect).",
  };
}

/**
 * Resolve which deferred ids to recheck.
 * Default: all known deferred. `--include` must list known deferred ids only.
 */
export function assertDeferredInclude(includeIds, options = {}) {
  const deferred = knownDeferredIds(options);
  const deferredSet = new Set(deferred);
  const requested = Array.isArray(includeIds) ? includeIds.filter(Boolean) : [];

  if (!requested.length) {
    return deferred;
  }

  const unknown = [...new Set(requested.filter((id) => !deferredSet.has(id)))];
  if (unknown.length) {
    const err = new Error(
      `Refused: --include id(s) are not known deferred Heavy cells: ${unknown.join(", ")}. Known deferred: ${deferred.join(", ")}. Green / non-deferred recipes are not rechecked on this path.`,
    );
    err.code = "non_deferred_refused";
    err.unknownIds = unknown;
    err.deferredIds = deferred;
    throw err;
  }

  return [...new Set(requested)];
}

/**
 * Map actual CLI decision → cell status.
 * cleared ONLY when actualDecision === "pass" (never invent).
 */
export function classifyRecheckCell(actualDecision, _options = {}) {
  // cleared ONLY on literal pass from CLI — never invent.
  if (actualDecision === "pass") {
    return RECHECK_CELL_STATUS.CLEARED;
  }
  // Known deferred defect signature on positive fixtures.
  if (actualDecision === "fail") {
    return RECHECK_CELL_STATUS.STILL_DEFERRED;
  }
  // Missing decision, conflict, or other non-fail/non-pass → unexpected.
  return RECHECK_CELL_STATUS.UNEXPECTED;
}

/**
 * Default spawn: real Heavy CLI via 08 assemble helper (same as green-bundle).
 * Inject `spawnRecipe` in tests to stub decisions without inventing.
 */
export function defaultSpawnDeferredRecipe(recipeId, options = {}) {
  const clock = options.clock || DEFAULT_OPERATOR_CLOCK;
  const outDir = options.outDir || DEFAULT_RECHECK_OUT_DIR;
  const packetsDir = join(outDir, "packets");
  mkdirSync(packetsDir, { recursive: true });
  const packetPath = join(packetsDir, `${recipeId}.json`);

  const run = runHeavyAnalyzeRecipe(recipeId, {
    ...options,
    clockIso: clock,
    operatorClock: clock,
    outPath: packetPath,
    heavyOutDir: packetsDir,
    packageRoot: options.packageRoot || EIGHT_PACKAGE_ROOT,
    s137Root: options.s137Root || SIBLING_S137_ROOT,
  });

  if (run.output) {
    writeFileSync(packetPath, JSON.stringify(run.output, null, 2) + "\n");
  } else {
    writeFileSync(
      packetPath,
      JSON.stringify(
        {
          recipeId,
          status: run.status,
          decision: run.decision ?? null,
          error: run.error,
          stderr: run.stderr,
          parseError: run.parseError,
        },
        null,
        2,
      ) + "\n",
    );
  }

  return {
    id: recipeId,
    decision: run.decision ?? null,
    slotStatus: run.status ?? null,
    exitCode: run.exitCode ?? null,
    fixture: run.inPath || null,
    packetPath,
    error: run.error || null,
    stderr: run.stderr || null,
    output: run.output || null,
    spawnSource: "heavy_cli",
  };
}

/**
 * Recheck one deferred cell. Does not invent cleared.
 */
export function recheckDeferredCell(recipeId, options = {}) {
  const expected = expectedDefectForId(recipeId, options);
  const spawn = options.spawnRecipe || defaultSpawnDeferredRecipe;
  const run = spawn(recipeId, options);

  const actualDecision = run?.decision ?? null;
  // Hard guard: never treat missing/undefined as pass; cleared only on literal "pass".
  const status = classifyRecheckCell(actualDecision, {
    expectedDecision: expected.expectedDecision,
  });

  if (status === RECHECK_CELL_STATUS.CLEARED && actualDecision !== "pass") {
    // Defensive: classification must never clear without real pass.
    const err = new Error(
      `Invariant violation: cleared without actualDecision===pass (got ${actualDecision})`,
    );
    err.code = "invent_cleared_refused";
    throw err;
  }

  return {
    id: recipeId,
    jobRef: expected.jobRef,
    expectedDefect: {
      kind: expected.kind,
      expectedDecision: expected.expectedDecision,
      expectedSlotStatus: expected.expectedSlotStatus,
      note: expected.note,
    },
    actualDecision,
    actualSlotStatus: run?.slotStatus ?? null,
    status,
    exitCode: run?.exitCode ?? null,
    fixture: run?.fixture ?? null,
    packetPath: run?.packetPath ?? null,
    error: run?.error ?? null,
    spawnSource: run?.spawnSource || (options.spawnRecipe ? "injected" : "heavy_cli"),
    matrixRow: S152_POSITIVE_PARTIAL_MATRIX.find((r) => r.id === recipeId) || null,
    delta: {
      vsMatrixHeavyDecision: expected.expectedDecision,
      vsKnownDefectKind: expected.kind,
      decisionChanged: actualDecision !== expected.expectedDecision,
      cleared: status === RECHECK_CELL_STATUS.CLEARED,
    },
  };
}

/**
 * Run deferred-cell recheck harness.
 *
 * @param {object} [options]
 * @param {string[]} [options.includeIds] - subset of known deferred ids
 * @param {string} [options.clock]
 * @param {string} [options.outDir]
 * @param {boolean} [options.write=true]
 * @param {function} [options.spawnRecipe] - inject for stubbed tests
 */
export function runDeferredRecheck(options = {}) {
  const clock = options.clock || DEFAULT_OPERATOR_CLOCK;
  const selectedIds = assertDeferredInclude(options.includeIds || [], options);
  const outDir = resolve(options.outDir || DEFAULT_RECHECK_OUT_DIR);
  const write = options.write !== false;

  if (write) {
    mkdirSync(join(outDir, "packets"), { recursive: true });
  }

  const cells = [];
  for (const id of selectedIds) {
    cells.push(
      recheckDeferredCell(id, {
        ...options,
        clock,
        outDir,
      }),
    );
  }

  const stillDeferred = cells.filter(
    (c) => c.status === RECHECK_CELL_STATUS.STILL_DEFERRED,
  );
  const cleared = cells.filter((c) => c.status === RECHECK_CELL_STATUS.CLEARED);
  const unexpected = cells.filter(
    (c) => c.status === RECHECK_CELL_STATUS.UNEXPECTED,
  );

  const anyStillDeferred = stillDeferred.length > 0;
  const allCleared = cells.length > 0 && cleared.length === cells.length;

  // Overall remains partial while any still_deferred — never invent full clear.
  const packageNote = anyStillDeferred
    ? "partial_deferred_recheck"
    : allCleared
      ? "deferred_cells_cleared"
      : "deferred_recheck_unexpected";

  // Remains partial while any still_deferred (or unexpected); never invent ready.
  const packageStatusHint = "partial";

  const deferredCatalog = deferredExternalDefectsFromMatrix(
    options.matrix,
    options.knownExternalHeavyDefects,
  );

  const doc = {
    schema: DEFERRED_RECHECK_SCHEMA,
    packageNote,
    packageStatusHint,
    // fullPackageReady stays false until a separate acquisition path promotes;
    // this harness never claims full package ready.
    fullPackageReady: false,
    acquisitionOk: true,
    overallStillDeferred: anyStillDeferred,
    clock,
    cells,
    summary: {
      recheckedCount: cells.length,
      stillDeferredCount: stillDeferred.length,
      clearedCount: cleared.length,
      unexpectedCount: unexpected.length,
      stillDeferredIds: stillDeferred.map((c) => c.id),
      clearedIds: cleared.map((c) => c.id),
      unexpectedIds: unexpected.map((c) => c.id),
    },
    deltaVsKnownDefects: {
      knownAnalyzeFailIds: analyzeFailDefect(
        options.knownExternalHeavyDefects || KNOWN_EXTERNAL_HEAVY_DEFECTS,
      )?.ids || knownDeferredIds(options),
      stillMatchingDefect: stillDeferred.map((c) => ({
        id: c.id,
        kind: c.expectedDefect.kind,
        actualDecision: c.actualDecision,
      })),
      newlyCleared: cleared.map((c) => ({
        id: c.id,
        previousExpected: c.expectedDefect.expectedDecision,
        actualDecision: c.actualDecision,
      })),
      unexpectedOutcomes: unexpected.map((c) => ({
        id: c.id,
        expectedDecision: c.expectedDefect.expectedDecision,
        actualDecision: c.actualDecision,
      })),
    },
    deferredExternalDefects: deferredCatalog,
    knownExternalHeavyDefects: [
      ...(options.knownExternalHeavyDefects || KNOWN_EXTERNAL_HEAVY_DEFECTS),
    ],
    s152MatrixDeferred: S152_POSITIVE_PARTIAL_MATRIX.filter(
      (r) => r.slotStatus === "failed" || r.heavyDecision === "fail",
    ),
    resolvedCommits: {
      heavyResolvedInputCommit: EXPECTED_HEAVY_RESOLVED_COMMIT,
      expectedHeavyResolvedCommit: EXPECTED_HEAVY_RESOLVED_COMMIT,
    },
    outDir,
    recheckPath: join(outDir, "recheck.json"),
    mode: "deferred_cell_recheck",
    notes: [
      "Records actual Heavy CLI decisions for deferred cells only (03/04/05).",
      "Does not invent pass or cleared — cleared only when actualDecision===pass from real CLI.",
      "Overall remains partial while any cell is still_deferred.",
      "Green bundle remains the buyer path until deferred cells clear.",
      "Fixture URLs stay data (no fetch). No investment/revenue/ranking/escrow/custody claims.",
      "Does not invent release-brief conflict outcomes.",
    ],
  };

  if (write) {
    writeFileSync(doc.recheckPath, JSON.stringify(doc, null, 2) + "\n");
  }

  return doc;
}

/**
 * Refuse inventing a cleared cell without a real pass packet/decision.
 */
export function assertClearedRequiresPass(cell) {
  if (cell?.status === RECHECK_CELL_STATUS.CLEARED && cell.actualDecision !== "pass") {
    const err = new Error(
      `Refused inventing cleared for ${cell.id}: actualDecision=${cell.actualDecision} (require pass)`,
    );
    err.code = "invent_cleared_refused";
    throw err;
  }
  return true;
}

export function formatDeferredRecheckTable(doc) {
  const rows = [
    "id                         jobRef                   expected  actual   status",
    "-------------------------  -----------------------  --------  -------  --------------",
  ];
  for (const c of doc.cells || []) {
    const id = String(c.id || "").padEnd(25);
    const job = String(c.jobRef || "—").padEnd(23);
    const exp = String(c.expectedDefect?.expectedDecision || "—").padEnd(8);
    const act = String(c.actualDecision ?? "—").padEnd(7);
    const st = String(c.status || "—");
    rows.push(`${id}  ${job}  ${exp}  ${act}  ${st}`);
  }
  rows.push("");
  rows.push(
    `packageNote: ${doc.packageNote}   overallStillDeferred: ${doc.overallStillDeferred}   schema: ${doc.schema}`,
  );
  rows.push(
    `still_deferred: ${(doc.summary?.stillDeferredIds || []).join(", ") || "—"}`,
  );
  rows.push(`cleared: ${(doc.summary?.clearedIds || []).join(", ") || "—"}`);
  rows.push(
    `unexpected: ${(doc.summary?.unexpectedIds || []).join(", ") || "—"}`,
  );
  rows.push(`outDir: ${doc.outDir}`);
  rows.push(
    "Note: green bundle remains buyer path until deferred clear; this tool records truth only.",
  );
  return rows.join("\n");
}

/**
 * Exit: 0 when harness ran (even if still_deferred — recording truth is success).
 * Non-zero on tool errors / refused includes.
 * Optional: options.requireCleared → 1 if any still_deferred.
 */
export function deferredRecheckExitCode(docOrError, options = {}) {
  if (docOrError && docOrError.schema === DEFERRED_RECHECK_SCHEMA) {
    if (options.requireCleared && docOrError.overallStillDeferred) {
      return 1;
    }
    return 0;
  }
  return 1;
}

export {
  COMPOSE_ROOT,
  DEFAULT_OPERATOR_CLOCK,
  EXPECTED_HEAVY_RESOLVED_COMMIT,
  KNOWN_EXTERNAL_HEAVY_DEFECTS,
  S152_POSITIVE_PARTIAL_MATRIX,
};
