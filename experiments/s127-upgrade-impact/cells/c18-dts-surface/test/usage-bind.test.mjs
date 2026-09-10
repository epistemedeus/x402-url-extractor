import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { extractUsageFromText, analyzeTypeUsage } from "../usage.mjs";
import { runCase, runAllCases } from "../run.mjs";

const cell = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (...p) => join(cell, "fixtures", ...p);

test("caller import type { Alpha } is type-only named usage", () => {
  const extracted = extractUsageFromText(
    `import type { Alpha } from "type-kit";\nexport type CallerAlpha = Alpha;\n`,
    { file: "types.ts", packageName: "type-kit" },
  );
  const alpha = extracted.references.find((r) => r.symbol === "Alpha");
  assert.ok(alpha);
  assert.equal(alpha.used, true);
  assert.equal(alpha.typeOnly, true);
  assert.equal(alpha.dynamicImport, false);
  assert.equal(alpha.specifier, "type-kit");
});

test("import = require uses export=", () => {
  const extracted = extractUsageFromText(`import TypeKit = require("type-kit/umd");\n`, {
    file: "app.ts",
    packageName: "type-kit",
  });
  const eq = extracted.references.find((r) => r.symbol === "export=");
  assert.ok(eq);
  assert.equal(eq.kind, "importEquals");
  assert.equal(eq.specifier, "type-kit/umd");
});

test("dynamic import(" + "type-kit) is unknown contribution", () => {
  const extracted = extractUsageFromText(
    `export async function load() { return import("type-kit"); }\n`,
    { file: "app.ts", packageName: "type-kit" },
  );
  assert.equal(extracted.dynamicImport, true);
  assert.ok(extracted.references.some((r) => r.kind === "dynamic"));
});

test("analyzeTypeUsage walks caller src", () => {
  const usage = analyzeTypeUsage([fx("callers/removed-type-used/src")], "type-kit");
  assert.equal(usage.coverage, "full");
  assert.equal(usage.dynamicImport, false);
  assert.equal(usage.bySymbol.Alpha.used, true);
  assert.equal(usage.bySymbol.Beta.used, true);
  assert.equal(usage.bySymbol.gamma.used, true);
  assert.ok(!usage.bySymbol.Delta);
});

test("case removed-type-used: action because used type was removed", () => {
  const result = runCase("removed-type-used");
  assert.equal(result.ok, true, (result.checks?.failures || []).join("; "));
  assert.equal(result.packet.summary.nextAction, "action");
  const alpha = result.packet.bindings.find((b) => b.symbol === "Alpha");
  assert.equal(alpha.decision, "action");
  assert.equal(alpha.used, true);
  assert.equal(alpha.changeKind, "removed");
  assert.equal(result.packet.engine.claimsFullChecker, false);
  assert.equal(result.packet.caller.evidenceClass, "fixture");
  assert.ok(result.packet.limitations.some((l) => /not live-capture/i.test(l)));
  assert.equal(result.scriptRanAbsent, true);
});

test("case removed-type-unused: unused change is not a caller defect", () => {
  const result = runCase("removed-type-unused");
  assert.equal(result.ok, true, (result.checks?.failures || []).join("; "));
  assert.equal(result.packet.summary.nextAction, "no_action");
  const delta = result.packet.bindings.find((b) => b.symbol === "Delta");
  assert.equal(delta.decision, "no_action");
  assert.equal(delta.used, false);
});

test("case export-eq-used: removed export= used by caller", () => {
  const result = runCase("export-eq-used");
  assert.equal(result.ok, true, (result.checks?.failures || []).join("; "));
  assert.equal(result.packet.summary.nextAction, "action");
});

test("case dynamic-type: unknown, not action", () => {
  const result = runCase("dynamic-type");
  assert.equal(result.ok, true, (result.checks?.failures || []).join("; "));
  assert.equal(result.packet.summary.nextAction, "unknown");
});

test("case unresolved-star: unknown because coverage is not full", () => {
  const result = runCase("unresolved-star");
  assert.equal(result.ok, true, (result.checks?.failures || []).join("; "));
  assert.equal(result.packet.summary.nextAction, "unknown");
  assert.notEqual(result.packet.exportDiff.coverage, "full");
});

test("case same-version-noop: no_action", () => {
  const result = runCase("same-version-noop");
  assert.equal(result.ok, true, (result.checks?.failures || []).join("; "));
  assert.equal(result.packet.summary.nextAction, "no_action");
});

test("all fixture cases pass their expect blocks", () => {
  const results = runAllCases();
  const failed = results.filter((r) => !r.ok);
  assert.equal(failed.length, 0, failed.map((f) => `${f.caseId}: ${(f.checks?.failures || [f.error]).join(", ")}`).join("\n"));
});
