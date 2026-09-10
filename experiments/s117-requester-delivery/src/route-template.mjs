/**
 * Compare TypeScript x402 Bazaar routeTemplate validation (fixed-point decode,
 * merged in x402-foundation/x402#3213 on 2026-09-09) with the single-pass
 * Go/Python residual described by x402-foundation/x402#3439.
 *
 * Does not patch upstream SDKs. PRs #3440 (Python) and #3441 (Go) already
 * claim the port.
 */

const ROUTE_TEMPLATE_REGEX = /^\/[a-zA-Z0-9_/:.\-~%]+$/;
export const MAX_ROUTE_TEMPLATE_DECODE_PASSES = 5;

export function fullyDecodeRouteTemplate(value, maxPasses = MAX_ROUTE_TEMPLATE_DECODE_PASSES) {
  if (typeof value !== "string") return { ok: false, reason: "not_string" };
  let decoded = value;
  for (let i = 0; i < maxPasses; i += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return { ok: false, reason: "malformed_percent_encoding", passes: i };
    }
    if (next === decoded) return { ok: true, decoded, passes: i };
    decoded = next;
  }
  return { ok: false, reason: "decode_budget_exhausted", passes: maxPasses };
}

export function isValidRouteTemplateFixedPoint(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!ROUTE_TEMPLATE_REGEX.test(value)) return false;
  const decoded = fullyDecodeRouteTemplate(value);
  if (!decoded.ok) return false;
  if (decoded.decoded.includes("..")) return false;
  if (decoded.decoded.includes("://")) return false;
  return true;
}

export function isValidRouteTemplateSinglePass(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!ROUTE_TEMPLATE_REGEX.test(value)) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (decoded.includes("..")) return false;
  if (decoded.includes("://")) return false;
  return true;
}

export function compareRouteTemplatePolicies(value) {
  const typescriptFixedPointAccepts = isValidRouteTemplateFixedPoint(value);
  const goPythonSinglePassAccepts = isValidRouteTemplateSinglePass(value);
  return Object.freeze({
    schemaVersion: "s117.route-template.v1",
    value,
    typescriptFixedPointAccepts,
    goPythonSinglePassAccepts,
    drift: typescriptFixedPointAccepts !== goPythonSinglePassAccepts,
    catalogPoisoningIfSinglePassAccepts: goPythonSinglePassAccepts && !typescriptFixedPointAccepts,
    decode: fullyDecodeRouteTemplate(typeof value === "string" ? value : ""),
    notes: Object.freeze({
      upstream_ts_merged: "https://github.com/x402-foundation/x402/pull/3213",
      residual_issue: "https://github.com/x402-foundation/x402/issues/3439",
      python_pr: "https://github.com/x402-foundation/x402/pull/3440",
      go_pr: "https://github.com/x402-foundation/x402/pull/3441",
      local_recipe_is_not_upstream_merge: true,
    }),
  });
}
