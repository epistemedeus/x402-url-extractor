/**
 * Vendor-budget impact mapping.
 * Projection of useful-jobs 1.4.0 apps/vendor-budget-impact/cli.mjs
 * buildImpact / toMarkdown. No filesystem, no record-repeat spawn.
 */

const APP = "vendor-budget-impact";

export function buildImpact(report) {
  const inner = report || {};
  const counts = inner.counts || {};
  const unitChanges = inner.unitChanges || [];
  const fieldChanges = inner.fieldChanges || [];
  const added = inner.added || [];
  const removed = inner.removed || [];
  const refused = inner.ok === false;
  const numericDeltaOverflow = fieldChanges.some(row => !Number.isFinite(row.afterValue - row.beforeValue));
  const partial = (counts.conflicting || 0) > 0 || (counts.unknown || 0) > 0 || numericDeltaOverflow;
  const hasDelta =
    (counts.unitChanges || unitChanges.length)
      + (counts.fieldChanges || fieldChanges.length)
      + (counts.added || 0)
      + (counts.removed || 0)
    > 0;
  const status = refused ? "refused" : partial ? "partial" : hasDelta ? "actionable" : "informational";
  const actions = [];
  for (const u of unitChanges) {
    actions.push({
      priority: "high",
      kind: "normalize-unit-before-budgeting",
      fieldKey: u.fieldKey,
      beforeUnit: u.beforeUnit,
      afterUnit: u.afterUnit,
      note: "Unit label changed; do not compare numeric fields until units match. No purchase authorized.",
    });
  }
  for (const f of fieldChanges) {
    actions.push({
      priority: "medium",
      kind: "review-price-field",
      fieldKey: f.fieldKey || f.key,
      beforeValue: f.beforeValue,
      afterValue: f.afterValue,
      unit: f.unit,
      ...(Number.isFinite(f.afterValue - f.beforeValue) ? { delta: f.afterValue - f.beforeValue } : {}),
      note: "Same-unit list-price field change in supplied snapshots. Delta is after minus before per stated unit, not a bill change or live quote.",
    });
  }
  for (const row of added) {
    actions.push({
      priority: "medium", kind: "review-added-price-field", fieldKey: row.fieldKey,
      afterValue: row.after.value, unit: row.after.unit,
      note: "Field appears in the after snapshot. Check source coverage and SKU identity; this does not establish a new vendor offering, a replacement, or a bill increase.",
    });
  }
  for (const row of removed) {
    actions.push({
      priority: "medium", kind: "review-removed-price-field", fieldKey: row.fieldKey,
      beforeValue: row.before.value, unit: row.before.unit,
      note: "Field is absent from the after snapshot. Check source coverage; absence does not establish retirement or a bill reduction.",
    });
  }
  if (!actions.length && !refused) {
    actions.push({
      priority: partial ? "high" : "low",
      kind: partial ? "resolve-conflicting-or-unknown-rows" : hasDelta ? "review-unresolved-price-delta" : "no-budget-delta",
      note: partial
        ? "Conflicting/unknown pricing evidence present; impact is non-final even without a known delta"
        : hasDelta ? "Row deltas were counted but field-level details are unavailable. Review source evidence."
          : "No row deltas detected in supplied snapshots. This does not establish an unchanged bill.",
    });
  }
  return {
    appId: APP,
    status,
    purchaseAuthority: false,
    paidValueClaim: false,
    summary: refused
      ? "Pricing compare refused"
      : `Budget-impact scan: fieldChanges=${counts.fieldChanges || fieldChanges.length} unitChanges=${counts.unitChanges || unitChanges.length} added=${counts.added || 0} removed=${counts.removed || 0} conflicting=${counts.conflicting || 0} unknown=${counts.unknown || 0}`,
    actions,
    gaps: [
      ...(partial ? ["conflicting or unknown pricing rows present; treat impact as non-final"] : []),
      ...(fieldChanges.some(row => !Number.isFinite(row.afterValue - row.beforeValue))
        ? ["numeric list-price delta exceeds finite number range; raw values retained"] : []),
    ],
    scope: {
      kind: "supplied-pricing-row-diff",
      billCalculation: false, liveQuote: false, unitsConverted: false, sourceCoverageVerified: false,
      note: "Caller supplies dated snapshots with stable field identity and comparable units. Actual usage and all tariff terms are required for a bill estimate.",
    },
  };
}

export function toMarkdown(art) {
  const lines = [
    "# Vendor budget impact (no purchase authority)",
    "",
    `Status: **${art.status}**`,
    "",
    art.summary,
    "",
    "## Recommended reviews",
  ];
  for (const a of art.actions || []) {
    lines.push(`- (${a.priority}) ${a.kind}${a.fieldKey ? `: \`${a.fieldKey}\`` : ""} - ${a.note}`);
  }
  for (const action of art.actions || []) {
    if (action.kind === "review-price-field") {
      lines.push("", `${action.fieldKey}: before=${action.beforeValue}; after=${action.afterValue}; unit=${action.unit}.`);
      if (action.delta !== undefined) lines.push(`List-price delta per stated unit: ${action.delta} (after minus before).`);
    } else if (action.kind === "review-added-price-field") {
      lines.push("", `${action.fieldKey}: after=${action.afterValue}; unit=${action.unit}.`);
    } else if (action.kind === "review-removed-price-field") {
      lines.push("", `${action.fieldKey}: before=${action.beforeValue}; unit=${action.unit}.`);
    }
  }
  lines.push("", "_Supplied pricing rows only. No live quote, unit conversion, bill calculation, or customer-demand evidence._", "");
  return lines.join("\n");
}

export function looksLikeHtml(text) {
  const t = String(text ?? "").trim().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || (t.startsWith("<") && t.includes("<body"));
}
