// Read-only useful-outcome funnel over existing commerce forward / rare rows.
// Reuses stage and usefulness vocabulary already admitted in commerce-outcome-binding.
// Unknown coverage stays unknown (null), never coerced to zero. No writes.

export const FUNNEL_SCHEMA = "samedaydesk.useful-outcome-funnel.projection.v1";

export const STAGES = Object.freeze([
  "discovery",
  "call",
  "transport",
  "delivery",
  "settlement",
  "retained_use",
]);

export const USEFULNESS_UNKNOWN = "unknown";

const STAGE_SET = new Set(STAGES);

function asCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Project a funnel from already-captured forward-binding or rare-funnel rows.
 * Missing stage fields leave that stage count null (unknown), not 0.
 */
export function projectUsefulOutcomeFunnel(rows, {
  source = "commerce_forward_or_rare_fixture",
  bingCitations = null,
} = {}) {
  if (!Array.isArray(rows)) throw new Error("funnel_rows_required");

  const seen = Object.fromEntries(STAGES.map((s) => [s, 0]));
  let usefulnessUnknown = 0;
  let usefulnessDeclaredOther = 0;
  let rowsAccepted = 0;
  let rowsRejected = 0;
  let rareFunnelRows = 0;
  let forwardRows = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      rowsRejected += 1;
      continue;
    }
    const stage = row.stage;
    if (typeof stage !== "string" || !STAGE_SET.has(stage)) {
      rowsRejected += 1;
      continue;
    }
    rowsAccepted += 1;
    seen[stage] += 1;
    if (row.schemaVersion === "samedaydesk.commerce-rare-funnel-evidence.v1"
      || row.captureVersion === "rare_funnel_capture_v1") {
      rareFunnelRows += 1;
    }
    if (typeof row.schemaVersion === "string"
      && row.schemaVersion.startsWith("samedaydesk.outcome-binding.forward.")) {
      forwardRows += 1;
    }
    const usefulness = row.usefulness;
    if (usefulness === USEFULNESS_UNKNOWN || usefulness == null) {
      usefulnessUnknown += 1;
    } else {
      usefulnessDeclaredOther += 1;
    }
  }

  // Empty supplied window: every stage stays null (unknown coverage is not zero).
  // Non-empty window: unobserved stages are 0 for this window only.
  const stageCounts = Object.fromEntries(
    STAGES.map((stage) => [stage, rowsAccepted === 0 ? null : seen[stage]]),
  );

  const bing = bingCitations == null
    ? Object.freeze({ status: "unknown", count: null })
    : Object.freeze({
        status: "supplied",
        count: asCount(bingCitations.count),
      });

  return Object.freeze({
    schema: FUNNEL_SCHEMA,
    source,
    rowsAccepted,
    rowsRejected,
    rareFunnelRows,
    forwardRows,
    stageCounts: Object.freeze({ ...stageCounts }),
    usefulnessUnknownCount: usefulnessUnknown,
    usefulnessDeclaredOtherCount: usefulnessDeclaredOther,
    bingCitations: bing,
    recognizedRevenueAtomic: "0",
    unknownCoverage: rowsAccepted === 0,
    note: "unknown coverage is not zero; Bing stays unknown unless a citation cut is supplied",
  });
}

export function assertFunnelHonest(funnel) {
  if (funnel?.schema !== FUNNEL_SCHEMA) throw new Error("funnel_schema");
  if (funnel.recognizedRevenueAtomic !== "0") throw new Error("funnel_revenue_invented");
  if (funnel.unknownCoverage === true) {
    for (const stage of STAGES) {
      if (funnel.stageCounts[stage] !== null) throw new Error("funnel_unknown_coerced");
    }
  }
  if (funnel.bingCitations?.status === "unknown" && funnel.bingCitations.count !== null) {
    throw new Error("funnel_bing_count_without_status");
  }
}
