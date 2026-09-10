import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIFACT_KIND,
  BASELINE_LIMITATIONS,
  CHECKLIST_KINDS,
  CITATIONS,
  COVERAGE_STATES,
  DECISIONS,
  EVIDENCE_CLASSES,
  INPUT_FIELDS,
  INPUT_SCHEMA,
  JOB_ID,
  OUTPUT_FIELDS,
  OUTPUT_SCHEMA,
  PACKET_SCHEMA,
  PINNED_SOURCE_HASHES,
  assertFieldCatalogCited,
  assertPinnedSources,
  caseConflictDuplicateDoc,
  caseConflictRoutePath,
  caseNegativeInventedClock,
  caseNegativeMissingClock,
  caseNegativePaidClaim,
  casePartialOneSide,
  casePositive,
  classifyInputCoverage,
  outputShell,
  selfCheck,
  sha256Hex,
  validateFinding,
  validateInput,
  validateOutput,
} from "../../src/migration-checklist/schema.mjs";

test("field catalog is fully cited and pack sources match pins", () => {
  assert.deepEqual(assertFieldCatalogCited(), []);
  assert.deepEqual(assertPinnedSources(), []);
  for (const row of CITATIONS) {
    assert.equal(typeof row.id, "string");
    assert.equal(typeof row.source, "string");
    if (!row.missing) {
      assert.match(row.sha256, /^[0-9a-f]{64}$/);
    }
  }
  for (const field of [...INPUT_FIELDS, ...OUTPUT_FIELDS]) {
    assert.ok(field.citationIds.length >= 1, field.name);
  }
});

test("positive: old/new docs + ops inventory + citations is complete", () => {
  const result = validateInput(casePositive());
  assert.equal(result.status, "ok");
  assert.equal(result.ok, true);
  assert.equal(result.coverage, "complete");
  assert.equal(result.input.schema, INPUT_SCHEMA);
  assert.equal(result.input.operations[0].key, "GET /extract");
  assert.equal(result.input.operations[0].operationId, "extractWebPage");
  assert.equal(result.input.sourcePin.ref, "1a23b648e3c5f90bc009accb85972e2db6e22051");
  assert.equal(result.input.claims.paidEndpoint, false);
  assert.equal(result.input.oldDocs[0].side, "old");
  assert.equal(result.input.newDocs[0].side, "new");
});

test("negative: missing clock is invalid and not invented", () => {
  const result = validateInput(caseNegativeMissingClock());
  assert.equal(result.status, "invalid");
  assert.equal(result.ok, false);
  assert.equal(result.input, null);
  assert.ok(result.issues.some((row) => row.instancePath === "/clock" && row.code === "required"));
});

test("negative: clock \"now\" is invented_clock", () => {
  const result = validateInput(caseNegativeInventedClock());
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "invented_clock"));
});

test("negative: paidEndpoint claim is invalid", () => {
  const result = validateInput(caseNegativePaidClaim());
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "paid_endpoint"));
});

test("negative: uncited finding is invalid", () => {
  const result = validateFinding({ message: "no cites" }, new Set(["x"]));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "missing_citation"));
});

test("negative: unknown evidenceClass is invalid", () => {
  const result = validateInput({ ...casePositive(), evidenceClass: "owner-qa" });
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.instancePath === "/evidenceClass"));
});

test("partial: only old docs present", () => {
  const result = validateInput(casePartialOneSide());
  assert.equal(result.coverage, "partial");
  assert.equal(result.status, "unknown");
  assert.ok(result.issues.some((row) => row.code === "partial_coverage"));
  assert.equal(result.input.oldDocs.length, 1);
  assert.equal(result.input.newDocs.length, 0);
});

test("partial: empty operation inventory", () => {
  const result = validateInput({ ...casePositive(), operations: [] });
  assert.equal(result.coverage, "partial");
  assert.ok(result.issues.some((row) => row.instancePath === "/operations"));
});

