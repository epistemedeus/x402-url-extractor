import { auditIntegrity } from "agent-payment-integrity";

import { AUDIT_ADDS, AUDIT_DOES_NOT } from "./constants.mjs";

function headerMap(probe) {
  const headers = { "content-type": probe?.contentType || "application/json" };
  if (probe?.status === 402 && probe.paymentRequired) headers["payment-required"] = probe.paymentRequired;
  return headers;
}

export async function scanCaptured({ origin, method, route, requiredPaths, document, resourceProbe }) {
  const boundary = {
    bodyForwardedToScanner: false,
    paymentSent: false,
    sellerRuntimeVerified: false,
  };
  if (!document) {
    return {
      ran: false,
      reason: "declaration_unavailable",
      findings: [],
      repairPlan: null,
      adds: AUDIT_ADDS,
      doesNotAdd: AUDIT_DOES_NOT,
      boundary,
    };
  }
  let calls = 0;
  try {
    const report = await auditIntegrity({
      origin,
      x402Document: document,
      route,
      method,
      requiredPaths,
      maxRoutes: 1,
      requestImpl: async () => {
        calls += 1;
        return {
          status: resourceProbe?.status ?? 0,
          headers: headerMap(resourceProbe),
          body: Buffer.alloc(0),
        };
      },
    });
    const row = report.routes?.[0] || null;
    return {
      ran: true,
      reason: null,
      schemaVersion: report.schemaVersion,
      ok: report.ok === true,
      machineBuyable: report.machineBuyable === true,
      findings: row?.findings || [],
      repairPlan: row?.repairPlan || null,
      responseContract: row?.responseContract
        ? { decision: row.responseContract.decision, requiredPaths: row.responseContract.requiredPaths }
        : null,
      status: row?.status ?? null,
      runtimeChallengeVerified: row?.runtimeChallengeVerified === true,
      calls,
      adds: AUDIT_ADDS,
      doesNotAdd: AUDIT_DOES_NOT,
      boundary: {
        ...boundary,
        sellerRuntimeVerified: row?.repairPlan?.boundary?.sellerRuntimeVerified === true,
      },
    };
  } catch (error) {
    return {
      ran: false,
      reason: /not declared/.test(String(error?.message || "")) ? "exact_route_not_declared" : "scan_failed",
      detail: String(error?.message || error).slice(0, 180),
      findings: [],
      repairPlan: null,
      calls,
      adds: AUDIT_ADDS,
      doesNotAdd: AUDIT_DOES_NOT,
      boundary,
    };
  }
}
