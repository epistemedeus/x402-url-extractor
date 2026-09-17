/**
 * SDS GET /extract 402 pin and OpenServ issue 6 fixture-contract metadata.
 * Synthetic only. No live listing, OpenServ account, or Agent402 source.
 */
export const SCHEMA_FIXTURE = "samedaydesk.paywall-wrapper-fixture.v1";
export const SCHEMA_REPORT = "samedaydesk.paywall-wrapper-report.v1";

export const SDS = Object.freeze({
  origin: "https://agents.samedaydesk.com",
  mcpUrl: "https://agents.samedaydesk.com/mcp",
  extractPath: "/extract",
  extractMethod: "GET",
  extractResourceUrl: "https://agents.samedaydesk.com/extract",
  mcpTool: "extract",
  amountAtomic: "5000",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
  inputKeys: Object.freeze(["url"]),
  outputRequiredFields: Object.freeze([
    "ok",
    "url",
    "title",
    "text",
    "fetchedAt",
    "aiReadiness.hasTitle",
  ]),
});

export const OPENSERV_ISSUE_6 = Object.freeze({
  url: "https://github.com/openserv-labs/client/issues/6",
  title: "External x402 listings should preserve the canonical resource and a buyer-visible output contract",
  clientPin: "fb3f1d11911900aabb63ee5230a6a9466df99a03",
  role: "fixture contract not an integration",
  observableTriggerFields: Object.freeze([
    "type",
    "name",
    "description",
    "x402Pricing",
    "x402WalletAddress",
    "timeout",
    "inputSchema",
    "waitForCompletion",
  ]),
});

/** Synthetic platform payTo. Not a live OpenServ wallet. */
export const FIXTURE_PLATFORM_PAY_TO = "0x1111111111111111111111111111111111111111";
export const FIXTURE_PLATFORM_AMOUNT_ATOMIC = "50000";
export const FIXTURE_PLATFORM_PRICE = "0.05";
export const FIXTURE_OPENSERV_WEBHOOK =
  "https://api.openserv.ai/webhooks/x402/trigger/synthetic-unpublished-r6-02";

export const CODES = Object.freeze({
  ONE_PAYWALL: "one_paywall",
  TWO_PAYWALL: "two_paywall",
  SETTLEMENT_OWNER_HIDDEN: "settlement_owner_hidden",
  UNSUPPORTED_TARGET: "unsupported_target",
  AUTHORIZATION_REFUSED: "authorization_refused",
  LOST_METHOD: "lost_method",
  LOST_INPUTS: "lost_inputs",
  LOST_OUTPUTS: "lost_outputs",
  LIVE_LISTING: "live_listing",
  MALFORMED_FIXTURE: "malformed_fixture",
  ROUTE_ABSENT: "route_absent",
});

export const FAIL_CLOSED_CODES = Object.freeze([
  CODES.TWO_PAYWALL,
  CODES.SETTLEMENT_OWNER_HIDDEN,
  CODES.UNSUPPORTED_TARGET,
  CODES.AUTHORIZATION_REFUSED,
  CODES.LOST_METHOD,
  CODES.LOST_INPUTS,
  CODES.LOST_OUTPUTS,
  CODES.LIVE_LISTING,
  CODES.MALFORMED_FIXTURE,
  CODES.ROUTE_ABSENT,
]);
