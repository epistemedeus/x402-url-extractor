/**
 * Bind caller usage to exportDiff. Decision rules from PACKET-CONTRACT.md.
 */

import { changeKindFor } from "./export-diff.mjs";

function decide({ used, kind, dynamicImport, sameVersion, missingSource, dualConflict }) {
  if (missingSource) {
    return { decision: "unknown", rationale: "Conflicting/missing/partial source ⇒ unknown, not action." };
  }
  if (dualConflict) {
    return { decision: "unknown", rationale: "ESM and CJS entrypoints disagree on default/named surface ⇒ unknown." };
  }
  if (sameVersion) {
    return { decision: "no_action", rationale: "Same-version/no-op ⇒ no_action." };
  }
  if (dynamicImport) {
    return { decision: "unknown", rationale: "Dynamic import of package ⇒ unknown for that surface." };
  }
  if (!used) {
    if (kind === "unchanged") {
      return { decision: "no_action", rationale: "Unused unchanged export is not a caller defect." };
    }
    return { decision: "no_action", rationale: "Unused export change is not a caller defect." };
  }
  if (kind === "unchanged") {
    return {
      decision: "no_action",
      rationale: "Used export is present on both sides; a newer version alone is not a break.",
    };
  }
  if (kind === "removed" || kind === "renamed") {
    return {
      decision: "action",
      rationale: "Caller statically imports this symbol; it is absent on the new side.",
    };
  }
  if (kind === "signatureChanged") {
    return {
      decision: "action",
      rationale: "Caller uses this symbol; a classified signature change was recorded.",
    };
  }
  if (kind === "added") {
    return { decision: "no_action", rationale: "Added export is not a removal of an existing caller import." };
  }
  return { decision: "unknown", rationale: "Unclassified change kind." };
}

export function bindUsageToDiff({
  usage,
  exportDiff,
  sameVersion = false,
  missingSource = false,
  dualConflict = false,
} = {}) {
  const usedSymbols = new Set();
  for (const item of usage?.symbols || []) {
    if (item.typeOnly) continue;
    if (item.importKind === "named" && item.used) usedSymbols.add(item.symbol);
    if ((item.importKind === "default" || item.importKind === "cjs-require") && item.used) {
      usedSymbols.add("default");
    }
    if (item.importKind === "dynamic") usedSymbols.add("<dynamic>");
  }
  if (usage?.runtimeDefault) usedSymbols.add("default");
  for (const name of usage?.runtimeNamed || []) usedSymbols.add(name);

  const changed = new Set([
    ...(exportDiff.removed || []),
    ...(exportDiff.added || []),
    ...(exportDiff.signatureChanged || []).map((s) => (typeof s === "string" ? s : s.symbol)),
  ]);

  const symbolsToBind = new Set([...usedSymbols, ...changed, ...(exportDiff.kept || [])]);
  if (usage?.dynamicImport && usedSymbols.size === 0) symbolsToBind.add("<dynamic>");

  const bindings = [];
  for (const symbol of [...symbolsToBind].sort()) {
    const used = usedSymbols.has(symbol);
    const kind = symbol === "<dynamic>" ? "unknown" : changeKindFor(symbol, exportDiff);
    const dynamicImport = Boolean(usage?.dynamicImport) && (symbol === "<dynamic>" || used);
    const { decision, rationale } = decide({
      used,
      kind: kind === "unknown" ? "unchanged" : kind,
      dynamicImport,
      sameVersion,
      missingSource,
      dualConflict,
    });
    bindings.push({
      symbol,
      used,
      changeKind: dynamicImport ? "unknown" : kind,
      decision: dynamicImport ? "unknown" : decision,
      rationale: dynamicImport
        ? "Dynamic import of package ⇒ unknown for that surface."
        : rationale,
    });
  }

  if (missingSource) {
    return {
      bindings: bindings.map((b) => ({
        ...b,
        decision: "unknown",
        rationale: "Conflicting/missing/partial source ⇒ unknown, not action.",
      })),
      summary: {
        nextAction: "unknown",
        unknownReasons: ["missing_or_partial_source"],
        unusedChanges: [],
        actionableChanges: [],
      },
    };
  }

  const actionableChanges = bindings.filter((b) => b.decision === "action").map((b) => b.symbol);
  const unusedChanges = bindings
    .filter((b) => !b.used && b.changeKind !== "unchanged" && b.changeKind !== "unknown")
    .map((b) => ({ symbol: b.symbol, changeKind: b.changeKind, decision: b.decision }));
  const unknownReasons = bindings.filter((b) => b.decision === "unknown").map((b) => `${b.symbol}:${b.changeKind}`);

  let nextAction = "no_action";
  if (actionableChanges.length) nextAction = "action";
  else if (bindings.some((b) => b.decision === "unknown")) nextAction = "unknown";

  return {
    bindings,
    summary: {
      nextAction,
      unknownReasons,
      unusedChanges,
      actionableChanges,
    },
  };
}
