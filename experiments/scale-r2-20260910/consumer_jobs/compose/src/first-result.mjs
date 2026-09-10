/**
 * Truthful first-result acquisition path (S159).
 *
 * Offers only confirmed-pass / ready slots from S152_POSITIVE_PARTIAL_MATRIX.
 * Deferred Heavy CLI fails (03/04/05) are documented as external defects —
 * never invented pass, never unavailable_pending_heavy.
 *
 * Reuses acquisition-status matrix constants; does not fork truth.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRecipeCatalog } from "../../08/src/assemble.mjs";
import { DEFAULT_OPERATOR_CLOCK } from "../../08/src/constants.mjs";
import {
  COMPOSE_ROOT,
  EIGHT_ROOT,
  KNOWN_EXTERNAL_HEAVY_DEFECTS,
  S152_POSITIVE_PARTIAL_MATRIX,
} from "./acquisition-status.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const FIRST_RESULT_OFFER_SCHEMA = "x402.r2.consumer.first_result_offer.v1";
export const PACKAGE_NOTE_PARTIAL_FIRST_RESULT = "partial_first_result";
export const PACKAGE_NOTE_FIRST_RESULT_READY = "first_result_ready";

/** Heavy pack pin used by compose / S152 (resolved if pin file present). */
export const EXPECTED_HEAVY_RESOLVED_COMMIT =
  "fa6878de125cfdcfd77f4b47037c88667090d293";

const S137_ROOT = join(__dirname, "..", "..", "..", "..", "s137-consumer-evidence-jobs");

/**
 * Green (offered) rows: slotStatus ready from the exact S152 matrix.
 */
export function offeredRecipesFromMatrix(matrix = S152_POSITIVE_PARTIAL_MATRIX) {
  return matrix
    .filter((row) => row.slotStatus === "ready")
    .map((row) => ({
      id: row.id,
      jobRef: row.jobRef,
      slotStatus: row.slotStatus,
      heavyDecision: row.heavyDecision,
      offered: true,
    }));
}

/**
 * Deferred external Heavy analyze fails (03/04/05) — not offered.
 * Sourced from matrix fail rows + KNOWN_EXTERNAL_HEAVY_DEFECTS (no fork).
 */
export function deferredExternalDefectsFromMatrix(
  matrix = S152_POSITIVE_PARTIAL_MATRIX,
  known = KNOWN_EXTERNAL_HEAVY_DEFECTS,
) {
  const failRows = matrix.filter(
    (row) => row.slotStatus === "failed" || row.heavyDecision === "fail",
  );
  const analyzeDefect = known.find((d) => d.kind === "heavy_cli_analyze_fail");
  const defectIds = new Set(analyzeDefect?.ids || failRows.map((r) => r.id));
  return failRows
    .filter((row) => defectIds.has(row.id))
    .map((row) => ({
      id: row.id,
      jobRef: row.jobRef,
      slotStatus: row.slotStatus,
      heavyDecision: row.heavyDecision,
      offered: false,
      kind: "heavy_cli_analyze_fail",
      note:
        analyzeDefect?.note ||
        "Heavy CLI analyze on synthetic positive cases returns fail (external defect). Compose records real fail — not unavailable_pending_heavy.",
    }));
}

export function offeredRecipeIds(matrix = S152_POSITIVE_PARTIAL_MATRIX) {
  return offeredRecipesFromMatrix(matrix).map((r) => r.id);
}

export function deferredRecipeIds(matrix = S152_POSITIVE_PARTIAL_MATRIX) {
  return deferredExternalDefectsFromMatrix(matrix).map((r) => r.id);
}

/**
 * Refuse any request that includes a deferred (external Heavy fail) recipe id.
 */
