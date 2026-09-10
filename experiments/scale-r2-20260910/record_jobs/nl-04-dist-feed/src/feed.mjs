/**
 * NL-RECORD-04 — buildDistRepairFeed
 *
 * Calls sibling record_jobs/05 buildRouteRegressionReport (no parser rewrite),
 * maps each delta to a deterministic repair recommendation for Dist-06.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COVERAGE_NOTE,
  CONFIDENCE,
  DRY_RUN_NOTE,
  ERROR_CODES,
  FEED_SCHEMA,
  FEED_STATUS,
  MUTATION_BOUNDARY,
  PINS,
  RECOMMENDATION,
  REUSE_FROM,
  SCOPE_NOTE,
  USABLE_BY,
} from "./constants.mjs";
import { assertNoForbidden, feedError, isPlainObject } from "./validate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sibling05 = join(__dirname, "..", "..", "05", "src", "index.mjs");

// Dynamic import of sibling 05 — do not rewrite its parsers.
const { buildRouteRegressionReport, ROUTE_DELTA, REPORT_STATUS } =
  await import(sibling05);

/**
 * Detect incomplete / partial coverage on the *current* snapshot (raw).
 * Absence under incomplete current cannot prove global removal.
 */
export function isCurrentCaptureIncomplete(rawCurrent, routeReport) {
  if (!isPlainObject(rawCurrent)) {
    // No current object → treat as incomplete for removal safety.
    return true;
  }
  if (rawCurrent.captureIncomplete === true) return true;
  if (rawCurrent.partialCoverage === true) return true;
  if (rawCurrent.coverageComplete === false) return true;
  if (rawCurrent.incomplete === true) return true;
  if (typeof rawCurrent.coverage === "string") {
    const c = rawCurrent.coverage.toLowerCase();
    if (c === "incomplete" || c === "partial" || c === "partial_coverage") {
      return true;
    }
  }
  // Per-route incomplete observations on current side of report.
  if (routeReport?.diffs?.some((d) => d.current && d.current.incomplete === true)) {
    return true;
  }
  return false;
}

function unwrapInput(raw) {
  if (!isPlainObject(raw)) {
    throw feedError(ERROR_CODES.INVALID_INPUT, "input must be an object");
  }
  assertNoForbidden(raw, "input");

  if (isPlainObject(raw.routeRegressionInput)) {
    assertNoForbidden(raw.routeRegressionInput, "routeRegressionInput");
    return {
      regressionInput: raw.routeRegressionInput,
      distributionCite: raw.distributionCite ?? null,
      feedId: raw.feedId ?? raw.routeRegressionInput.reportId ?? null,
      demo: raw.demo === true || raw.routeRegressionInput.demo === true,
    };
  }

  if (raw.baseline != null && raw.current != null) {
    return {
      regressionInput: raw,
      distributionCite: raw.distributionCite ?? null,
      feedId: raw.feedId ?? raw.reportId ?? null,
      demo: raw.demo === true,
    };
  }

  throw feedError(
    ERROR_CODES.MISSING_REQUIREMENT,
    "Provide { baseline, current } or { routeRegressionInput }",
  );
}

/**
 * Map one route diff → repair recommendation (deterministic).
 */
