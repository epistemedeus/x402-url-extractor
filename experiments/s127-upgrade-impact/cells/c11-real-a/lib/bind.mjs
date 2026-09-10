import { changeKindFor } from "./export-diff.mjs";

/**
 * Bind caller usage to an export diff.
 *
 * Decision rules (PACKET-CONTRACT.md):
 * 1. Newer version alone ≠ break.
 * 2. Unused export change ≠ caller defect.
 * 3. Conflicting/missing/partial source ⇒ unknown, not action.
 * 4. Dynamic import of package ⇒ unknown for that surface.
 * 5. Alias/workspace/lockfile disagreement ⇒ unknown.
 * 6. Same-version/no-op ⇒ no_action.
 */
export function bindUsageToDiff({
  usage,
  diff,
  extraSymbols = [],
  dynamicImport = false,
  sameVersion = false,
  sourceUnknown = false,
} = {}) {
  const importedBySymbol = new Map();
  for (const item of usage?.imports || []) {
    const prev = importedBySymbol.get(item.imported) || { imported: false, used: false };
    importedBySymbol.set(item.imported, {
      imported: true,
      used: prev.used || item.used === true,
    });
  }

  const symbols = new Set([
    ...diff.added,
    ...diff.removed,
    ...diff.signatureChanged,
    ...diff.kept,
    ...importedBySymbol.keys(),
    ...extraSymbols,
  ]);

  const bindings = [...symbols].sort().map((symbol) => {
    const refs = importedBySymbol.get(symbol) || { imported: false, used: false };
    const changeKind = changeKindFor(symbol, diff) || "unchanged";
    return {
      symbol,
      imported: refs.imported,
      used: refs.used,
      changeKind,
      ...decide({
        symbol,
        used: refs.used,
        imported: refs.imported,
        changeKind,
        dynamicImport,
        sameVersion,
        sourceUnknown,
      }),
    };
  });

  const actionableChanges = bindings
    .filter((b) => b.decision === "action")
    .map((b) => b.symbol);
  const unusedChanges = bindings
    .filter(
      (b) =>
        b.decision === "no_action" &&
        b.changeKind !== "unchanged" &&
        b.used === false,
    )
    .map((b) => b.symbol);
  const unknownReasons = [
    ...new Set(bindings.flatMap((b) => b.unknownReasons || [])),
  ];

  let nextAction = "no_action";
  if (bindings.some((b) => b.decision === "action")) nextAction = "action";
  else if (bindings.some((b) => b.decision === "unknown") || unknownReasons.length)
    nextAction = "unknown";

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

function decide({
  symbol,
  used,
  changeKind,
  dynamicImport,
  sameVersion,
  sourceUnknown,
}) {
  if (sourceUnknown) {
    return {
      decision: "unknown",
      rationale: `source for ${symbol} is missing, conflicting, or partial`,
      unknownReasons: ["partial-or-missing-source"],
    };
  }
  if (dynamicImport && used) {
    return {
      decision: "unknown",
      rationale: `dynamic import of the package makes usage of ${symbol} unknown`,
      unknownReasons: ["dynamic-import"],
    };
  }
  if (sameVersion) {
    return {
      decision: "no_action",
      rationale: "same-version/no-op is not a break",
      unknownReasons: [],
    };
  }
  if (changeKind === "unchanged" || changeKind == null) {
    return {
      decision: "no_action",
      rationale: `${symbol} is present in both versions at this coverage; a newer version alone is not a break`,
      unknownReasons: [],
    };
  }
  if (!used) {
    return {
      decision: "no_action",
      rationale: `unused export change (${symbol} ${changeKind}) is not a caller defect`,
      unknownReasons: [],
    };
  }
  if (changeKind === "removed") {
    return {
      decision: "action",
      rationale: `caller uses ${symbol}, which is a public export in the old entry and is not exported from the new entry`,
      unknownReasons: [],
    };
  }
  if (changeKind === "signatureChanged") {
    return {
      decision: "action",
      rationale: `caller uses ${symbol} with the old JS arity/return shape; official new JS changes that shape`,
      unknownReasons: [],
    };
  }
  if (changeKind === "added") {
    return {
      decision: "no_action",
      rationale: `caller references added export ${symbol}; presence of a new export is not itself a break`,
      unknownReasons: [],
    };
  }
  return {
    decision: "unknown",
    rationale: `unclassified changeKind ${changeKind} for ${symbol}`,
    unknownReasons: ["unclassified-change-kind"],
  };
}