export function assertRecipesAllowed(recipeIds, options = {}) {
  const deferred = new Set(deferredRecipeIds(options.matrix));
  const requested = Array.isArray(recipeIds) ? recipeIds : [];
  const refused = [...new Set(requested.filter((id) => deferred.has(id)))];
  if (refused.length) {
    const err = new Error(
      `Refused: recipe id(s) deferred as external Heavy CLI defects (not offered on first-result path): ${refused.join(", ")}. Use only: ${offeredRecipeIds(options.matrix).join(", ")}`,
    );
    err.code = "deferred_recipe_refused";
    err.refusedIds = refused;
    err.offeredIds = offeredRecipeIds(options.matrix);
    throw err;
  }
  const offered = new Set(offeredRecipeIds(options.matrix));
  const unknown = [...new Set(requested.filter((id) => !offered.has(id)))];
  if (unknown.length) {
    const err = new Error(
      `Unknown or not-offered recipe id(s) on first-result path: ${unknown.join(", ")}. Offered: ${[...offered].join(", ")}`,
    );
    err.code = "unknown_recipe";
    err.unknownIds = unknown;
    err.offeredIds = [...offered];
    throw err;
  }
  return requested.length ? [...new Set(requested)] : offeredRecipeIds(options.matrix);
}

function readHeavyResolvedCommit(s137Root = S137_ROOT) {
  const pinPath = join(s137Root, "RESOLVED-INPUT-COMMIT.txt");
  if (!existsSync(pinPath)) {
    return {
      resolvedInputCommit: null,
      pinPath,
      note: "RESOLVED-INPUT-COMMIT.txt not found; expected pin documented in FROZEN-E2E-PACKET-S152.md",
    };
  }
  const text = readFileSync(pinPath, "utf8");
  const m = text.match(/([0-9a-f]{40})/i);
  return {
    resolvedInputCommit: m ? m[1].toLowerCase() : null,
    pinPath,
    raw: text.trim(),
  };
}

function enrichOfferedWithCatalog(offered, options = {}) {
  let catalog = null;
  try {
    catalog = options.catalog || loadRecipeCatalog(options.recipesDir);
  } catch {
    catalog = null;
  }
  return offered.map((row) => {
    const recipe = catalog?.get?.(row.id);
    const defaultIn = recipe?.cli?.defaultIn || null;
    const siblingPath = recipe?.cli?.siblingPath || recipe?.cli?.path || null;
    return {
      ...row,
      title: recipe?.title || row.id,
      defaultIn,
      cliPath: siblingPath,
      catalogStatus: recipe?.status || null,
    };
  });
}

/**
 * Build truthful first-result offer (dry-assemble by default — no Heavy spawn).
 *
 * @param {object} [options]
 * @param {string[]} [options.recipeIds] - subset of green ids; deferred → throw
 * @param {string} [options.clock] - operator clock ISO
 * @param {boolean} [options.enrichCatalog=true] - attach catalog defaultIn/cli
 */
export function buildFirstResultOffer(options = {}) {
  const clock = options.clock || DEFAULT_OPERATOR_CLOCK;
  const selectedIds = assertRecipesAllowed(options.recipeIds || [], options);
  const allOffered = offeredRecipesFromMatrix(options.matrix);
  const offered = allOffered.filter((r) => selectedIds.includes(r.id));
  const deferredExternalDefects = deferredExternalDefectsFromMatrix(
    options.matrix,
    options.knownExternalHeavyDefects,
  );
  const heavyPin = readHeavyResolvedCommit(options.s137Root || S137_ROOT);
  const enrich = options.enrichCatalog !== false;
  const offeredRows = enrich
    ? enrichOfferedWithCatalog(offered, options)
    : offered;

  // Honest package note: limited green path only — never claim full ready package.
  const packageNote =
    options.packageNote || PACKAGE_NOTE_PARTIAL_FIRST_RESULT;

  return {
    schema: FIRST_RESULT_OFFER_SCHEMA,
    packageNote,
    packageStatusHint: "partial",
    firstResultReady: true,
    acquisitionOk: true,
    clock,
    offered: offeredRows,
    deferredExternalDefects,
    knownExternalHeavyDefects: [
      ...(options.knownExternalHeavyDefects || KNOWN_EXTERNAL_HEAVY_DEFECTS),
    ],
    resolvedCommits: {
      heavyResolvedInputCommit:
        heavyPin.resolvedInputCommit || EXPECTED_HEAVY_RESOLVED_COMMIT,
      heavyPinVerified: Boolean(
        heavyPin.resolvedInputCommit &&
          heavyPin.resolvedInputCommit === EXPECTED_HEAVY_RESOLVED_COMMIT,
      ),
      expectedHeavyResolvedCommit: EXPECTED_HEAVY_RESOLVED_COMMIT,
    },
    mode: options.mode || "dry_offer",
    notes: [
      "Offers only S152 matrix green slots (ready): migration-checklist, release-brief, freshness-receipt, procurement-brief.",
      "Deferred 03/04/05 are external Heavy CLI analyze fails — not unavailable_pending_heavy; do not invent pass.",
      "packageNote is partial_first_result (or first_result_ready for this limited path) — never full package ready.",
      "No investment, revenue, ranking, escrow, or custody claims. Fixture URLs stay data.",
    ],
  };
}

