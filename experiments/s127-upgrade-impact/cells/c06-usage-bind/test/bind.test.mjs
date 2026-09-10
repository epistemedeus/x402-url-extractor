import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ACTION_CHANGE_KINDS,
  BIND_SCHEMA,
  CHANGE_KINDS,
  DECISIONS,
  NEXT_ACTIONS,
  applyBindToPacket,
  bind,
  bindUsageToExportDiff,
  selectBindNextAction,
} from "../bind.mjs";
import { bindUsageToExportDiff as bindFromSrc } from "../../../src/bind.mjs";
import { makeUsage, namedRefs } from "../stubs/usage.mjs";
import { makeExportDiff } from "../stubs/export-diff.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../fixtures");

function loadFixtures() {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".json") && name !== "PROVENANCE.json")
    .map((name) => {
      const raw = JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
      return { name, ...raw };
    });
}

function bySymbol(bindings) {
  const map = new Map();
  for (const row of bindings) map.set(row.symbol, row);
  return map;
}

test("cell bind re-export matches src/bind.mjs", () => {
  assert.equal(bindUsageToExportDiff, bindFromSrc);
});

test("synthetic fixtures: nextAction, decisions, unused vs actionable", () => {
  const fixtures = loadFixtures();
  assert.ok(fixtures.length >= 12, "expected a full synthetic matrix");
  for (const fixture of fixtures) {
    assert.equal(fixture.label, "synthetic", `${fixture.id} must be labeled synthetic`);
    const result = bindUsageToExportDiff(fixture.input);
    const expect = fixture.expect;
    assert.equal(
      result.summary.nextAction,
      expect.nextAction,
      `${fixture.id} nextAction`,
    );
    assert.deepEqual(
      result.summary.actionableChanges.map((row) => row.symbol).sort(),
      [...expect.actionableSymbols].sort(),
      `${fixture.id} actionableSymbols`,
    );
    assert.deepEqual(
      result.summary.unusedChanges.map((row) => row.symbol).sort(),
      [...expect.unusedSymbols].sort(),
      `${fixture.id} unusedSymbols`,
    );
    const map = bySymbol(result.bindings);
    for (const [symbol, decision] of Object.entries(expect.decisions || {})) {
      assert.ok(map.has(symbol), `${fixture.id} missing binding ${symbol}`);
      assert.equal(map.get(symbol).decision, decision, `${fixture.id} ${symbol} decision`);
    }
    for (const [symbol, kind] of Object.entries(expect.changeKinds || {})) {
      assert.equal(map.get(symbol).changeKind, kind, `${fixture.id} ${symbol} changeKind`);
    }
    if (expect.nextAction !== "unknown") {
      for (const row of result.bindings) {
        if (row.decision === "action") {
          assert.ok(ACTION_CHANGE_KINDS.includes(row.changeKind), `${fixture.id} action kind`);
        }
      }
    }
  }
});

test("bindings always carry packet-contract fields", () => {
  const result = bind({
    usage: makeUsage({ references: namedRefs("foo") }),
    exportDiff: makeExportDiff({ removed: ["foo"] }),
  });
  assert.equal(result.schema, BIND_SCHEMA);
  assert.ok(NEXT_ACTIONS.includes(result.summary.nextAction));
  for (const row of result.bindings) {
    assert.equal(typeof row.symbol, "string");
    assert.equal(typeof row.used, "boolean");
    assert.ok(CHANGE_KINDS.includes(row.changeKind));
    assert.ok(DECISIONS.includes(row.decision));
    assert.equal(typeof row.rationale, "string");
  }
});

test("used+removed is action; unused change is not a caller defect", () => {
  const result = bindUsageToExportDiff({
    usage: makeUsage({ references: namedRefs("keep") }),
    exportDiff: makeExportDiff({ removed: ["keep", "drop"] }),
    dependency: { name: "demo-pkg", oldVersion: "1.0.0", newVersion: "2.0.0" },
  });
  const map = bySymbol(result.bindings);
  assert.equal(map.get("keep").decision, "action");
  assert.equal(map.get("keep").used, true);
  assert.equal(map.get("drop").decision, "no_action");
  assert.equal(map.get("drop").used, false);
  assert.equal(result.summary.nextAction, "review_breakages");
  assert.equal(map.get("drop").ruleId, "unused_change_not_caller_defect");
});