export function mapDeltaToRecommendation(diff, { currentIncomplete }) {
  const routeKey = diff.routeKey;
  const delta = diff.delta;
  const base = {
    routeKey,
    delta,
    notes: [],
  };

  if (delta === ROUTE_DELTA.REMOVED) {
    if (currentIncomplete) {
      return {
        ...base,
        recommendation: RECOMMENDATION.CANNOT_PROVE_GLOBAL_REMOVAL,
        confidence: CONFIDENCE.LOW,
        coveragePreserved: true,
        notes: [
          "Current capture is incomplete/partial; absence cannot prove globally removed.",
          RECOMMENDATION.RECHECK_WITH_COMPLETE_CAPTURE,
          COVERAGE_NOTE,
        ],
        secondaryRecommendation: RECOMMENDATION.RECHECK_WITH_COMPLETE_CAPTURE,
      };
    }
    return {
      ...base,
      recommendation: RECOMMENDATION.RECOMMEND_DISTRIBUTION_RECHECK,
      confidence: CONFIDENCE.HIGH,
      coveragePreserved: false,
      notes: [
        RECOMMENDATION.SURFACE_BROKEN_OR_REMOVED_ROUTE,
        "Present in baseline, absent in complete current capture.",
      ],
      secondaryRecommendation: RECOMMENDATION.SURFACE_BROKEN_OR_REMOVED_ROUTE,
    };
  }

  if (delta === ROUTE_DELTA.REDIRECTED) {
    return {
      ...base,
      recommendation: RECOMMENDATION.UPDATE_LISTED_ROUTE_OR_REDIRECT_TARGET,
      confidence: CONFIDENCE.HIGH,
      coveragePreserved: !currentIncomplete,
      notes: ["finalUrl / redirect location changed between snapshots."],
    };
  }

  if (delta === ROUTE_DELTA.INACCESSIBLE) {
    return {
      ...base,
      recommendation: RECOMMENDATION.DIAGNOSE_ACCESS_OR_LISTING_PATH,
      confidence: CONFIDENCE.HIGH,
      coveragePreserved: !currentIncomplete,
      notes: ["Was reachable in baseline; now inaccessible in current."],
    };
  }

  if (delta === ROUTE_DELTA.RESTORED) {
    return {
      ...base,
      recommendation: RECOMMENDATION.CONFIRM_RESTORED_ROUTE_IN_LISTING,
      confidence: CONFIDENCE.MEDIUM,
      coveragePreserved: !currentIncomplete,
      notes: ["Was inaccessible in baseline; now reachable."],
    };
  }

  if (delta === ROUTE_DELTA.ADDED) {
    return {
      ...base,
      recommendation: RECOMMENDATION.CONSIDER_LISTING_NEW_ROUTE,
      confidence: CONFIDENCE.MEDIUM,
      coveragePreserved: !currentIncomplete,
      notes: ["Present in current only (within supplied pair)."],
    };
  }

  if (delta === ROUTE_DELTA.STATUS_CHANGED) {
    return {
      ...base,
      recommendation: RECOMMENDATION.RECORD_STATUS_CHANGE_FOR_LISTING,
      confidence: CONFIDENCE.MEDIUM,
      coveragePreserved: !currentIncomplete,
      notes: [diff.reason || "HTTP status changed without redirect/inaccessible/restored."],
    };
  }

  // unchanged (default)
  return {
    ...base,
    recommendation: RECOMMENDATION.NO_ACTION_UNCHANGED,
    confidence: CONFIDENCE.HIGH,
    coveragePreserved: !currentIncomplete,
    notes: ["No material route delta in supplied pair."],
  };
}

function summarizeRecommendations(recs) {
  const byRec = {};
  let coveragePreservedCount = 0;
  for (const r of recs) {
    byRec[r.recommendation] = (byRec[r.recommendation] || 0) + 1;
    if (r.coveragePreserved) coveragePreservedCount += 1;
  }
  return {
    recommendationCount: recs.length,
    byRecommendation: byRec,
    coveragePreservedCount,
    note: "Deterministic actions only. No SEO/traffic/ranking/crawler invention.",
  };
}

/**
 * Build distribution repair feed from route-regression input (or wrapper).
 *
 * @param {object} rawInput - `{ baseline, current, ... }` OR `{ routeRegressionInput, distributionCite? }`
 * @param {{ clock?: () => number }} [opts]
 */
