/** Isolation stub for c31 CLI wiring. Copies only fields present on the fixture. */

export function transform(ctx) {
  const bag = ctx && typeof ctx === "object" && !Array.isArray(ctx) ? ctx : {};
  const input =
    bag.input && typeof bag.input === "object" && !Array.isArray(bag.input) && bag.oldDoc == null
      ? bag.input
      : bag;
  const cite = bag.sources?.[0]?.id || "in:0";
  const citations = [
    {
      id: cite,
      path: bag.inputPath || bag.path || null,
      sha256: bag.sources?.[0]?.sha256 || null,
      note: "operator --in bytes; synthetic isolation fixture",
    },
  ];

  const oldPath = input.oldDoc && typeof input.oldDoc.path === "string" ? input.oldDoc.path : null;
  const newPath = input.newDoc && typeof input.newDoc.path === "string" ? input.newDoc.path : null;
  const alt = input.alternateOldDoc && typeof input.alternateOldDoc === "object" ? input.alternateOldDoc : null;

  if (alt && oldPath && alt.path === oldPath && alt.sha256 && input.oldDoc.sha256 && alt.sha256 !== input.oldDoc.sha256) {
    return {
      decision: "conflict",
      citations,
      findings: [
        {
          id: "stub.conflict-old-hash",
          message: `fixture supplies two sha256 values for ${oldPath}`,
          citationIds: [cite],
        },
      ],
      artifact: { kind: "migration-checklist", oldPath, newPath, conflictPath: oldPath },
      limitations: ["isolation stub; not the pack transform cell"],
    };
  }

  if (oldPath && !newPath) {
    return {
      decision: "partial",
      citations,
      findings: [
        {
          id: "stub.partial-missing-new",
          message: `oldDoc.path present (${oldPath}); newDoc.path absent`,
          citationIds: [cite],
        },
      ],
      artifact: { kind: "migration-checklist", oldPath, newPath: null },
      limitations: ["isolation stub; not the pack transform cell"],
    };
  }

  if (oldPath && newPath) {
    return {
      decision: "pass",
      citations,
      findings: [
        {
          id: "stub.old-and-new-present",
          message: `fixture lists oldDoc.path=${oldPath} and newDoc.path=${newPath}`,
          citationIds: [cite],
        },
      ],
      artifact: { kind: "migration-checklist", oldPath, newPath },
      limitations: ["isolation stub; not the pack transform cell"],
    };
  }

  return {
    decision: "fail",
    citations,
    findings: [
      {
        id: "stub.missing-docs",
        message: "fixture has no oldDoc.path",
        citationIds: [cite],
      },
    ],
    artifact: { kind: "migration-checklist", oldPath, newPath },
    limitations: ["isolation stub; not the pack transform cell"],
  };
}
