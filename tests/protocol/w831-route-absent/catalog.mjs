import { agentDiscoverabilityAudit } from "../../../agent-discoverability-audit.mjs";
import {
  CATALOG_EXPECTED_ROUTE,
  CATALOG_INTENT,
  CATALOG_LISTED_ROUTE,
  CATALOG_ORIGIN,
  SDS,
} from "./constants.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function htmlResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

/**
 * Catalogs list the origin on `/read` while the caller asks for `/extract`.
 * Production `agentDiscoverabilityAudit` must report route_absent, not a
 * matched price and not a payable route.
 */
export function originFoundExpectedRouteAbsentFetch({
  origin = CATALOG_ORIGIN,
  listedRoute = CATALOG_LISTED_ROUTE,
  payTo = SDS.payTo,
} = {}) {
  const listedUrl = `${origin}${listedRoute}`;
  return async (url) => {
    const target = String(url);
    if (target.includes("coinbase.com")) {
      return jsonResponse({
        resources: [
          { serviceName: "Origin other-route", resource: listedUrl, accepts: [{ amount: "5000", payTo }] },
        ],
      });
    }
    if (target.includes("agent402.tools")) {
      return jsonResponse({
        results: [{
          name: "Origin other-route",
          seller: origin,
          route: listedRoute,
          url: listedUrl,
          priceUsd: 0.005,
          payTo,
        }],
      });
    }
    if (target.includes("agentic.market")) {
      return jsonResponse({
        services: [{
          name: "Origin other-route",
          description: "listed on a different path",
          endpoints: [{ url: listedUrl, description: "read", pricing: { amount: "0.005" } }],
        }],
      });
    }
    if (target.includes("circle.com")) return jsonResponse({ items: [] });
    if (target.includes("agentictrade.io")) {
      return jsonResponse({
        services: [{
          name: "Origin other-route",
          description: "listed on a different path",
          endpoint: listedUrl,
          pricing: { price_per_call: "0.005" },
        }],
      });
    }
    if (target.includes("mpp.dev")) {
      return jsonResponse({
        services: [{
          name: "Origin other-route",
          description: "listed on a different path",
          serviceUrl: origin,
          tags: ["read"],
          endpoints: [{
            path: listedRoute,
            description: "read",
            payment: { amount: "5000", decimals: 6, recipient: payTo },
          }],
        }],
      });
    }
    if (target.includes("mppscan.com")) {
      return jsonResponse({
        result: {
          data: {
            json: [{
              origin,
              title: "Origin other-route",
              protocols: ["x402"],
              endpoint: {
                method: "GET",
                path: listedRoute,
                summary: "read",
                authMode: "paid",
                price: "0.005000 USD",
              },
            }],
          },
        },
      });
    }
    if (target.includes("payanagent.com")) {
      return jsonResponse({
        offers: [{
          _id: "kh736e0z6aw86kvtn28ert5na18c4kb1",
          title: listedUrl,
          description: "listed on a different path",
          priceUsd: 0.005,
          buyUrl: "/x402/kh736e0z6aw86kvtn28ert5na18c4kb1",
        }],
      });
    }
    if (target.includes("x402.jobs")) {
      return jsonResponse({
        resources: [{
          id: "resource-other-route",
          name: "Origin other-route",
          resource_url: listedUrl,
          x402jobs_url: `https://x402.jobs/resources${listedRoute}`,
          description: "listed on a different path",
          max_amount_required: "5000",
          network: "base",
          pay_to: payTo,
        }],
      });
    }
    if (target.includes("8004market.io")) {
      return htmlResponse("<span>0</span><span>Assets found</span>");
    }
    throw new Error(`unexpected catalog ${target}`);
  };
}

export async function runCatalogRouteAbsent({
  origin = CATALOG_ORIGIN,
  expectedRoute = CATALOG_EXPECTED_ROUTE,
  listedRoute = CATALOG_LISTED_ROUTE,
  intent = CATALOG_INTENT,
  payTo = SDS.payTo,
} = {}) {
  const result = await agentDiscoverabilityAudit({
    origin,
    intent,
    route: expectedRoute,
    payTo,
    expectedPriceUsd: "0.005",
  }, {
    fetchImpl: originFoundExpectedRouteAbsentFetch({ origin, listedRoute, payTo }),
    now: 0,
  });
  const priceStatuses = Object.fromEntries(
    Object.entries(result.sources)
      .filter(([, source]) => source?.priceObservation)
      .map(([name, source]) => [name, source.priceObservation.status]),
  );
  const findings = result.findings
    .filter((item) => item.finding === "origin_found_expected_route_absent")
    .map((item) => item.finding);
  const identityStatuses = Object.fromEntries(
    Object.entries(result.sources)
      .filter(([, source]) => source?.identityObservation)
      .map(([name, source]) => [name, source.identityObservation.status]),
  );
  return {
    origin,
    expectedRoute,
    listedRoute,
    targetFound: result.summary.targetFoundSourceCount > 0,
    expectedRouteFound: result.summary.expectedRouteFoundSourceCount === 0
      ? false
      : result.summary.expectedRouteFoundSourceCount > 0,
    expectedRouteFoundSourceCount: result.summary.expectedRouteFoundSourceCount,
    targetFoundSourceCount: result.summary.targetFoundSourceCount,
    priceObservationStatus: Object.values(priceStatuses).includes("route_absent")
      ? "route_absent"
      : Object.values(priceStatuses)[0] ?? null,
    priceStatuses,
    identityStatuses,
    findings: [...new Set([
      ...findings,
      ...result.findings.map((item) => item.finding),
    ])],
    originFoundExpectedRouteAbsent: result.findings.some(
      (item) => item.finding === "origin_found_expected_route_absent",
    ),
    matched: result.summary.matchedPriceSourceCount > 0,
    payable: false,
    charged: false,
    safety: result.safety,
  };
}
