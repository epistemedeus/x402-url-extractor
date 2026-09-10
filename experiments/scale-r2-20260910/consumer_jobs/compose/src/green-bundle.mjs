/**
 * Offline green-only executed first-result bundle (S159).
 *
 * Spawns only confirmed-pass / ready recipes from S152_POSITIVE_PARTIAL_MATRIX
 * against default fixtures (Heavy CLI for 01/02/06; sibling 07 for
 * procurement-brief). Deferred Heavy 03/04/05 remain documented external
 * defects — never run-as-pass, never invent.
 *
 * Reuses first-result offer / matrix constants; does not fork truth.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runHeavyAnalyzeRecipe,
  runProcurementBriefRecipe,
  SIBLING_07_ROOT,
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
  PACKAGE_NOTE_PARTIAL_FIRST_RESULT,
  assertRecipesAllowed,
  buildFirstResultOffer,
  deferredExternalDefectsFromMatrix,
  offeredRecipeIds,
} from "./first-result.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const GREEN_FIRST_RESULT_BUNDLE_SCHEMA =
  "x402.r2.consumer.green_first_result_bundle.v1";

export const DEFAULT_GREEN_BUNDLE_OUT_DIR = join(
  COMPOSE_ROOT,
  "demo-out",
  "green-bundle",
);

const HEAVY_GREEN_IDS = new Set([
  "migration-checklist",
  "release-brief",
  "freshness-receipt",
]);

function defaultProcurementFixture() {
  const sibling = join(SIBLING_07_ROOT, "fixtures", "positive.json");
  if (existsSync(sibling)) return sibling;
  const local = join(EIGHT_PACKAGE_ROOT, "fixtures", "procurement-brief-positive.json");
  if (existsSync(local)) return local;
  return sibling;
}

/**
 * Execute one green recipe against its default fixture. Deferred ids refused
 * by caller via assertRecipesAllowed.
 */
export function executeGreenRecipe(recipeId, options = {}) {
  const clock = options.clock || DEFAULT_OPERATOR_CLOCK;
  const outDir = options.outDir || DEFAULT_GREEN_BUNDLE_OUT_DIR;
  const packetsDir = join(outDir, "packets");
  mkdirSync(packetsDir, { recursive: true });
  const packetPath = join(packetsDir, `${recipeId}.json`);

  if (recipeId === "procurement-brief") {
    const fixture = options.procurementFixture || defaultProcurementFixture();
    const run = runProcurementBriefRecipe(fixture, options);
    const packet = {
      recipeId,
      jobRef: "R2-CONSUMER-JOBS-07",
      kind: "sibling_07_brief",
      slotStatus: run.status,
      heavyDecision: null,
      exitCode: run.exitCode,
      fixture,
      generatedAt: run.output?.generatedAt || null,
      output: run.output,
      stderr: run.stderr,
      parseError: run.parseError || null,
      error: run.error || null,
    };
    writeFileSync(packetPath, JSON.stringify(packet, null, 2) + "\n");
    return {
      id: recipeId,
      jobRef: "R2-CONSUMER-JOBS-07",
      kind: "sibling_07_brief",
      slotStatus: run.status,
      heavyDecision: null,
      offered: true,
      executed: true,
      exitCode: run.exitCode,
      fixture,
      packetPath,
      ok: run.status === "ready" || run.status === "partial",
      outputSchema: run.output?.schema || null,
      outputStatus: run.output?.status || null,
    };
  }

  if (!HEAVY_GREEN_IDS.has(recipeId)) {
    const err = new Error(
      `Not a green executable recipe on this path: ${recipeId}. Offered: ${offeredRecipeIds().join(", ")}`,
    );
    err.code = "unknown_recipe";
    throw err;
  }

  const run = runHeavyAnalyzeRecipe(recipeId, {
    ...options,
    clockIso: clock,
    operatorClock: clock,
    outPath: packetPath,
    heavyOutDir: packetsDir,
    packageRoot: options.packageRoot || EIGHT_PACKAGE_ROOT,
    s137Root: options.s137Root || SIBLING_S137_ROOT,
  });

  // Prefer writing the raw Heavy packet body when present (buyer-facing artifact).
  if (run.output) {
    writeFileSync(packetPath, JSON.stringify(run.output, null, 2) + "\n");
  } else {
    writeFileSync(
      packetPath,
      JSON.stringify(
        {
          recipeId,
          status: run.status,
          error: run.error,
          stderr: run.stderr,
          parseError: run.parseError,
        },
        null,
        2,
      ) + "\n",
    );
  }

  const matrixRow = S152_POSITIVE_PARTIAL_MATRIX.find((r) => r.id === recipeId);
  return {
    id: recipeId,
    jobRef: matrixRow?.jobRef || null,
    kind: "heavy_analyze",
    slotStatus: run.status,
    heavyDecision: run.decision ?? null,
    offered: true,
    executed: true,
    exitCode: run.exitCode,
    fixture: run.inPath || null,
    packetPath,
    ok: run.decision === "pass" && run.status === "ready",
    outputSchema: run.packetSchema || run.output?.schema || null,
    error: run.error || null,
  };
}

/**
 * Build + execute offline green-only first-result bundle.
 *
 * @param {object} [options]
 * @param {string[]} [options.recipeIds] - subset of green ids; deferred → throw
 * @param {string} [options.clock]
 * @param {string} [options.outDir] - default demo-out/green-bundle
 * @param {boolean} [options.write=true]
 */
