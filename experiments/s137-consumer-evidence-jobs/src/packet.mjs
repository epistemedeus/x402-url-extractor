/**
 * Shared evidence packet envelope for S137 consumer-evidence jobs.
 * Deterministic transforms only. No model-as-oracle fields.
 */
export const PACKET_SCHEMA = "s137.consumer-evidence.packet.v1";
export const EVIDENCE_CLASSES = Object.freeze(["synthetic", "fixture", "live-capture"]);
export const DECISIONS = Object.freeze(["pass", "fail", "partial", "conflict", "unknown"]);

export function createEnvelope({
  jobId,
  artifactKind,
  clock,
  evidenceClass = "synthetic",
  sources = [],
  findings = [],
  decision = "unknown",
  limitations = [],
  citations = [],
} = {}) {
  if (!clock) throw new Error("clock required (operator-supplied; do not invent)");
  if (!EVIDENCE_CLASSES.includes(evidenceClass)) {
    throw new Error(`evidenceClass must be one of ${EVIDENCE_CLASSES.join("|")}`);
  }
  if (!DECISIONS.includes(decision)) {
    throw new Error(`decision must be one of ${DECISIONS.join("|")}`);
  }
  return {
    schema: PACKET_SCHEMA,
    jobId: jobId || null,
    artifactKind: artifactKind || null,
    clock,
    evidenceClass,
    offline: true,
    payment: { attempted: false },
    cost: { assignmentSpendUsd: 0, note: "offline transform; no purchase; do not invent demand" },
    sources: Array.isArray(sources) ? sources : [],
    findings: Array.isArray(findings) ? findings : [],
    citations: Array.isArray(citations) ? citations : [],
    decision,
    limitations: Array.isArray(limitations) ? [...limitations] : [],
    claims: {
      inventsFacts: false,
      paidEndpoint: false,
      legalAttestation: false,
      modelAsOracle: false,
      assertsCustomerDemand: false,
    },
  };
}

export function requireCitedFinding(finding) {
  if (!finding || typeof finding !== "object") throw new Error("finding required");
  if (!finding.citationIds || finding.citationIds.length === 0) {
    throw new Error("every finding must cite at least one citationId");
  }
  return finding;
}
