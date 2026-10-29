// Actionable interoperability decision. Integrated is true only after the fetched
// H64220 export both loaded and was invoked. The boundary fixture never counts.

export function interoperabilityDecision(assessment = {}) {
  const integrated = assessment.integrated === true
    && assessment.invoked === true
    && assessment.evidence === "fetched-source"
    && assessment.boundaryFixtureIsIntegration !== true;
  return {
    schema: "h64221.poppy-reader.decision.v1",
    optionalAdapter: "source-only",
    publicPoppySupportClaim: false,
    directRoutesRemainSupported: true,
    directHttp: "POST /trial/read",
    directMcp: "trial_read",
    optionalRoute: "POST /poppy/v0/trial-read",
    paidRead: "Existing unpaid x402 challenge. A Poppy session does not settle it or return paid Markdown.",
    integratedWithH64220: integrated,
    boundaryFixtureIsIntegration: false,
    h64220: {
      repository: assessment.repository ?? null,
      branch: assessment.branch ?? null,
      head: assessment.head ?? null,
      manifestPresent: assessment.manifestPresent === true,
      reason: assessment.reason ?? null,
      evidence: assessment.evidence ?? null,
    },
    action: integrated
      ? "Root can pass the loaded H64220 verify function into createPoppyReaderAdapter. Keep the adapter unwired from server.js until Root releases it."
      : "Keep the adapter optional and unwired. Direct HTTP and MCP remain the supported reader routes. Fetch H64220 EXPORT.json again before any compatibility claim. Do not advertise Poppy support.",
  };
}
