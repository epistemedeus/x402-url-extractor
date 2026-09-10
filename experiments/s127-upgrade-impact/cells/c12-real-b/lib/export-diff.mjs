export function diffNamedExports(oldNames, newNames, { oldOverloads = {}, newOverloads = {}, changelogRenames = [] } = {}) {
  const oldSet = new Set(oldNames);
  const newSet = new Set(newNames);
  const added = [...newSet].filter((s) => !oldSet.has(s)).sort();
  const removed = [...oldSet].filter((s) => !newSet.has(s)).sort();
  const signatureChanged = [];
  for (const name of [...oldSet].filter((s) => newSet.has(s)).sort()) {
    const oc = oldOverloads[name] ?? 0;
    const nc = newOverloads[name] ?? 0;
    if (oc > 0 && nc > 0 && oc !== nc) {
      signatureChanged.push({
        symbol: name,
        kind: "dts-overload-count",
        oldOverloads: oc,
        newOverloads: nc,
        coverage: "dts-declare-function-overloads; not a type checker",
      });
    }
  }
  return {
    added,
    removed,
    renamed: changelogRenames,
    signatureChanged,
    coverage:
      "compiled-js-named-exports; dts-overload-count-partial; changelog-renames-optional; no-full-ts; no-runtime-exec",
  };
}
