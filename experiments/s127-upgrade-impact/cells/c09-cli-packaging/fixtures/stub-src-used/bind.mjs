/** Isolation stub: used export removed. Not a production analyzer. */
export function bind() {
  return {
    usage: {
      items: [{ specifier: "demo-dep", symbols: ["alpha"], dynamicImport: false }],
      dynamicImport: false,
      coverage: "complete",
    },
    exportDiff: {
      added: ["beta"],
      removed: ["alpha"],
      renamed: [],
      signatureChanged: [],
      coverage: "complete",
    },
    bindings: [
      {
        symbol: "alpha",
        used: true,
        changeKind: "removed",
        decision: "action",
        rationale: "caller imports alpha; export removed between old and new",
      },
    ],
  };
}
