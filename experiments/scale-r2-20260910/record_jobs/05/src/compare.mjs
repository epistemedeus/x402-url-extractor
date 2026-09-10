import {
  ACCESSIBILITY,
  DRY_RUN_NOTE,
  ERROR_CODES,
  MUTATION_BOUNDARY,
  REPORT_STATUS,
  REUSE_FROM,
  ROUTE_DELTA,
  SCHEMA,
  SCOPE_NOTE,
} from "./constants.mjs";
import { reportError, validateRouteRegressionInput } from "./validate.mjs";

const INACCESSIBLE_STATUSES = new Set([401, 403, 404, 410]);
const INACCESSIBLE_ACCESS = new Set([
  ACCESSIBILITY.FORBIDDEN,
  ACCESSIBILITY.TIMEOUT,
  ACCESSIBILITY.DNS,
  ACCESSIBILITY.ERROR,
]);

function isServerError(status) {
  return typeof status === "number" && status >= 500 && status <= 599;
}

function isRedirectStatus(status) {
  return typeof status === "number" && status >= 300 && status <= 399;
}

function isSuccessStatus(status) {
  return typeof status === "number" && status >= 200 && status <= 299;
}

/**
 * Reachable = 2xx/3xx OR accessibility ok (when status missing but flagged ok).
 * Inaccessible = 401/403/404/410/5xx OR accessibility forbidden|timeout|dns|error.
 * Unknown when incomplete (no status, no accessibility).
 */
export function classifyReachability(obs) {
  if (!obs) return "absent";
  if (obs.incomplete) return "unknown";

  if (obs.accessibility != null) {
    if (INACCESSIBLE_ACCESS.has(obs.accessibility)) return "inaccessible";
    if (obs.accessibility === ACCESSIBILITY.OK) {
      // Accessibility ok can still be overridden by hard inaccessible status.
      if (
        obs.statusPresent &&
        (INACCESSIBLE_STATUSES.has(obs.status) || isServerError(obs.status))
      ) {
        return "inaccessible";
      }
      return "reachable";
    }
  }

  if (!obs.statusPresent) return "unknown";
  if (INACCESSIBLE_STATUSES.has(obs.status) || isServerError(obs.status)) {
    return "inaccessible";
  }
  if (isSuccessStatus(obs.status) || isRedirectStatus(obs.status)) {
    return "reachable";
  }
  // Other 4xx (e.g. 400, 429) treated as inaccessible for regression purposes.
  if (obs.status >= 400 && obs.status <= 499) return "inaccessible";
  return "unknown";
}

function effectiveLocation(obs) {
  if (!obs) return null;
  return obs.finalUrl || obs.redirectLocation || null;
}

/**
 * Redirected when final URL / redirect location changed, or current is 3xx
 * with a location that differs from the baseline logical target.
 */
export function isRedirectDelta(baseline, current) {
  if (!baseline || !current) return false;
  const baseLoc = effectiveLocation(baseline);
  const curLoc = effectiveLocation(current);

  if (baseLoc && curLoc && normalizeLoc(baseLoc) !== normalizeLoc(curLoc)) {
    return true;
  }
  // Current 3xx with a new location while baseline had none / different.
  if (isRedirectStatus(current.status) && curLoc) {
    if (!baseLoc) return true;
    if (normalizeLoc(baseLoc) !== normalizeLoc(curLoc)) return true;
  }
  // Baseline was non-redirect success, current became 3xx (even without location string).
  if (
    isSuccessStatus(baseline.status) &&
    !isRedirectStatus(baseline.status) &&
    isRedirectStatus(current.status)
  ) {
    return true;
  }
  return false;
}

function normalizeLoc(loc) {
  try {
    const u = new URL(loc);
    return `${u.origin}${u.pathname}${u.search}`.replace(/\/$/, "") || u.origin;
  } catch {
    return String(loc).replace(/\/$/, "");
  }
}

/**
 * Classify one routeKey present in baseline and/or current.
 * Priority when both present:
 *   redirected > inaccessible > restored > status_changed > unchanged
 */
export function classifyRouteDelta(baseline, current) {
  if (baseline && !current) {
    return { delta: ROUTE_DELTA.REMOVED, reason: "present_in_baseline_absent_in_current" };
  }
  if (!baseline && current) {
    return { delta: ROUTE_DELTA.ADDED, reason: "present_in_current_absent_in_baseline" };
  }

  // both present
  if (isRedirectDelta(baseline, current)) {
    return { delta: ROUTE_DELTA.REDIRECTED, reason: "final_url_or_3xx_location_changed" };
  }

  const baseReach = classifyReachability(baseline);
  const curReach = classifyReachability(current);

  if (baseReach === "reachable" && curReach === "inaccessible") {
    return {
      delta: ROUTE_DELTA.INACCESSIBLE,
      reason: "was_reachable_now_inaccessible",
    };
  }
  if (baseReach === "inaccessible" && curReach === "reachable") {
    return { delta: ROUTE_DELTA.RESTORED, reason: "was_inaccessible_now_reachable" };
  }

  if (
    baseline.statusPresent &&
    current.statusPresent &&
    baseline.status !== current.status
  ) {
    return {
      delta: ROUTE_DELTA.STATUS_CHANGED,
      reason: `status_${baseline.status}_to_${current.status}`,
    };
  }

  // Accessibility-only change that is not reachability flip (e.g. both still reachable)
  // or incomplete → treat as unchanged when statuses match / both unknown.
  return { delta: ROUTE_DELTA.UNCHANGED, reason: "no_material_route_delta" };
}