export function buildDistRepairFeed(rawInput, { clock = () => Date.now() } = {}) {
  let unwrapped;
  try {
    unwrapped = unwrapInput(rawInput);
  } catch (err) {
    if (err && err.code) {
      return {
        schema: FEED_SCHEMA,
        generatedAt: new Date(clock()).toISOString(),
        status: FEED_STATUS.REJECTED,
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        },
        repairRecommendations: [],
        usableBy: [...USABLE_BY],
        pins: { ...PINS },
        scopeNote: SCOPE_NOTE,
        coverageNote: COVERAGE_NOTE,
        reuseFrom: REUSE_FROM,
        mutationBoundary: MUTATION_BOUNDARY,
        dryRun: DRY_RUN_NOTE,
      };
    }
    throw err;
  }

  const routeReport = buildRouteRegressionReport(unwrapped.regressionInput, { clock });

  if (routeReport.status === REPORT_STATUS.REJECTED) {
    return {
      schema: FEED_SCHEMA,
      generatedAt: new Date(clock()).toISOString(),
      status: FEED_STATUS.REJECTED,
      feedId: unwrapped.feedId,
      demo: unwrapped.demo,
      error: routeReport.error ?? {
        code: ERROR_CODES.INVALID_INPUT,
        message: "route regression rejected",
      },
      routeReportSummary: {
        schema: routeReport.schema,
        status: routeReport.status,
        error: routeReport.error ?? null,
      },
      repairRecommendations: [
        {
          routeKey: "*",
          delta: "rejected",
          recommendation: RECOMMENDATION.SKIP_REJECTED_INPUT,
          confidence: CONFIDENCE.NONE,
          coveragePreserved: true,
          notes: ["Upstream route regression rejected; no actionable repairs."],
        },
      ],
      usableBy: [...USABLE_BY],
      pins: { ...PINS },
      distributionCite: unwrapped.distributionCite,
      scopeNote: SCOPE_NOTE,
      coverageNote: COVERAGE_NOTE,
      reuseFrom: REUSE_FROM,
      mutationBoundary: MUTATION_BOUNDARY,
      dryRun: DRY_RUN_NOTE,
    };
  }

  const rawCurrent = unwrapped.regressionInput.current;
  const currentIncomplete = isCurrentCaptureIncomplete(rawCurrent, routeReport);

  const repairRecommendations = (routeReport.diffs || []).map((diff) =>
    mapDeltaToRecommendation(diff, { currentIncomplete }),
  );

  let status = FEED_STATUS.READY;
  const partialReasons = [];
  if (routeReport.status === REPORT_STATUS.PARTIAL_INPUT || currentIncomplete) {
    status = FEED_STATUS.PARTIAL_INPUT;
    if (currentIncomplete) partialReasons.push("current_capture_incomplete");
    if (routeReport.partialReasons?.length) {
      partialReasons.push(...routeReport.partialReasons);
    }
  }

  const feed = {
    schema: FEED_SCHEMA,
    generatedAt: new Date(clock()).toISOString(),
    status,
    feedId: unwrapped.feedId ?? routeReport.reportId ?? null,
    demo: unwrapped.demo,
    currentCaptureIncomplete: currentIncomplete,
    partialReasons: [...new Set(partialReasons)],
    routeReportSummary: {
      schema: routeReport.schema,
      status: routeReport.status,
      reportId: routeReport.reportId,
      baselineMeta: routeReport.baselineMeta,
      currentMeta: routeReport.currentMeta,
      summary: routeReport.summary,
      partialReasons: routeReport.partialReasons ?? [],
      scopeNote: routeReport.scopeNote,
      diffCount: routeReport.diffs?.length ?? 0,
    },
    repairRecommendations,
    recommendationSummary: summarizeRecommendations(repairRecommendations),
    usableBy: [...USABLE_BY],
    pins: { ...PINS },
    distributionCite: unwrapped.distributionCite ?? {
      cite: "distribution/08 conversion diagnosis export shape",
      diagnosisSchema: PINS.diagnosisSchemaCite,
      pin: PINS.samedaydeskDist08,
      note: "Feed does not call diagnoseConversion; Dist-06 consumes recommendations.",
    },
    scopeNote: SCOPE_NOTE,
    coverageNote: COVERAGE_NOTE,
    reuseFrom: REUSE_FROM,
    mutationBoundary: MUTATION_BOUNDARY,
    dryRun: DRY_RUN_NOTE,
    consumerInstructions:
      "NL-DISTRIBUTION-06 (and distribution/08 consumers) should read repairRecommendations[]. " +
      "Honor coveragePreserved / cannot_prove_global_removal when currentCaptureIncomplete. " +
      "Do not invent SEO, traffic, ranking, crawler, or revenue claims from this feed.",
  };

  // Hard refuse forbidden fields on output.
  for (const field of ["seoRank", "trafficProjection", "rankingScore", "revenue", "conversionRate"]) {
    if (Object.prototype.hasOwnProperty.call(feed, field)) {
      throw feedError(ERROR_CODES.FORBIDDEN_CLAIM, `${field} must not appear on feed`);
    }
  }

  return feed;
}

// Re-export sibling symbols for tests/consumers without rewriting parsers.
export { buildRouteRegressionReport, ROUTE_DELTA, REPORT_STATUS };

