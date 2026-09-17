import { admitPublicHttpsOrigin, assertNotMcpResource } from "./admit.mjs";
import {
  EXAMPLE_VERSION,
  EXTRACT_HTTP_ROUTES,
  EXTRACT_MCP_TOOLS,
  LIVE_ORIGIN,
  PRODUCT,
  RUNTIME,
  SCHEMA_VERSION,
} from "./constants.mjs";
import { discoverHttp, discoverMcp, probeExtractChallenges } from "./discovery.mjs";
import { fail } from "./errors.mjs";
import { readLocalMarketplace } from "./marketplace.mjs";

function inventoryFrom(http, mcp) {
  const httpRoutes = [
    ...new Set([
      ...http.openapi.extract.operations.map((operation) => operation.path),
      ...http.wellKnown.extractItems.map((item) => item.routeTemplate),
      ...http.actions.extractActions.map((action) => action.route),
    ]),
  ];
  const mcpTools = EXTRACT_MCP_TOOLS.filter((name) => mcp.toolsList.names.includes(name));
  return Object.freeze({
    mcp: Object.freeze(mcpTools),
    http: Object.freeze(EXTRACT_HTTP_ROUTES.filter((route) => httpRoutes.includes(route))),
    marketplacePlugin: "samedaydesk-extract@samedaydesk-claude",
  });
}

function probesAreUnpaid(probes) {
  if (!probes) return { ok: true, unexpectedDelivery: false };
  const unexpected = probes.getExtract.unexpectedDelivery || probes.postExtractBatch.unexpectedDelivery;
  const both402 = probes.getExtract.status === 402 && probes.postExtractBatch.status === 402;
  return { ok: both402 && !unexpected, unexpectedDelivery: unexpected };
}

/**
 * Credential-free unpaid discovery list for Anthropic/Claude extract surfaces.
 * Never looks up a wallet, signs, sends payment headers, checks out, or publishes.
 */
export async function listUnpaid({
  origin = LIVE_ORIGIN,
  fetchImpl = globalThis.fetch,
  includeProbes = true,
  probeUrl,
  repoRoot,
} = {}) {
  assertNotMcpResource(origin, "origin");
  const admittedOrigin = admitPublicHttpsOrigin(origin);
  const marketplace = readLocalMarketplace({ repoRoot });
  const http = await discoverHttp(admittedOrigin, fetchImpl);
  const mcp = await discoverMcp(admittedOrigin, fetchImpl);
  const probes = includeProbes
    ? await probeExtractChallenges(admittedOrigin, fetchImpl, probeUrl ? { probeUrl } : {})
    : null;
  const extractInventory = inventoryFrom(http, mcp);
  const probeState = probesAreUnpaid(probes);
  const extractPresent = extractInventory.mcp.includes("extract")
    && extractInventory.mcp.includes("extract_batch")
    && extractInventory.http.includes("/extract")
    && extractInventory.http.includes("/extract/batch");

  if (probeState.unexpectedDelivery) {
    fail("extract probe returned HTTP 200; unpaid list refuses to treat delivery as discovery or to retry with payment", {
      code: "unexpected_delivery",
      exitCode: 1,
    });
  }

  const ok = extractPresent && probeState.ok;
  return Object.freeze({
    ok,
    product: PRODUCT,
    schemaVersion: SCHEMA_VERSION,
    exampleVersion: EXAMPLE_VERSION,
    runtime: RUNTIME,
    origin: admittedOrigin,
    source: includeProbes ? "live-or-recorded-unpaid-discovery" : "unpaid-discovery-without-probes",
    paymentAttempted: false,
    walletAccessed: false,
    checkoutAttempted: false,
    published: false,
    neoTouched: false,
    extractInventory,
    marketplace,
    surfaces: Object.freeze([
      marketplace,
      http.openapi,
      http.wellKnown,
      http.actions,
      mcp.initialize,
      mcp.toolsList,
      ...(probes ? [probes.getExtract, probes.postExtractBatch] : []),
    ]),
    boundary: Object.freeze({
      unpaidOnly: true,
      toolsCallRefused: true,
      paymentHeadersRefused: true,
      listingIsNotPaymentAuthority: true,
      officialAnthropicDirectory: false,
      mcpProtocol: mcp.protocol,
    }),
    note: ok
      ? "Unpaid Anthropic/Claude extract inventory. A 402 is the live offer, not a sale."
      : "Extract inventory missing or unpaid 402 probes did not return 402.",
  });
}
