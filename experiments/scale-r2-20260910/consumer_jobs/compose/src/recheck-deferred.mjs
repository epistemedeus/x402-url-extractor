/**
 * Deferred Heavy cell recheck harness (S159 + S170/S169 S153 integration).
 *
 * Re-runs ONLY deferred Heavy recipes (table-reconcile / link-index /
 * replay-pack), records actual CLI **decision** fields (never treat ok===true
 * as pass), and emits a delta vs KNOWN_EXTERNAL_HEAVY_DEFECTS / S152 matrix.
 *
 * Default inputs (S170): S153 distribution kit examples via
 * experiments/s153-consumer-distribution-gates/kit/bin/cli.mjs
 * (delegates to sibling experiments/s137-consumer-evidence-jobs/scripts/cli.mjs).
 * Optional --inputs s137-synthetic points at prior S137 synthetic positives.
 *
 * Records truth — does not invent pass / cleared. `cleared` only when
 * actualDecision === "pass" from a real (or injected) CLI result.
 * Green bundle remains the buyer path until deferred cells clear.
 *
 * Status mapping (existing taxonomy):
 *   pass     → cleared
 *   fail     → still_deferred
 *   partial / conflict / missing / other → unexpected
 *
 * No parallel fork of Heavy 01–06 transforms. Kit excludes 07/08; native
 * compose/07+08 own those paths.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

/** experiments/ root (sibling of scale-r2-20260910). */
export const EXPERIMENTS_ROOT = resolve(COMPOSE_ROOT, "..", "..", "..");

/** Maintained S137 root in Git (honest pin — not a separate s137-consumer-evidence dirname). */
export const S137_ROOT = join(EXPERIMENTS_ROOT, "s137-consumer-evidence-jobs");

/** S153 distribution kit root (merchant head d520699…). */
export const S153_KIT_ROOT = join(
  EXPERIMENTS_ROOT,
  "s153-consumer-distribution-gates",
  "kit",
);

export const S153_KIT_CLI = join(S153_KIT_ROOT, "bin", "cli.mjs");
export const S153_KIT_EXAMPLES = join(S153_KIT_ROOT, "examples");
export const S153_KIT_TGZ = join(
  S153_KIT_ROOT,
  "dist",
  "s137-consumer-evidence-kit.tgz",
);

export const RESOLVED_S153_COMMIT = "d520699802622a715cde1d894cc5547c42b2dca7";

/** Input modes for deferred recheck. Default = S153 kit examples. */
export const RECHECK_INPUT_MODES = Object.freeze({
  S153_KIT: "s153-kit",
  S137_SYNTHETIC: "s137-synthetic",
});

/**
 * Default --in paths for deferred 03/04/05 under S153 kit examples.
 * Kit examples may return pass/partial/fail with cited findings — record decision, not ok.
 */
export const S153_KIT_DEFAULT_INS = Object.freeze({
  "table-reconcile": join(S153_KIT_EXAMPLES, "table-reconcile"),
  "link-index": join(S153_KIT_EXAMPLES, "link-index"),
  "replay-pack": join(S153_KIT_EXAMPLES, "replay-pack"),
});

/**
 * Legacy S137 synthetic positives (prior recheck / S152 defect signature).
 * Historically returned decision=fail on analyze — keep reachable via --inputs s137-synthetic.
 */
export const S137_SYNTHETIC_DEFAULT_INS = Object.freeze({
  "table-reconcile": join(
    S137_ROOT,
    "fixtures/synthetic/table-reconcile/cases/positive-agree.json",
  ),
  "link-index": join(
    S137_ROOT,
    "fixtures/synthetic/link-index/cases/positive-md",
  ),
  "replay-pack": join(
    S137_ROOT,
    "fixtures/synthetic/replay-pack/cases/positive-unpaid-complete",
  ),
});

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
 * Never treat packet ok===true as pass — callers must pass the decision field.
 *
 * Mapping (document for Lead):
 *   pass     → cleared
 *   fail     → still_deferred  (known external analyze-fail signature)
 *   partial  → unexpected      (truthful non-pass; not invent-cleared)
 *   conflict → unexpected
 *   missing/other → unexpected
 */
export function classifyRecheckCell(actualDecision, _options = {}) {
  if (actualDecision === "pass") {
    return RECHECK_CELL_STATUS.CLEARED;
  }
  if (actualDecision === "fail") {
    return RECHECK_CELL_STATUS.STILL_DEFERRED;
  }
  return RECHECK_CELL_STATUS.UNEXPECTED;
}

/**
 * Resolve input mode: s153-kit (default) | s137-synthetic.
 */
export function resolveRecheckInputMode(options = {}) {
  const raw = options.inputMode || options.inputs || RECHECK_INPUT_MODES.S153_KIT;
  if (
    raw === RECHECK_INPUT_MODES.S137_SYNTHETIC ||
    raw === "legacy" ||
    raw === "s137"
  ) {
    return RECHECK_INPUT_MODES.S137_SYNTHETIC;
  }
  return RECHECK_INPUT_MODES.S153_KIT;
}