test("partial or missing source never emits decision=action", () => {
  const cases = [
    { usage: makeUsage({ references: namedRefs("foo") }), exportDiff: makeExportDiff({ coverage: "partial", removed: ["foo"] }) },
    { usage: makeUsage({ coverage: "unknown", references: namedRefs("foo") }), exportDiff: makeExportDiff({ removed: ["foo"] }) },
    { usage: makeUsage({ missingEvidence: true, references: namedRefs("foo") }), exportDiff: makeExportDiff({ removed: ["foo"] }) },
    { usage: null, exportDiff: makeExportDiff({ removed: ["foo"] }), dependency: { oldVersion: "1", newVersion: "2" } },
    { usage: makeUsage({ references: namedRefs("foo") }), exportDiff: null, dependency: { oldVersion: "1", newVersion: "2" } },
  ];
  for (const input of cases) {
    const result = bindUsageToExportDiff(input);
    assert.equal(result.summary.nextAction, "unknown");
    assert.equal(result.summary.actionableChanges.length, 0);
    for (const row of result.bindings) {
      assert.notEqual(row.decision, "action");
    }
  }
});

test("selectBindNextAction priority: breakages > edits > unknown > no_action", () => {
  assert.equal(
    selectBindNextAction({ hasUsedRemoved: true, hasUsedEdits: true, unknownReasons: ["x"] }),
    "review_breakages",
  );
  assert.equal(
    selectBindNextAction({ hasUsedRemoved: false, hasUsedEdits: true, unknownReasons: ["x"] }),
    "upgrade_with_edits",
  );
  assert.equal(
    selectBindNextAction({ hasUsedRemoved: false, hasUsedEdits: false, unknownReasons: ["x"] }),
    "unknown",
  );
  assert.equal(selectBindNextAction({}), "no_action");
});

test("same version with exportDiff changes is conflicting unknown", () => {
  const result = bindUsageToExportDiff({
    dependency: { name: "demo-pkg", oldVersion: "1.0.0", newVersion: "1.0.0" },
    usage: makeUsage({ references: namedRefs("foo") }),
    exportDiff: makeExportDiff({ removed: ["foo"] }),
  });
  assert.equal(result.summary.nextAction, "unknown");
  assert.equal(result.summary.actionableChanges.length, 0);
  assert.ok(result.summary.unknownReasons.some((row) => /same declared version/.test(row)));
});

test("resolved version disagreement is unknown", () => {
  const result = bindUsageToExportDiff({
    dependency: {
      name: "demo-pkg",
      oldVersion: "1.0.0",
      newVersion: "1.0.0",
      resolvedOld: "1.0.0",
      resolvedNew: "1.0.0-workspace",
    },
    usage: makeUsage({ references: namedRefs("foo") }),
    exportDiff: makeExportDiff(),
  });
  assert.equal(result.summary.nextAction, "unknown");
});

test("applyBindToPacket writes bindings and summary onto known packet fields", () => {
  const packet = applyBindToPacket({
    schema: "s127.upgrade-impact.packet.v1",
    clock: "2026-09-10T00:00:00Z",
    usage: makeUsage({ references: namedRefs("foo") }),
    exportDiff: makeExportDiff({ signatureChanged: ["foo"] }),
    extraHostile: { nested: true },
    limitations: ["caller-supplied limitation"],
  });
  assert.equal(packet.summary.nextAction, "upgrade_with_edits");
  assert.equal(packet.bindings[0].decision, "action");
  assert.equal("extraHostile" in packet, false);
  assert.ok(packet.limitations.includes("caller-supplied limitation"));
});

test("hostile input does not throw and does not claim action", () => {
  const inputs = [
    undefined,
    null,
    "not-an-object",
    12,
    { usage: "nope", exportDiff: 3 },
    { usage: { coverage: "complete", references: [{ symbol: { __proto__: { polluted: true } } }] }, exportDiff: { coverage: "complete", removed: [null, undefined, { symbol: 1 }] } },
    { usage: Object.create(null), exportDiff: Object.create(null) },
  ];
  for (const input of inputs) {
    const result = bindUsageToExportDiff(input);
    assert.ok(NEXT_ACTIONS.includes(result.summary.nextAction));
    assert.equal(result.summary.actionableChanges.length, 0);
    for (const row of result.bindings) assert.notEqual(row.decision, "action");
  }
});

