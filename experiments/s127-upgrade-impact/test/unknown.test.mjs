import assert from "node:assert/strict";
import test from "node:test";
import { loadPipeline } from "./helpers.mjs";

test("applyUnknownRules demotes action when alias/workspace disagreement is present", async () => {
  const { impl } = await loadPipeline();
  const overlay = impl.applyUnknownRules({
    bindings: [
      {
        symbol: "alpha",
        used: true,
        changeKind: "removed",
        decision: "action",
        rationale: "used removed",
      },
    ],
    exportDiff: { coverage: "full" },
    lockfile: {
      disagreements: [{ kind: "alias_or_workspace", requested: "npm:demo-widget@1.0.0", resolved: "1.0.0" }],
      unknownReasons: ["alias_or_workspace"],
    },
    dependency: { name: "widget", oldVersion: "1.0.0", newVersion: "2.0.0" },
  });
  assert.equal(overlay.bindings[0].decision, "unknown");
  assert.ok(overlay.unknownReasons.includes("alias_or_workspace"));
});

test("applyUnknownRules same version with different hashes is unknown, not action", async () => {
  const { impl } = await loadPipeline();
  const overlay = impl.applyUnknownRules({
    bindings: [
      {
        symbol: "alpha",
        used: true,
        changeKind: "removed",
        decision: "action",
        rationale: "used removed",
      },
    ],
    exportDiff: { coverage: "full" },
    lockfile: { disagreements: [] },
    dependency: { oldVersion: "1.0.0", newVersion: "1.0.0" },
    acquire: { old: { treeSha256: "aaa" }, new: { treeSha256: "bbb" } },
  });
  assert.ok(overlay.unknownReasons.includes("conflicting_source_same_version"));
  assert.equal(overlay.bindings[0].decision, "unknown");
});