test("partial: omitted STATE inventory is not invented", () => {
  const base = casePositive();
  delete base.stateInventory;
  const result = validateInput(base);
  assert.equal(result.coverage, "partial");
  assert.ok(result.issues.some((row) => row.instancePath === "/stateInventory" && row.code === "missing_source"));
  assert.equal(result.input.stateInventory, null);
});

test("conflict: duplicate old doc id with disagreeing sha256", () => {
  const result = validateInput(caseConflictDuplicateDoc());
  assert.equal(result.coverage, "conflict");
  assert.ok(result.issues.some((row) => row.code === "conflicting_source"));
});

test("conflict: operation.route disagrees with operation.path", () => {
  const result = validateInput(caseConflictRoutePath());
  assert.equal(result.coverage, "conflict");
  assert.ok(result.issues.some((row) => row.code === "conflicting_source"));
});

test("conflict: two citations same path different sha256", () => {
  const base = casePositive();
  base.citations = [
    { id: "a", source: "README.md", path: "README.md", sha256: sha256Hex("a") },
    { id: "b", source: "README.md", path: "README.md", sha256: sha256Hex("b") },
  ];
  const result = validateInput(base);
  assert.equal(result.coverage, "conflict");
  assert.ok(result.issues.some((row) => row.code === "conflicting_source"));
});

test("output shell uses packet envelope without inventing spend", () => {
  const shell = outputShell({ clock: "2026-09-10T00:00:00Z" });
  assert.equal(shell.schema, OUTPUT_SCHEMA);
  assert.equal(shell.packetSchema, PACKET_SCHEMA);
  assert.equal(shell.jobId, JOB_ID);
  assert.equal(shell.artifactKind, ARTIFACT_KIND);
  assert.equal(shell.offline, true);
  assert.equal(shell.payment.attempted, false);
  assert.equal(shell.cost.assignmentSpendUsd, 0);
  assert.equal(shell.decision, "unknown");
  assert.equal(shell.coverage, "missing");
  assert.ok(BASELINE_LIMITATIONS.every((row) => shell.limitations.includes(row)));
});

test("output: cited checklist is ok; pass on conflict is invalid", () => {
  const shell = outputShell({ clock: "2026-09-10T00:00:00Z" });
  const citations = casePositive().citations;
  const ok = validateOutput({
    ...shell,
    coverage: "complete",
    decision: "unknown",
    citations,
    findings: [
      {
        message: "schema does not parse bodies",
        citationIds: ["old-readme"],
        code: "partial_coverage",
      },
    ],
    checklist: [
      {
        id: "row-1",
        kind: "changed",
        subject: "GET /extract",
        citationIds: ["old-readme", "new-readme"],
        coverage: "complete",
      },
    ],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.output.checklist[0].kind, "changed");

  const bad = validateOutput({
    ...shell,
    coverage: "conflict",
    decision: "pass",
    citations,
    findings: [{ message: "x", citationIds: ["old-readme"] }],
    checklist: [
      { id: "row-c", kind: "conflict", subject: "GET /extract", citationIds: ["old-readme"] },
    ],
  });
  assert.equal(bad.status, "invalid");
  assert.ok(bad.issues.some((row) => row.instancePath === "/decision"));
});

test("coverage classifier and closed enums stay source-aligned", () => {
  assert.deepEqual([...EVIDENCE_CLASSES], ["synthetic", "fixture", "live-capture"]);
  assert.deepEqual([...DECISIONS], ["pass", "fail", "partial", "conflict", "unknown"]);
  assert.ok(CHECKLIST_KINDS.includes("changed"));
  assert.ok(CHECKLIST_KINDS.includes("missing"));
  assert.ok(COVERAGE_STATES.includes("conflict"));
  assert.equal(
    classifyInputCoverage({
      oldDocs: [],
      newDocs: [],
      operations: [],
      citations: [],
      conflicts: false,
      stateInventory: null,
    }),
    "missing",
  );
});

test("self-check covers positive, negative, partial, and conflict", () => {
  const result = selfCheck();
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
});
