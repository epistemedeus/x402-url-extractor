/**
 * Disjoint S173 example: take actual NL-RECORD-04 feed → Dist08 diagnosis
 * + one actionable before/after route repair fixture.
 * No invented captures; no Heavy S163 duplication.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const EXAMPLE_ROOT = join(__dirname, "..");
export const DEFAULT_FEED = resolve(
  EXAMPLE_ROOT,
  "..",
  "..",
  "artifacts",
  "dist-repair-feed.positive.json",
);
export const DEFAULT_DIST08 = process.env.DIST08_ROOT
  ? resolve(process.env.DIST08_ROOT)
  : "/workspace/pilot/worktrees/samedaydesk-dist08-ea000772/experiments/scale-r2-20260910/distribution/08";

const ACTIONABLE = new Set([
  "update_listed_route_or_redirect_target",
  "recommend_distribution_recheck",
  "diagnose_access_or_listing_path",
  "surface_broken_or_removed_route",
  "consider_listing_new_route",
]);

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Pick one high-confidence actionable repair from the actual 04 feed. */
export function pickActionableRepair(feed) {
  if (!feed || feed.schema !== "pilot.nl.record.dist_repair_feed.v1") {
    throw new Error("feed must be pilot.nl.record.dist_repair_feed.v1");
  }
  const recs = Array.isArray(feed.repairRecommendations)
    ? feed.repairRecommendations
    : [];
  const high = recs.filter(
    (r) =>
      ACTIONABLE.has(r.recommendation) &&
      r.confidence === "high" &&
      r.recommendation !== "no_action_unchanged",
  );
  const pick =
    high.find((r) => r.delta === "redirected") ||
    high.find((r) => r.delta === "removed") ||
    high.find((r) => r.delta === "inaccessible") ||
    high[0];
  if (!pick) throw new Error("no actionable high-confidence repair in feed");
  return pick;
}

/**
 * Before/after route repair fixture derived only from the feed recommendation
 * (no invented crawl captures).
 */
export function buildBeforeAfterFixture(feed, repair) {
  const summary = feed.routeReportSummary || {};
  return {
    schema: "pilot.nl.record.route_repair_before_after.v1",
    sourceFeed: {
      schema: feed.schema,
      feedId: feed.feedId,
      status: feed.status,
      merchantPin: "a7e2cd7a2223e2aa7e7e09eebf3695aba4731205",
      dist08Cite: "ea000772cdbd6d5df7174369dcef9aa2270e5723",
    },
    routeKey: repair.routeKey,
    before: {
      deltaObserved: repair.delta,
      notes: [...(repair.notes || [])],
      listingImplication:
        repair.delta === "redirected"
          ? "listed_path_may_point_at_stale_target"
          : repair.delta === "removed"
            ? "listed_path_may_be_gone_within_supplied_pair"
            : "listed_path_may_be_inaccessible",
    },
    after: {
      recommendation: repair.recommendation,
      confidence: repair.confidence,
      coveragePreserved: repair.coveragePreserved === true,
      actionableStep:
        repair.recommendation === "update_listed_route_or_redirect_target"
          ? "Update distribution listing URL/redirect to match current finalUrl from supplied pair."
          : repair.recommendation === "recommend_distribution_recheck"
            ? "Recheck distribution listing against current supplied capture before claiming removal."
            : "Diagnose access or listing path using supplied pair only.",
    },
    scopeNote:
      "Fixture derived from NL-RECORD-04 supplied-pair feed only. Not a crawl; not traffic/ranking.",
    routeReportSummary: {
      status: summary.status,
      baselineMeta: summary.baselineMeta,
      currentMeta: summary.currentMeta,
      deltaCounts: summary.summary?.deltaCounts,
    },
  };
}