test("bare usage array is treated as complete listed references", () => {
  const result = bindUsageToExportDiff({
    usage: ["foo"],
    exportDiff: makeExportDiff({ removed: ["foo"] }),
  });
  assert.equal(result.summary.nextAction, "review_breakages");
  assert.equal(result.bindings[0].decision, "action");
});

test("rename target is not also an unused added export", () => {
  const result = bindUsageToExportDiff({
    usage: makeUsage({ references: namedRefs("oldName") }),
    exportDiff: makeExportDiff({
      renamed: [{ from: "oldName", to: "newName" }],
      added: ["newName"],
    }),
  });
  assert.equal(result.summary.nextAction, "upgrade_with_edits");
  assert.deepEqual(
    result.bindings.map((row) => row.symbol),
    ["oldName"],
  );
  assert.equal(result.bindings[0].renamedTo, "newName");
});

test("rename without a target name is treated as removed", () => {
  const result = bindUsageToExportDiff({
    usage: makeUsage({ references: namedRefs("oldName") }),
    exportDiff: makeExportDiff({ renamed: [{ from: "oldName" }] }),
  });
  assert.equal(result.summary.nextAction, "review_breakages");
  assert.equal(result.bindings[0].changeKind, "removed");
});

test("c03 usage.v1 + c05 export-diff.v1 shapes bind used+removed", () => {
  const result = bindUsageToExportDiff({
    dependency: { name: "example-dep", oldVersion: "1.0.0", newVersion: "2.0.0" },
    usage: {
      ok: true,
      schema: "s127.upgrade-impact.usage.v1",
      packageName: "example-dep",
      filesScanned: 1,
      filesSkipped: [],
      filesPartial: [],
      filesUnknown: [],
      unresolvedDynamics: [],
      limitations: ["No TypeScript type-aware analysis"],
      usage: [
        {
          file: "src/app.js",
          specifier: "example-dep",
          names: ["foo"],
          dynamic: false,
          dynamicImport: false,
          kind: "import",
          coverage: "static",
          language: "js",
          defaultImport: false,
          namespaceImport: false,
        },
      ],
    },
    exportDiff: {
      ok: true,
      schema: "s127.upgrade-impact.export-diff.v1",
      exportDiff: {
        added: [],
        removed: [{ name: "foo", symbol: "foo", kind: "named", entry: ".", changeKind: "removed" }],
        renamed: [],
        signatureChanged: [],
        coverage: "full",
      },
      limitations: ["Not a full TypeScript checker"],
    },
  });
  assert.equal(result.summary.nextAction, "review_breakages");
  assert.equal(result.bindings[0].symbol, "foo");
  assert.equal(result.bindings[0].decision, "action");
  assert.equal(result.bindings[0].used, true);
});

test("c03 ok:false is missing usage evidence", () => {
  const result = bindUsageToExportDiff({
    usage: { ok: false, error: { code: "missing_package_name" } },
    exportDiff: { coverage: "full", removed: ["foo"] },
    dependency: { oldVersion: "1.0.0", newVersion: "2.0.0" },
  });
  assert.equal(result.summary.nextAction, "unknown");
  assert.equal(result.summary.actionableChanges.length, 0);
});

test("dynamic import plus only added exports is still no_action", () => {
  const result = bindUsageToExportDiff({
    usage: makeUsage({ dynamicImport: true, references: [] }),
    exportDiff: makeExportDiff({ added: ["shinyNew"] }),
    dependency: { name: "demo-pkg", oldVersion: "1.0.0", newVersion: "1.1.0" },
  });
  assert.equal(result.summary.nextAction, "no_action");
  assert.equal(result.bindings[0].decision, "no_action");
  assert.equal(result.bindings[0].ruleId, "newer_version_not_break");
});

test("PROVENANCE labels fixtures as synthetic, not live-capture", () => {
  const provenance = JSON.parse(readFileSync(join(fixturesDir, "PROVENANCE.json"), "utf8"));
  assert.equal(provenance.label, "synthetic");
  assert.equal(provenance.url, null);
  assert.equal(provenance.retrievedAt, null);
});
