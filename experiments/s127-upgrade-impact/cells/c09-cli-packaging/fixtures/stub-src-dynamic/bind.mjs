/** Isolation stub: used surface reached only via dynamic import. */
export function bind() {
  return {
    usage: {
      items: [{ specifier: "demo-dep", symbols: ["alpha"], dynamicImport: true }],
      dynamicImport: true,
      coverage: "complete",
    },
    exportDiff: {
      added: [],
      removed: ["alpha"],
      renamed: [],
      signatureChanged: [],
      coverage: "complete",
    },
    bindings: [
      {
        symbol: "alpha",
        used: true,
        dynamicImport: true,
        changeKind: "removed",
        decision: "action",
        rationale: "dynamic import; CLI must not keep action",
      },
    ],
  };
}
