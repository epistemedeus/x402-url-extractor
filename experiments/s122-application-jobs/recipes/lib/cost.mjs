/**
 * Cost notes stay explicit. This assignment spends 0.
 * Never promise zero marginal cost or assumed margin.
 */

export const COST_NOTES = Object.freeze({
  assignmentSpend: {
    kind: "zero_assignment_spend",
    asOf: "2026-09-10",
    summary: "This pack spends $0. No paid x402, SameDayDesk, or Neomorphic calls are invoked.",
    amount: 0,
  },
  offlineCompare: {
    kind: "costs_unknown",
    asOf: "2026-09-10",
    summary:
      "Offline compare runs on operator compute. Merchant charges are not invoked; local CPU, disk, and wall time are costs_unknown.",
    examples: [
      {
        item: "local application-job compare",
        amount: "costs_unknown",
        note: "no merchant charge; operator compute not priced here",
      },
    ],
  },
  officialJsonGet: {
    kind: "costs_unknown",
    asOf: "2026-09-10",
    summary:
      "Optional GET of official free JSON (npm registry, endoflife.date) has no merchant charge. Egress, CPU, and source-side rate limits remain costs_unknown. Default tests do not perform this GET.",
    examples: [
      {
        item: "GET https://registry.npmjs.org/vercel",
        amount: "costs_unknown",
        note: "official free JSON; not invoked unless --live-official",
      },
      {
        item: "GET https://endoflife.date/api/nodejs.json",
        amount: "costs_unknown",
        note: "official free JSON; not invoked unless --live-official",
      },
    ],
  },
  notInvokedMerchant: {
    kind: "sourced_list_price_not_invoked",
    asOf: "2026-09-10",
    source: "merchant /for-agents listed extract prices",
    summary:
      "A future paid freshness call would use the merchant listed prices and is outside this pack unless the operator purchases elsewhere.",
    examples: [
      {
        item: "POST /extract",
        amount: "0.005 USDC listed",
        note: "not invoked by these recipes",
      },
      {
        item: "POST /extract/batch",
        amount: "0.01 USDC listed",
        note: "not invoked by these recipes",
      },
    ],
  },
});

export function costForRecipe() {
  return {
    primary: COST_NOTES.offlineCompare,
    assignmentSpend: COST_NOTES.assignmentSpend,
    related: [COST_NOTES.officialJsonGet, COST_NOTES.notInvokedMerchant],
  };
}