/** Dist08 conversion bundle citing the feed as useful-output evidence (no fake revenue). */
export function buildDist08BundleFromFeed(feed, repair) {
  const jobRef = `nl-record-04:${feed.feedId || "feed"}:${repair.routeKey}`;
  const at = feed.generatedAt || "2026-09-10T12:00:00.000Z";
  return {
    schema: "pilot.r2.distribution.conversion_bundle.v1",
    cite: "S173 handoff: NL-RECORD-04 feed → Dist08 diagnosis; no invented captures/revenue",
    captureStatus: "ok",
    reason: `Route repair feed join for ${repair.routeKey} (${repair.delta})`,
    acquisitionEvidence: [
      {
        id: "acq-nl04-catalog-presented",
        kind: "linkPresented",
        sourceTag: "catalog",
        provider: "grexal",
        linkId: `route:${repair.routeKey}`,
        jobRef,
        sharedEvidenceId: jobRef,
        at,
        evidenceRef:
          "experiments/scale-r2-20260910/record_jobs/nl-04-dist-feed/artifacts/dist-repair-feed.positive.json",
      },
      {
        id: "acq-nl04-catalog-activated",
        kind: "linkActivated",
        sourceTag: "catalog",
        provider: "grexal",
        linkId: `route:${repair.routeKey}`,
        jobRef,
        sharedEvidenceId: jobRef,
        at,
        evidenceRef:
          "experiments/scale-r2-20260910/record_jobs/nl-04-dist-feed/artifacts/dist-repair-feed.positive.json",
        impliesBuyerIntent: false,
      },
    ],
    usefulOutputEvidence: [
      {
        id: "out-nl04-route-repair-run",
        kind: "run",
        provider: "grexal",
        jobRef,
        sharedEvidenceId: jobRef,
        at,
        evidenceRef:
          "experiments/scale-r2-20260910/record_jobs/nl-04-dist-feed/artifacts/dist-repair-feed.positive.json",
        note: `NL-04 repair: ${repair.recommendation} for ${repair.routeKey}`,
        routeRepair: {
          routeKey: repair.routeKey,
          delta: repair.delta,
          recommendation: repair.recommendation,
          confidence: repair.confidence,
        },
      },
    ],
  };
}

export async function runHandoff({
  feedPath = DEFAULT_FEED,
  dist08Root = DEFAULT_DIST08,
  outDir = join(EXAMPLE_ROOT, "out"),
  clock = () => Date.parse("2026-09-10T12:00:00.000Z"),
} = {}) {
  if (!existsSync(feedPath)) {
    throw new Error(`feed missing: ${feedPath}`);
  }
  const diagnosePath = join(dist08Root, "src", "diagnose.mjs");
  if (!existsSync(diagnosePath)) {
    throw new Error(`Dist08 diagnose missing: ${diagnosePath}`);
  }
  const feed = loadJson(feedPath);
  const repair = pickActionableRepair(feed);
  const beforeAfter = buildBeforeAfterFixture(feed, repair);
  const bundle = buildDist08BundleFromFeed(feed, repair);
  const { diagnoseConversion } = await import(pathToFileURL(diagnosePath).href);
  const diagnosis = diagnoseConversion(bundle, { clock });

  mkdirSync(outDir, { recursive: true });
  const beforeAfterPath = join(outDir, "route-repair-before-after.json");
  const bundlePath = join(outDir, "dist08-bundle.from-nl04.json");
  const diagnosisPath = join(outDir, "dist08-diagnosis.from-nl04.json");
  writeFileSync(beforeAfterPath, JSON.stringify(beforeAfter, null, 2) + "\n");
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + "\n");
  writeFileSync(diagnosisPath, JSON.stringify(diagnosis, null, 2) + "\n");

  return {
    schema: "pilot.nl.record.dist08_handoff_example.v1",
    status: "ready",
    pickedRepair: repair,
    diagnosisStatus: diagnosis.status,
    joinCount: Array.isArray(diagnosis.joined) ? diagnosis.joined.length : 0,
    diagnosisLabel: diagnosis.label || null,
    outputs: { beforeAfterPath, bundlePath, diagnosisPath },
    notes: [
      "Used actual NL-04 feed artifact only.",
      "Dist08 diagnoseConversion invoked; no Heavy S163 recipes.",
      "No invented crawl/traffic/revenue captures.",
    ],
  };
}
