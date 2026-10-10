/**
 * Query semantics for the maintained discovery client.
 * The decoder names these pins. It does not fetch them.
 */

export const SCHEMA = "pilot.task-discoverability.164000.v1";

export const PACKAGE = Object.freeze({
  name: "task-discoverability",
  version: "0.3.0",
  license: "MIT",
  schema: "pilot.task-discoverability.166000.v1",
  measurementRule: "pilot.observatory-measurement.v1",
});

export const SOURCE = Object.freeze({
  repository: "x402-foundation/x402",
  commit: "f8f83309706b14cc696962f0a002eeeb66c3dc26",
  package: "@x402/extensions",
  version: "2.28.0",
  license: "Apache-2.0",
  client: "typescript/packages/extensions/src/bazaar/facilitatorClient.ts",
  method: "GET",
  searchUrl: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search",
  listUrl: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources",
  cdpListDocumentedQuery: Object.freeze(["type", "limit", "offset"]),
  sdkSearchQuery: Object.freeze([
    "query",
    "type",
    "payTo",
    "scheme",
    "network",
    "extensions",
    "limit",
    "cursor",
  ]),
  sdkListQuery: Object.freeze(["type", "payTo", "scheme", "network", "extensions", "limit", "offset"]),
  searchLimitRole: "advisory",
  searchCursorRole: "advisory",
  filtersAssumedHonored: false,
});

export const FROZEN_QUERY =
  "Extract the readable text from one public web page URL into structured JSON.";

export const FROZEN_SERVICE = "https://agents.samedaydesk.com/extract";

export const FROZEN_OBSERVED_AT = "2026-10-10T18:32:35Z";

export const ROOT_REPLAY = Object.freeze({
  at: "2026-10-10T18:50:15.494Z",
  declaredReturnedCount: 11,
  exactServicePresent: false,
  firstResource: "https://api.oblique.markets/api/v1/paid/web-extract",
  reportedApplicationBody: "url",
  retainedInThisArtifact: false,
  usedAsStoredBody: false,
});

export const CONSUMER = Object.freeze({
  id: "samedaydesk-acquisition-decision",
  question: "does this task query encounter my exact service and can its request be constructed?",
  internalAssessment: true,
  authenticBuyerEncounter: false,
});

export const CHECKED_READERS = Object.freeze([
  Object.freeze({
    id: "directional-traffic-151710",
    pin: "2d5835f2ba4cf6bf406ce5eeb748fe91f26a94ae",
    passes: Object.freeze({ normal: 39, cold: 39, sparse: 39 }),
    answers: Object.freeze([
      "cdp-list-page call labels",
      "payer labels",
      "standing route hypotheses",
    ]),
    sellerQuestion: false,
  }),
  Object.freeze({
    id: "observatory-160000-public-contract",
    schema: "pilot.external-observatory.v1",
    sourceIds: Object.freeze(["moltjobs", "x402stats", "smithery_mcp"]),
    includesCdpDiscoverySearch: false,
    sellerQuestion: false,
  }),
]);

export const BASELINE = Object.freeze({
  name: "pinned-sdk-direct-search",
  repository: SOURCE.repository,
  commit: SOURCE.commit,
  package: SOURCE.package,
  version: SOURCE.version,
  sameCapturedQuery: FROZEN_QUERY,
  sameCapturedFilters: Object.freeze({ type: "http", limit: "20" }),
  transformReplacesGet: false,
  integrationCost: "unknown",
  attentionCost: "unknown",
  cashCost: "unknown",
  claims: Object.freeze({ moat: false, saving: false, customer: false }),
});

export const RECEIPT_RELATIVE =
  "overview/research/phase-20261010/discovery-acquisition-161000/receipts/live-discovery.json";

export const KNOWN_CALLS = Object.freeze({
  taskSearch: "task-search",
  verifiedList: "verified-list",
  payToList: "merchant-payto-list",
});