function observationSummary(obs) {
  if (!obs) return null;
  return {
    routeKey: obs.routeKey,
    url: obs.url,
    path: obs.path,
    status: obs.status,
    finalUrl: obs.finalUrl,
    redirectLocation: obs.redirectLocation,
    accessibility: obs.accessibility,
    title: obs.title,
    etag: obs.etag,
    contentHash: obs.contentHash,
    incomplete: obs.incomplete,
    reachability: classifyReachability(obs),
  };
}

function buildRouteDiff(routeKey, baseline, current) {
  const { delta, reason } = classifyRouteDelta(baseline, current);
  return {
    routeKey,
    delta,
    reason,
    baseline: observationSummary(baseline),
    current: observationSummary(current),
  };
}

function buildSummary(diffs) {
  const counts = {
    [ROUTE_DELTA.UNCHANGED]: 0,
    [ROUTE_DELTA.REMOVED]: 0,
    [ROUTE_DELTA.REDIRECTED]: 0,
    [ROUTE_DELTA.INACCESSIBLE]: 0,
    [ROUTE_DELTA.RESTORED]: 0,
    [ROUTE_DELTA.STATUS_CHANGED]: 0,
    [ROUTE_DELTA.ADDED]: 0,
  };
  for (const d of diffs) {
    counts[d.delta] = (counts[d.delta] || 0) + 1;
  }
  return {
    routeCount: diffs.length,
    deltaCounts: counts,
    note: "Factual delta counts only. No SEO rank, traffic projection, invest advice, or site health score.",
  };
}

/**
 * Build public route regression report from caller-supplied snapshot pair.
 */
export function buildRouteRegressionReport(rawInput, { clock = () => Date.now() } = {}) {
  let input;
  try {
    input = validateRouteRegressionInput(rawInput);
  } catch (err) {
    if (err && err.code) {
      return {
        schema: SCHEMA,
        generatedAt: new Date(clock()).toISOString(),
        status: REPORT_STATUS.REJECTED,
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        },
        scopeNote: SCOPE_NOTE,
        reuseFrom: REUSE_FROM,
        mutationBoundary: MUTATION_BOUNDARY,
        dryRun: DRY_RUN_NOTE,
      };
    }
    throw err;
  }

  const baselineMap = new Map(input.baseline.routes.map((r) => [r.routeKey, r]));
  const currentMap = new Map(input.current.routes.map((r) => [r.routeKey, r]));
  const keys = [...new Set([...baselineMap.keys(), ...currentMap.keys()])].sort();

  const diffs = keys.map((k) => buildRouteDiff(k, baselineMap.get(k), currentMap.get(k)));
  const summary = buildSummary(diffs);

  const incompleteCount =
    input.baseline.routes.filter((r) => r.incomplete).length +
    input.current.routes.filter((r) => r.incomplete).length;

  const partialReasons = [];
  let status = REPORT_STATUS.READY;
  if (incompleteCount > 0) {
    status = REPORT_STATUS.PARTIAL_INPUT;
    partialReasons.push("incomplete_route_observations");
  }
  // Unknown reachability on both sides with no other delta still ready-ish,
  // but flag partial when any unknown reachability appears on compared pair.
  const unknownPairs = diffs.filter(
    (d) =>
      (d.baseline && d.baseline.reachability === "unknown") ||
      (d.current && d.current.reachability === "unknown"),
  );
  if (unknownPairs.length > 0) {
    status = REPORT_STATUS.PARTIAL_INPUT;
    partialReasons.push("unknown_reachability_on_some_routes");
  }

  const report = {
    schema: SCHEMA,
    generatedAt: new Date(clock()).toISOString(),
    status,
    reportId: input.reportId,
    title: input.title,
    demo: input.demo === true,
    sourceLabel: input.sourceLabel,
    baselineMeta: {
      label: input.baseline.label,
      capturedAt: input.baseline.capturedAt,
      routeCount: input.baseline.routes.length,
    },
    currentMeta: {
      label: input.current.label,
      capturedAt: input.current.capturedAt,
      routeCount: input.current.routes.length,
    },
    diffs,
    summary,
    partialReasons: status === REPORT_STATUS.PARTIAL_INPUT ? [...new Set(partialReasons)] : [],
    scopeNote: SCOPE_NOTE,
    reuseFrom: REUSE_FROM,
    mutationBoundary: MUTATION_BOUNDARY,
    dryRun: DRY_RUN_NOTE,
    consumerInstructions:
      "Supply baseline + current route snapshot objects (each with routes[] of url/path + status/accessibility). " +
      "Run `node src/cli.mjs report <input.json>`. Compare only the supplied pair. " +
      "Do not treat this report as SEO rank, traffic projection, invest advice, or a site health score.",
  };

  for (const field of [
    "seoRank",
    "trafficProjection",
    "investmentRecommendation",
    "siteHealthScore",
  ]) {
    if (Object.prototype.hasOwnProperty.call(report, field)) {
      throw reportError(ERROR_CODES.FORBIDDEN_CLAIM, `${field} must not appear on report`);
    }
  }

  return report;
}
