function usageRows(usage) {
  if (!usage) return [];
  if (Array.isArray(usage)) return usage;
  if (Array.isArray(usage.usage)) return usage.usage;
  return [];
}

function changeIndex(exportDiff) {
  const removed = new Set(exportDiff?.removed || []);
  const added = new Set(exportDiff?.added || []);
  const signatureChanged = new Set(exportDiff?.signatureChanged || []);
  const renamedFrom = new Map();
  for (const row of exportDiff?.renamed || []) renamedFrom.set(row.from, row.to);
  return { removed, added, signatureChanged, renamedFrom };
}

function changeForSymbol(symbol, index) {
  if (symbol == null || symbol === "*") return null;
  if (index.renamedFrom.has(symbol)) return { changeKind: "renamed", to: index.renamedFrom.get(symbol) };
  if (index.removed.has(symbol)) return { changeKind: "removed" };
  if (index.signatureChanged.has(symbol)) return { changeKind: "signatureChanged" };
  if (index.added.has(symbol)) return { changeKind: "added" };
  return { changeKind: "unchanged" };
}

export function bindUsageToDiff({ usage, exportDiff, dependency } = {}) {
  const rows = usageRows(usage).filter((row) => !row.typeOnly);
  const index = changeIndex(exportDiff);
  const bindings = [];
  const unknownReasons = [];
  const usedSymbols = new Set();
  const packageName = dependency?.name;
  const relevant = rows.filter((row) => {
    if (!packageName) return true;
    if (!row.specifier) return Boolean(row.dynamicImport);
    return row.specifier === packageName || row.specifier.startsWith(`${packageName}/`);
  });

  const dynamicSurface = relevant.some((row) => row.dynamicImport);

  for (const row of relevant) {
    if (row.dynamicImport) {
      unknownReasons.push("dynamic_import");
      const change = changeForSymbol(row.symbol === "*" ? null : row.symbol, index);
      bindings.push({
        symbol: row.symbol || "*",
        used: true,
        changeKind: change?.changeKind || (index.removed.size || index.renamedFrom.size || index.signatureChanged.size ? "unknown" : "unchanged"),
        decision: "unknown",
        rationale: "dynamic import of package; contribution is unknown",
        dynamicImport: true,
      });
      continue;
    }
    if (row.kind === "namespace" || row.symbol === "*") {
      usedSymbols.add("*");
      const changed = [
        ...[...index.removed].map((symbol) => ({ symbol, changeKind: "removed" })),
        ...[...index.renamedFrom.keys()].map((symbol) => ({ symbol, changeKind: "renamed" })),
        ...[...index.signatureChanged].map((symbol) => ({ symbol, changeKind: "signatureChanged" })),
      ];
      if (!changed.length) {
        bindings.push({
          symbol: "*",
          used: true,
          changeKind: "unchanged",
          decision: "no_action",
          rationale: "namespace import; no recorded export changes",
          dynamicImport: false,
        });
      } else {
        for (const item of changed) {
          usedSymbols.add(item.symbol);
          bindings.push({
            symbol: item.symbol,
            used: true,
            changeKind: item.changeKind,
            decision: "action",
            rationale: `namespace import uses package surface; ${item.symbol} ${item.changeKind}`,
            dynamicImport: false,
          });
        }
      }
      continue;
    }
    const symbol = row.symbol || "default";
    usedSymbols.add(symbol);
    const change = changeForSymbol(symbol, index) || { changeKind: "unknown" };
    let decision = "no_action";
    let rationale = `caller imports ${symbol}; export is ${change.changeKind}`;
    if (change.changeKind === "removed" || change.changeKind === "renamed" || change.changeKind === "signatureChanged") {
      decision = "action";
      rationale =
        change.changeKind === "renamed"
          ? `caller imports ${symbol} which is renamed to ${change.to}`
          : `caller imports ${symbol} which is ${change.changeKind} in the new package`;
    } else if (change.changeKind === "unknown") {
      decision = "unknown";
      rationale = `caller imports ${symbol}; export status is unknown`;
    }
    bindings.push({
      symbol,
      used: true,
      changeKind: change.changeKind,
      decision,
      rationale,
      dynamicImport: false,
    });
  }

  const changedSymbols = [
    ...[...index.removed].map((symbol) => ({ symbol, changeKind: "removed" })),
    ...[...index.renamedFrom.keys()].map((symbol) => ({ symbol, changeKind: "renamed" })),
    ...[...index.signatureChanged].map((symbol) => ({ symbol, changeKind: "signatureChanged" })),
    ...[...index.added].map((symbol) => ({ symbol, changeKind: "added" })),
  ];

  for (const item of changedSymbols) {
    if (usedSymbols.has(item.symbol) || usedSymbols.has("*")) continue;
    if (dynamicSurface && item.changeKind !== "added") {
      continue;
    }
    bindings.push({
      symbol: item.symbol,
      used: false,
      changeKind: item.changeKind,
      decision: "no_action",
      rationale: "unused export change is not a caller defect",
      dynamicImport: false,
    });
  }

  const dedup = [];
  const seen = new Set();
  for (const row of bindings) {
    const key = `${row.symbol}::${row.used}::${row.changeKind}::${row.decision}::${row.dynamicImport}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(row);
  }
  dedup.sort((a, b) => {
    const ka = `${a.symbol}|${a.used}|${a.changeKind}`;
    const kb = `${b.symbol}|${b.used}|${b.changeKind}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return { bindings: dedup, unknownReasons: [...new Set(unknownReasons)] };
}
