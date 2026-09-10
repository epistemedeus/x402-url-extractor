/**
 * Bind caller usage to exportDiff. Decision rules from PACKET-CONTRACT.md.
 */

function changeKindFor(symbol, exportDiff) {
  if (exportDiff.removed.includes(symbol)) return "removed";
  if (exportDiff.added.includes(symbol)) return "added";
  const sig = (exportDiff.signatureChanged || []).find((s) => s.symbol === symbol);
  if (sig) return "signatureChanged";
  const renamed = (exportDiff.renamed || []).find((s) => s.from === symbol || s.to === symbol);
  if (renamed && exportDiff.removed.includes(symbol)) return "renamed";
  return "unchanged";
}

function decide({ used, kind, dynamicImport, sameVersion, missingSource }) {
  if (missingSource) {
    return { decision: "unknown", rationale: "Conflicting/missing/partial source ⇒ unknown, not action." };
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
    return { decision: "no_action", rationale: "Used export is present on both sides; a newer version alone is not a break." };
  }
  if (kind === "removed" || kind === "renamed") {
    return {
      decision: "action",
      rationale: "Caller statically imports this symbol; compiled named export is absent on the new side.",
    };
  }
  if (kind === "signatureChanged") {
    return {
      decision: "action",
      rationale: "Caller uses this symbol; .d.ts overload count changed (partial; not a type checker).",
    };
  }
  if (kind === "added") {
    return { decision: "no_action", rationale: "Used symbol is new; not a removal of an existing caller import." };
  }
  return { decision: "unknown", rationale: "Unclassified change kind." };
}

function nextActionOf(decisions) {
  if (decisions.includes("action")) return "action";
  if (decisions.includes("unknown")) return "unknown";
  return "no_action";
}

export function bindUsageToDiff({
  usage,
  exportDiff,
  sameVersion = false,
  missingSource = false,
}) {
  const bindings = [];
  const usedNamed = new Set((usage.runtimeNamed || []).filter((s) => s && !s.startsWith("<")));
  const dynamicImport = Boolean(usage.dynamicImport);

  const changed = new Set([
    ...exportDiff.removed,
    ...exportDiff.added,
    ...(exportDiff.signatureChanged || []).map((s) => s.symbol),
  ]);

  const symbolsToBind = new Set([...usedNamed, ...changed]);
  if (dynamicImport && usedNamed.size === 0) {
    symbolsToBind.add("<dynamic>");
  }

  for (const symbol of [...symbolsToBind].sort()) {
    const used = usedNamed.has(symbol) || (symbol === "<dynamic>" && dynamicImport);
    const kind = symbol === "<dynamic>" ? "unknown" : changeKindFor(symbol, exportDiff);
    const { decision, rationale } = decide({
      used,
      kind: kind === "unknown" ? "unchanged" : kind,
      dynamicImport,
      sameVersion,
      missingSource,
    });
    bindings.push({
      symbol,
      used,
      changeKind: dynamicImport && used ? "unknown" : kind,
      decision: dynamicImport && used ? "unknown" : decision,
      rationale:
        dynamicImport && used
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
    .filter((b) => !b.used && b.changeKind !== "unchanged")
    .map((b) => ({ symbol: b.symbol, changeKind: b.changeKind, decision: b.decision }));

  const unknownReasons = [];
  if (dynamicImport) unknownReasons.push("dynamic_import_of_package");
  if (usage.symbols?.some((s) => s.importKind === "namespace")) {
    unknownReasons.push("namespace_import_member_use_not_tracked");
  }

  return {
    bindings,
    summary: {
      nextAction: nextActionOf(bindings.map((b) => b.decision)),
      unknownReasons,
      unusedChanges,
      actionableChanges,
    },
  };
}