/**
 * Optional: dry-assemble run plan for green recipes only (commands as data).
 * Does not spawn Heavy unless options.execute is true (caller responsibility).
 */
export function buildFirstResultRunPlan(options = {}) {
  const offer = buildFirstResultOffer({ ...options, mode: "run_plan" });
  const clock = offer.clock;
  const steps = offer.offered.map((row) => {
    if (row.id === "procurement-brief") {
      const fixture =
        options.procurementFixture ||
        join(EIGHT_ROOT, "..", "07", "fixtures", "positive.json");
      return {
        id: row.id,
        jobRef: row.jobRef,
        kind: "sibling_07_brief",
        command: [
          "node",
          join(EIGHT_ROOT, "..", "07", "src", "cli.mjs"),
          "brief",
          fixture,
        ],
        fixture,
        note: "Offline sibling 07 brief; fixture path is data until executed.",
      };
    }
    const defaultIn = row.defaultIn
      ? resolve(EIGHT_ROOT, row.defaultIn)
      : null;
    return {
      id: row.id,
      jobRef: row.jobRef,
      kind: "heavy_analyze",
      command: [
        "node",
        join(S137_ROOT, "scripts", "cli.mjs"),
        "analyze",
        row.id,
        "--in",
        defaultIn || "<defaultIn>",
        "--clock",
        clock,
      ],
      fixture: defaultIn,
      note: "Green Heavy recipe only; deferred 03/04/05 refused. Fixture URLs stay data.",
    };
  });
  return {
    ...offer,
    mode: "run_plan",
    steps,
    execute: false,
  };
}

export function formatFirstResultOfferTable(offer) {
  const rows = [
    "offered id                 jobRef                   slotStatus   heavyDecision",
    "-------------------------  -----------------------  -----------  -------------",
  ];
  for (const r of offer.offered || []) {
    const id = String(r.id || "").padEnd(25);
    const job = String(r.jobRef || "—").padEnd(23);
    const slot = String(r.slotStatus || "—").padEnd(11);
    const dec = r.heavyDecision == null ? "—" : String(r.heavyDecision);
    rows.push(`${id}  ${job}  ${slot}  ${dec}`);
  }
  rows.push("");
  rows.push("deferred (external Heavy defects — NOT offered):");
  for (const r of offer.deferredExternalDefects || []) {
    rows.push(`  - ${r.id} (${r.jobRef}) heavyDecision=${r.heavyDecision} kind=${r.kind}`);
  }
  rows.push("");
  rows.push(
    `packageNote: ${offer.packageNote}   packageStatusHint: ${offer.packageStatusHint}   schema: ${offer.schema}`,
  );
  rows.push(
    `heavyResolvedInputCommit: ${offer.resolvedCommits?.heavyResolvedInputCommit || "—"}`,
  );
  return rows.join("\n");
}

export function firstResultExitCode(offerOrError) {
  if (offerOrError && offerOrError.schema === FIRST_RESULT_OFFER_SCHEMA) {
    return offerOrError.acquisitionOk ? 0 : 1;
  }
  return 1;
}

export {
  COMPOSE_ROOT,
  EIGHT_ROOT,
  DEFAULT_OPERATOR_CLOCK,
  S152_POSITIVE_PARTIAL_MATRIX,
  KNOWN_EXTERNAL_HEAVY_DEFECTS,
};
