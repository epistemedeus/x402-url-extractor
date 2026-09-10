import assert from "node:assert/strict";
import test from "node:test";
import { loadPipeline } from "./helpers.mjs";

test("bindUsageToDiff: used removed export is action", async () => {
  const { impl } = await loadPipeline();
  const { bindings } = impl.bindUsageToDiff({
    usage: [
      { specifier: "demo-widget", symbol: "alpha", kind: "named", dynamicImport: false },
      { specifier: "demo-widget", symbol: "beta", kind: "named", dynamicImport: false },
    ],
    exportDiff: { added: [], removed: ["alpha"], renamed: [], signatureChanged: [], coverage: "full" },
    dependency: { name: "demo-widget" },
  });
  const alpha = bindings.find((row) => row.symbol === "alpha");
  assert.equal(alpha.used, true);
  assert.equal(alpha.changeKind, "removed");
  assert.equal(alpha.decision, "action");
  const beta = bindings.find((row) => row.symbol === "beta");
  assert.equal(beta.decision, "no_action");
});

test("bindUsageToDiff: unused removed export is no_action", async () => {
  const { impl } = await loadPipeline();
  const { bindings } = impl.bindUsageToDiff({
    usage: [{ specifier: "demo-widget", symbol: "beta", kind: "named", dynamicImport: false }],
    exportDiff: { added: [], removed: ["alpha"], renamed: [], signatureChanged: [], coverage: "full" },
    dependency: { name: "demo-widget" },
  });
  const alpha = bindings.find((row) => row.symbol === "alpha");
  assert.equal(alpha.used, false);
  assert.equal(alpha.decision, "no_action");
});

test("bindUsageToDiff: renamed used export is action", async () => {
  const { impl } = await loadPipeline();
  const { bindings } = impl.bindUsageToDiff({
    usage: [{ specifier: "demo-widget", symbol: "formatName", kind: "named", dynamicImport: false }],
    exportDiff: {
      added: [],
      removed: [],
      renamed: [{ from: "formatName", to: "formatLabel" }],
      signatureChanged: [],
      coverage: "full",
    },
    dependency: { name: "demo-widget" },
  });
  const row = bindings.find((item) => item.symbol === "formatName");
  assert.equal(row.changeKind, "renamed");
  assert.equal(row.decision, "action");
});