/**
 * Default --in path for a deferred recipe under the selected input mode.
 */
export function defaultInPathForDeferred(recipeId, options = {}) {
  if (options.inPath) return options.inPath;
  const mode = resolveRecheckInputMode(options);
  const map =
    mode === RECHECK_INPUT_MODES.S137_SYNTHETIC
      ? S137_SYNTHETIC_DEFAULT_INS
      : S153_KIT_DEFAULT_INS;
  return map[recipeId] || null;
}

/**
 * Resolve CLI path. Default: S153 kit/bin/cli.mjs.
 */
export function defaultDeferredCliPath(options = {}) {
  if (options.cliPath) return options.cliPath;
  return S153_KIT_CLI;
}

function slotStatusFromDecision(decision) {
  if (decision === "pass") return "ready";
  if (decision === "fail") return "failed";
  if (decision === "partial") return "partial";
  if (decision === "conflict") return "conflict";
  return null;
}

/**
 * Spawn S153 kit CLI analyze directly. Verdict = decision field only (not ok).
 */
export function spawnS153KitAnalyze(recipeId, options = {}) {
  const clock = options.clock || DEFAULT_OPERATOR_CLOCK;
  const outDir = options.outDir || DEFAULT_RECHECK_OUT_DIR;
  const packetsDir = join(outDir, "packets");
  mkdirSync(packetsDir, { recursive: true });
  const packetPath = join(packetsDir, `${recipeId}.json`);
  const cliPath = defaultDeferredCliPath(options);
  const inPath = defaultInPathForDeferred(recipeId, options);
  const inputMode = resolveRecheckInputMode(options);

  if (!cliPath || !existsSync(cliPath)) {
    return {
      id: recipeId,
      decision: null,
      slotStatus: null,
      exitCode: null,
      fixture: inPath,
      packetPath,
      error: { code: "missing_cli", message: `S153 kit CLI not found: ${cliPath}` },
      stderr: null,
      output: null,
      spawnSource: "s153_kit",
      inputMode,
      cliPath,
      argv: null,
    };
  }
  if (!inPath || !existsSync(inPath)) {
    return {
      id: recipeId,
      decision: null,
      slotStatus: null,
      exitCode: null,
      fixture: inPath,
      packetPath,
      error: { code: "missing_in", message: `Deferred --in not found: ${inPath}` },
      stderr: null,
      output: null,
      spawnSource: "s153_kit",
      inputMode,
      cliPath,
      argv: null,
    };
  }

  const args = [
    cliPath,
    "analyze",
    recipeId,
    "--in",
    inPath,
    "--clock",
    clock,
    "--out",
    packetPath,
  ];
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    cwd: dirname(dirname(cliPath)),
    env: { ...process.env },
    maxBuffer: 8 * 1024 * 1024,
  });

  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  let output = null;
  let parseError = null;
  if (existsSync(packetPath)) {
    try {
      output = JSON.parse(readFileSync(packetPath, "utf8"));
    } catch (e) {
      parseError = e.message;
    }
  }
  if (!output && stdout) {
    try {
      output = JSON.parse(stdout);
      writeFileSync(packetPath, JSON.stringify(output, null, 2) + "\n");
    } catch (e) {
      parseError = e.message;
    }
  }
  if (!output) {
    writeFileSync(
      packetPath,
      JSON.stringify(
        {
          recipeId,
          decision: null,
          error: stderr || parseError || `Heavy CLI exited ${result.status}`,
          stderr,
          parseError,
        },
        null,
        2,
      ) + "\n",
    );
  }

  // CRITICAL: verdict from decision only — never ok===true
  const decision = output?.decision ?? null;

  return {
    id: recipeId,
    decision,
    slotStatus: slotStatusFromDecision(decision),
    exitCode: result.status,
    fixture: inPath,
    packetPath,
    error: output ? null : { code: "cli_no_packet", message: stderr || parseError || "no packet" },
    stderr: stderr || null,
    output,
    spawnSource: "s153_kit",
    inputMode,
    cliPath,
    argv: ["analyze", recipeId, "--in", inPath, "--clock", clock],
    okFieldIgnored: output?.ok ?? null,
  };
}

/**
 * Legacy spawn via 08 assemble helper (S137 synthetic recipe defaultIn).
 * Kept for --inputs s137-synthetic compatibility / comparison.
 */