export function executeGreenFirstResultBundle(options = {}) {
  const clock = options.clock || DEFAULT_OPERATOR_CLOCK;
  const selectedIds = assertRecipesAllowed(options.recipeIds || [], options);
  const outDir = resolve(options.outDir || DEFAULT_GREEN_BUNDLE_OUT_DIR);
  const write = options.write !== false;

  if (write) {
    mkdirSync(join(outDir, "packets"), { recursive: true });
  }

  const offer = buildFirstResultOffer({
    ...options,
    recipeIds: selectedIds,
    clock,
    mode: "execute",
  });

  const results = [];
  for (const id of selectedIds) {
    const row = executeGreenRecipe(id, {
      ...options,
      clock,
      outDir,
    });
    results.push(row);
  }

  const deferredExternalDefects = deferredExternalDefectsFromMatrix(
    options.matrix,
    options.knownExternalHeavyDefects,
  );

  const allOk = results.length > 0 && results.every((r) => r.ok);
  const bundle = {
    schema: GREEN_FIRST_RESULT_BUNDLE_SCHEMA,
    packageNote: PACKAGE_NOTE_PARTIAL_FIRST_RESULT,
    packageStatusHint: "partial",
    firstResultReady: true,
    acquisitionOk: true,
    executedOk: allOk,
    fullPackageReady: false,
    clock,
    offered: offer.offered.map((o) => {
      const exec = results.find((r) => r.id === o.id);
      return {
        id: o.id,
        jobRef: o.jobRef,
        slotStatus: o.slotStatus,
        heavyDecision: o.heavyDecision,
        offered: true,
        executed: Boolean(exec?.executed),
        executionOk: exec?.ok ?? false,
        executionSlotStatus: exec?.slotStatus ?? null,
        executionHeavyDecision: exec?.heavyDecision ?? null,
        packetPath: exec?.packetPath ?? null,
        fixture: exec?.fixture ?? null,
        outputSchema: exec?.outputSchema ?? null,
      };
    }),
    results,
    deferredExternalDefects,
    knownExternalHeavyDefects: [
      ...(options.knownExternalHeavyDefects || KNOWN_EXTERNAL_HEAVY_DEFECTS),
    ],
    resolvedCommits: offer.resolvedCommits,
    outDir,
    bundlePath: join(outDir, "bundle.json"),
    mode: "executed_green_bundle",
    notes: [
      "Executed only S152 matrix green slots (ready): migration-checklist, release-brief, freshness-receipt, procurement-brief.",
      "Deferred 03/04/05 are external Heavy CLI analyze fails — not unavailable_pending_heavy; do not invent pass; never run-as-pass on this lane.",
      "packageNote is partial_first_result — never full package ready.",
      "Offline only: Heavy CLI + sibling 07 against default fixtures. Fixture URLs stay data (no fetch).",
      "No investment, revenue, ranking, escrow, or custody claims.",
    ],
  };

  if (write) {
    writeFileSync(bundle.bundlePath, JSON.stringify(bundle, null, 2) + "\n");
  }

  return bundle;
}

export function formatGreenBundleTable(bundle) {
  const rows = [
    "id                         jobRef                   execOk  heavyDecision  packet",
    "-------------------------  -----------------------  ------  -------------  ------",
  ];
  for (const r of bundle.results || []) {
    const id = String(r.id || "").padEnd(25);
    const job = String(r.jobRef || "—").padEnd(23);
    const ok = String(r.ok).padEnd(6);
    const dec = r.heavyDecision == null ? "—" : String(r.heavyDecision);
    const pkt = r.packetPath ? "yes" : "no";
    rows.push(`${id}  ${job}  ${ok}  ${dec.padEnd(13)}  ${pkt}`);
  }
  rows.push("");
  rows.push("deferred (external Heavy defects — NOT executed):");
  for (const r of bundle.deferredExternalDefects || []) {
    rows.push(
      `  - ${r.id} (${r.jobRef}) heavyDecision=${r.heavyDecision} kind=${r.kind}`,
    );
  }
  rows.push("");
  rows.push(
    `packageNote: ${bundle.packageNote}   fullPackageReady: ${bundle.fullPackageReady}   schema: ${bundle.schema}`,
  );
  rows.push(`outDir: ${bundle.outDir}`);
  rows.push(
    `heavyResolvedInputCommit: ${bundle.resolvedCommits?.heavyResolvedInputCommit || "—"}`,
  );
  return rows.join("\n");
}

export function greenBundleExitCode(bundleOrError) {
  if (bundleOrError && bundleOrError.schema === GREEN_FIRST_RESULT_BUNDLE_SCHEMA) {
    return bundleOrError.acquisitionOk && bundleOrError.executedOk ? 0 : 1;
  }
  return 1;
}

export {
  COMPOSE_ROOT,
  DEFAULT_OPERATOR_CLOCK,
  PACKAGE_NOTE_PARTIAL_FIRST_RESULT,
  EXPECTED_HEAVY_RESOLVED_COMMIT,
  S152_POSITIVE_PARTIAL_MATRIX,
  KNOWN_EXTERNAL_HEAVY_DEFECTS,
};
