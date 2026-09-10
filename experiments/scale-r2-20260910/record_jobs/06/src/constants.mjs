/**
 * R2-RECORD-JOBS-06 — Deadline evidence calendar constants.
 *
 * Extracts explicit dates and qualifications from caller-supplied public
 * notices into a source-linked calendar. Ambiguous dates are retained
 * (dateRaw + ambiguous:true); never invent a precise ISO when the source
 * is vague. No live crawl of the whole web.
 *
 * Forbidden spirit: no invest advice, SEO rank, traffic projection,
 * "compliance score", or legal certification claims.
 */

export const REUSE_FROM = "R2-RECORD-JOBS-06";

export const SCHEMA = "x402.r2.record.deadline_calendar.v1";
export const INPUT_SCHEMA = "x402.r2.record.deadline_calendar_input.v1";

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
 * Reject inputs that invent marketing / legal-cert / invest claims.
 * Also reject fields that would smuggle invented deadlines not in notice text.
 */
export const FORBIDDEN_FIELDS = Object.freeze([
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
  "investmentRecommendation",
  "buySellAdvice",
  "investAdvice",
  "complianceScore",
  "legalCertification",
  "certifiedCompliant",
  "legalComplianceScore",
  "guaranteedDeadline",
  "inventedDeadline",
  "reputation",
  "reputationScore",
  "revenue",
  "revenueProjection",
  "siteHealthScore",
  "healthScore",
]);

export const MUTATION_BOUNDARY =
  "Isolated feature-branch source/tests only. Root owns merge, publication, and paid actions.";

export const SCOPE_NOTE =
  "Calendar covers only the supplied public notices. This is not a claim about all deadlines on the internet, nor legal advice or certification.";

export const DRY_RUN_NOTE =
  "Fixture/notice extract only: never crawl live sites; never invent deadlines absent from notice text; retain ambiguous dates without forcing ISO.";

/** Month names for parsing (index 0 unused; 1=January). */
export const MONTH_NAMES = Object.freeze([
  null,
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

/** Qualifier phrases detected near date mentions (lowercase). */
export const QUALIFIER_PHRASES = Object.freeze([
  "no later than",
  "not later than",
  "on or about",
  "on or before",
  "subject to",
  "estimated",
  "estimate",
  "approximately",
  "approx",
  "tentatively",
  "tentative",
  "expected",
  "anticipated",
  "due by",
  "due date",
  "due",
  "deadline",
  "effective",
  "commencing",
  "commence",
  "closing",
  "closes",
]);
