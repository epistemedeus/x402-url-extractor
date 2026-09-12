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
  const refused = inner.ok === false;
  const partial = (counts.conflicting || 0) > 0 || (counts.unknown || 0) > 0;
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
      note: "Price/field delta in curated fixture rows - not a live quote.",
    });
  }
  if (!actions.length && !refused) {
    actions.push({
      priority: partial ? "high" : "low",
      kind: partial ? "resolve-conflicting-or-unknown-rows" : "no-budget-delta",
      note: partial
        ? "Conflicting/unknown pricing evidence present; impact is non-final even without a known delta"
        : "No field/unit deltas in curated rows",
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
    gaps: partial ? ["conflicting or unknown pricing rows present; treat impact as non-final"] : [],
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
  lines.push("", "_Curated caller rows only. Not current market prices or customer demand._", "");
  return lines.join("\n");
}

export function looksLikeHtml(text) {
  const t = String(text ?? "").trim().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || (t.startsWith("<") && t.includes("<body"));
}