export function spawnLegacyHeavyAssemble(recipeId, options = {}) {
  const clock = options.clock || DEFAULT_OPERATOR_CLOCK;
  const outDir = options.outDir || DEFAULT_RECHECK_OUT_DIR;
  const packetsDir = join(outDir, "packets");
  mkdirSync(packetsDir, { recursive: true });
  const packetPath = join(packetsDir, `${recipeId}.json`);
  const inPath = defaultInPathForDeferred(recipeId, {
    ...options,
    inputMode: RECHECK_INPUT_MODES.S137_SYNTHETIC,
  });

  const run = runHeavyAnalyzeRecipe(recipeId, {
    ...options,
    clockIso: clock,
    operatorClock: clock,
    outPath: packetPath,
    heavyOutDir: packetsDir,
    inPath,
    packageRoot: options.packageRoot || EIGHT_PACKAGE_ROOT,
    s137Root: options.s137Root || SIBLING_S137_ROOT || S137_ROOT,
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
    fixture: run.inPath || inPath || null,
    packetPath,
    error: run.error || null,
    stderr: run.stderr || null,
    output: run.output || null,
    spawnSource: "heavy_cli_legacy",
    inputMode: RECHECK_INPUT_MODES.S137_SYNTHETIC,
  };
}

/**
 * Default spawn: S153 kit CLI + kit examples (S170).
 * Pass inputMode/s137-synthetic to use legacy synthetic positives.
 * Inject `spawnRecipe` in tests to stub decisions without inventing.
 */
export function defaultSpawnDeferredRecipe(recipeId, options = {}) {
  const mode = resolveRecheckInputMode(options);
  if (mode === RECHECK_INPUT_MODES.S137_SYNTHETIC && options.useAssembleHelper) {
    return spawnLegacyHeavyAssemble(recipeId, options);
  }
  // Default + synthetic both go through kit/bin/cli.mjs with appropriate --in
  return spawnS153KitAnalyze(recipeId, options);
}

/**
 * Recheck one deferred cell. Does not invent cleared.
 */
export function recheckDeferredCell(recipeId, options = {}) {
  const expected = expectedDefectForId(recipeId, options);
  const spawn = options.spawnRecipe || defaultSpawnDeferredRecipe;
  const run = spawn(recipeId, options);

  const actualDecision = run?.decision ?? null;
  const status = classifyRecheckCell(actualDecision, {
    expectedDecision: expected.expectedDecision,
  });

  if (status === RECHECK_CELL_STATUS.CLEARED && actualDecision !== "pass") {
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
    spawnSource:
      run?.spawnSource || (options.spawnRecipe ? "injected" : "s153_kit"),
    inputMode: run?.inputMode || resolveRecheckInputMode(options),
    cliPath: run?.cliPath || null,
    argv: run?.argv || null,
    okFieldIgnored: run?.okFieldIgnored ?? null,
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
 */
export function runDeferredRecheck(options = {}) {
  const clock = options.clock || DEFAULT_OPERATOR_CLOCK;
  const selectedIds = assertDeferredInclude(options.includeIds || [], options);
  const outDir = resolve(options.outDir || DEFAULT_RECHECK_OUT_DIR);
  const write = options.write !== false;
  const inputMode = resolveRecheckInputMode(options);

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
        inputMode,
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

  const packageNote = anyStillDeferred
    ? "partial_deferred_recheck"
    : allCleared
      ? "deferred_cells_cleared"
      : unexpected.length
        ? "deferred_recheck_unexpected"
        : "deferred_recheck_empty";

  const packageStatusHint = "partial";

  const deferredCatalog = deferredExternalDefectsFromMatrix(
    options.matrix,
    options.knownExternalHeavyDefects,
  );

  const doc = {
    schema: DEFERRED_RECHECK_SCHEMA,
    packageNote,
    packageStatusHint,
    fullPackageReady: false,
    acquisitionOk: true,
    overallStillDeferred: anyStillDeferred,
    clock,
    inputMode,
    cliDefault: S153_KIT_CLI,
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
      knownAnalyzeFailIds:
        analyzeFailDefect(
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
      resolvedS153Commit: RESOLVED_S153_COMMIT,
      s137Root: "experiments/s137-consumer-evidence-jobs",
      s153Kit: "experiments/s153-consumer-distribution-gates/kit",
      s153KitTgz:
        "experiments/s153-consumer-distribution-gates/kit/dist/s137-consumer-evidence-kit.tgz",
    },
    kitExcludesJobs: ["R2-CONSUMER-JOBS-07", "R2-CONSUMER-JOBS-08"],
    statusMapping: {
      pass: "cleared",
      fail: "still_deferred",
      partial: "unexpected",
      conflict: "unexpected",
      missing: "unexpected",
      note: "cleared only if actualDecision===pass; never invent; never treat ok===true as pass",
    },
    outDir,
    recheckPath: join(outDir, "recheck.json"),
    mode: "deferred_cell_recheck",
    notes: [
      "Records actual Heavy CLI decisions for deferred cells only (03/04/05).",
      "Default CLI: experiments/s153-consumer-distribution-gates/kit/bin/cli.mjs",
      "Default --in: kit examples/table-reconcile|link-index|replay-pack",
      "Optional --inputs s137-synthetic for prior S137 synthetic positives.",
      "Does not invent pass or cleared — cleared only when actualDecision===pass from real CLI.",
      "Never treat packet ok===true as verdict pass — use decision field.",
      "Overall remains partial while any cell is still_deferred.",
      "Green bundle remains the buyer path until deferred cells clear.",
      "Kit excludes 07/08; native compose/07+08 own those paths.",
      "No parallel fork of Heavy 01–06 transforms.",
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
  rows.push(`inputMode: ${doc.inputMode}   cliDefault: ${doc.cliDefault}`);
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
