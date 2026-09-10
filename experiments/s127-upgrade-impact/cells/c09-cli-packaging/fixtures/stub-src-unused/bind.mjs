/** Isolation stub: unused export removed (illegally tagged action so CLI must coerce). */
export function bind() {
  return {
    usage: {
      items: [],
      dynamicImport: false,
      coverage: "complete",
    },
    exportDiff: {
      added: [],
      removed: ["gamma"],
      renamed: [],
      signatureChanged: [],
      coverage: "complete",
    },
    bindings: [
      {
        symbol: "gamma",
        used: false,
        changeKind: "removed",
        decision: "action",
        rationale: "export removed but caller does not import it",
      },
    ],
  };
}
