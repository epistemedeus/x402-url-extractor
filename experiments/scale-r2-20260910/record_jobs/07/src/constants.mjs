/**
 * R2-RECORD-JOBS-07 — Dependency footprint overlap constants.
 *
 * Compares caller-supplied lockfile / dependency inventory fixtures.
 * Surfaces duplicate runtime dependencies and declared licenses as given.
 * Not security certification, vulnerability scoring, legal advice, or S127
 * API impact analysis.
 *
 * Forbidden spirit: no CVE score, security certification, legal advice,
 * compliance score, invest advice, SEO rank, or traffic projection claims.
 */

export const REUSE_FROM = "R2-RECORD-JOBS-07";

export const SCHEMA = "x402.r2.record.dependency_footprint_overlap.v1";
export const INPUT_SCHEMA = "x402.r2.record.dependency_footprint_input.v1";

export const REPORT_STATUS = Object.freeze({
  READY: "ready",
  PARTIAL_INPUT: "partial_input",
  REJECTED: "rejected",
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  MISSING_REQUIREMENT: "missing_requirement",
  FORBIDDEN_CLAIM: "forbidden_claim",
});

/**
 * Reject inputs that invent security/legal/invest/SEO marketing claims.
 */
export const FORBIDDEN_FIELDS = Object.freeze([
  "cveScore",
  "cveScores",
  "vulnerabilityScore",
  "vulnScore",
  "securityCertification",
  "securityCert",
  "securityScore",
  "legalAdvice",
  "legalOpinion",
  "legalCertification",
  "certifiedCompliant",
  "complianceScore",
  "legalComplianceScore",
  "licenseComplianceScore",
  "investAdvice",
  "investmentRecommendation",
  "buySellAdvice",
  "seoRank",
  "seoScore",
  "seoRanking",
  "rankingScore",
  "rankScore",
  "universalRank",
  "trafficProjection",
  "trafficEstimate",
  "trafficScore",
  "pageViews",
  "organicTraffic",
  "reputation",
  "reputationScore",
  "revenue",
  "revenueProjection",
  "siteHealthScore",
  "healthScore",
  "apiImpactScore",
  "s127Impact",
  "s127ApiImpact",
]);

export const SEPARATE_FROM = "S127";

export const MUTATION_BOUNDARY =
  "Isolated feature-branch source/tests only. Root owns merge, publication, and paid actions.";

export const SCOPE_NOTE =
  "Report covers only the supplied lockfile / dependency inventory fixtures. This is not a live audit of the internet, not security or legal certification, and not S127 API impact analysis.";

export const DRY_RUN_NOTE =
  "Fixture/lockfile compare only: never crawl npm or the internet; never invent licenses or CVE scores; retain missing license as unknown.";

export const UNKNOWN_LICENSE = "unknown";
