// Free POST /recipes/page-change listing coherence. The unpaid route must stay
// aligned with the catalog and must not demand settlement.

export const PAGE_CHANGE_ROUTE = "/recipes/page-change";

export function pageChangeListingProblems(snapshot = {}) {
  const problems = [];
  const free = snapshot.catalogFree;
  if (!free) {
    problems.push("catalog-missing-free-recipe");
  } else {
    if (String(free.method || "").toUpperCase() !== "POST") {
      problems.push(`method-mismatch catalog ${free.method || "missing"}`);
    }
    if (free.route !== PAGE_CHANGE_ROUTE) problems.push("catalog-route");
    if (free.charged !== false) problems.push("catalog-charged");
    if (free.priceAtomicUsdc != null) problems.push("catalog-priced");
  }
  if (snapshot.paidAction === true) problems.push("catalog-paid-action");
  const openapi = snapshot.openapi || {};
  if (openapi.present !== true) problems.push("openapi-missing");
  if (openapi.paymentInfo === true) problems.push("openapi-payment-info");
  if (openapi.response402 === true) problems.push("openapi-402");
  if (openapi.chargedConst !== false) problems.push("openapi-charged-const");
  if (snapshot.llms?.chargedFalse !== true) problems.push("llms-charged-false-missing");
  if (snapshot.llms?.priced === true) problems.push("llms-priced");
  if (snapshot.healthz?.ok !== true) problems.push("healthz-not-ok");
  if (snapshot.healthz?.priced === true) problems.push("healthz-priced");
  const mcp = snapshot.mcp || {};
  if (mcp.listed !== true) problems.push("mcp-free-tool-missing");
  if (mcp.listed === true && String(mcp.method || "").toUpperCase() !== "POST") {
    problems.push(`method-mismatch mcp ${mcp.method || "missing"}`);
  }
  if (mcp.charged !== false) problems.push("mcp-charged");
  if (mcp.paidTool === true) problems.push("mcp-paid-tool");
  const unpaid = snapshot.unpaid;
  if (!unpaid) {
    problems.push("unpaid-missing");
  } else {
    if (unpaid.status === 402) problems.push("settlement-demanded-status");
    if (unpaid.paymentRequired === true) problems.push("settlement-demanded-payment-required");
    if (unpaid.wwwAuthenticate === true) problems.push("settlement-demanded-www-authenticate");
    if (unpaid.charged !== false) problems.push("settlement-demanded-charged");
    if (unpaid.settled === true) problems.push("settlement-demanded-settled");
  }
  return problems;
}

export function pageChangeListingVerdict(snapshot = {}) {
  const problems = pageChangeListingProblems(snapshot);
  return {
    consistent: problems.length === 0,
    settlementDemanded: problems.some((problem) => problem.startsWith("settlement-demanded")),
    charged: snapshot.unpaid?.charged ?? null,
    problems,
  };
}
