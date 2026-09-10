import assert from "node:assert/strict";
import test from "node:test";
import { loadPipeline } from "./helpers.mjs";

test("rule 1+2: unused removed export is no_action even when version changes", async () => {
  const { impl } = await loadPipeline();
  const bound = impl.bindUsageToDiff({
    usage: [{ specifier: "demo-widget", symbol: "beta", kind: "named", dynamicImport: false }],
    exportDiff: { added: [], removed: ["alpha"], renamed: [], signatureChanged: [], coverage: "full" },
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "2.0.0" },
  });
  const overlay = impl.applyUnknownRules({
    bindings: bound.bindings,
    exportDiff: { coverage: "full" },
    usage: bound,
    lockfile: { disagreements: [], unknownReasons: [] },
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "2.0.0" },
  });
  const summary = impl.summarizeBindings(overlay.bindings, overlay.unknownReasons);
  assert.equal(summary.nextAction, "no_action");
  assert.ok(summary.unusedChanges.some((row) => row.symbol === "alpha"));
  assert.equal(summary.actionableChanges.length, 0);
});

test("rule 3: partial source demotes action to unknown", async () => {
  const { impl } = await loadPipeline();
  const bound = impl.bindUsageToDiff({
    usage: [{ specifier: "demo-widget", symbol: "alpha", kind: "named", dynamicImport: false }],
    exportDiff: { added: [], removed: ["alpha"], renamed: [], signatureChanged: [], coverage: "partial" },
    dependency: { name: "demo-widget" },
  });
  const used = bound.bindings.find((row) => row.symbol === "alpha" && row.used);
  assert.equal(used.decision, "action");
  const overlay = impl.applyUnknownRules({
    bindings: bound.bindings,
    exportDiff: { coverage: "partial" },
    lockfile: { disagreements: [] },
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "2.0.0" },
    acquire: { old: { coverage: "full" }, new: { coverage: "partial" } },
  });
  const summary = impl.summarizeBindings(overlay.bindings, overlay.unknownReasons);
  assert.equal(summary.nextAction, "unknown");
  assert.ok(overlay.unknownReasons.includes("partial_source"));
  assert.equal(summary.actionableChanges.length, 0);
});

test("rule 4: dynamic import is unknown for that surface", async () => {
  const { impl } = await loadPipeline();
  const bound = impl.bindUsageToDiff({
    usage: [{ specifier: "demo-widget", symbol: "*", kind: "dynamic", dynamicImport: true }],
    exportDiff: { added: [], removed: ["alpha"], renamed: [], signatureChanged: [], coverage: "full" },
    dependency: { name: "demo-widget" },
  });
  const overlay = impl.applyUnknownRules({
    bindings: bound.bindings,
    unknownReasons: bound.unknownReasons,
    exportDiff: { coverage: "full" },
    usage: [{ specifier: "demo-widget", symbol: "*", kind: "dynamic", dynamicImport: true }],
    lockfile: { disagreements: [] },
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "2.0.0" },
  });
  const summary = impl.summarizeBindings(overlay.bindings, overlay.unknownReasons);
  assert.equal(summary.nextAction, "unknown");
  assert.ok(overlay.unknownReasons.includes("dynamic_import"));
  assert.ok(overlay.bindings.every((row) => row.decision !== "action"));
});

test("rule 5: lockfile range disagreement is unknown", async () => {
  const { impl } = await loadPipeline();
  const overlay = impl.applyUnknownRules({
    bindings: [
      {
        symbol: "beta",
        used: true,
        changeKind: "unchanged",
        decision: "no_action",
        rationale: "unchanged",
      },
    ],
    exportDiff: { coverage: "full" },
    lockfile: {
      disagreements: [{ kind: "lockfile_range_disagreement", requested: "^1.0.0", resolved: "2.0.0-beta.1" }],
      unknownReasons: ["lockfile_range_disagreement"],
    },
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "2.0.0-beta.1" },
  });
  const summary = impl.summarizeBindings(overlay.bindings, overlay.unknownReasons);
  assert.equal(summary.nextAction, "unknown");
  assert.ok(overlay.unknownReasons.includes("lockfile_range_disagreement"));
  assert.ok(overlay.limitations.some((row) => String(row).includes("prerelease")));
});

test("rule 6: same-version identical trees force no_action", async () => {
  const { impl } = await loadPipeline();
  const overlay = impl.applyUnknownRules({
    bindings: [
      {
        symbol: "alpha",
        used: true,
        changeKind: "removed",
        decision: "action",
        rationale: "should be overridden",
      },
    ],
    exportDiff: { coverage: "full" },
    lockfile: { disagreements: [] },
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "1.0.0" },
    acquire: { old: { treeSha256: "abc" }, new: { treeSha256: "abc" } },
  });
  const summary = impl.summarizeBindings(overlay.bindings, overlay.unknownReasons);
  assert.equal(summary.nextAction, "no_action");
  assert.ok(overlay.bindings.every((row) => row.decision === "no_action"));
});
