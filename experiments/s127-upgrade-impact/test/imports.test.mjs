import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { SYNTHETIC, loadPipeline } from "./helpers.mjs";

test("analyzeImports finds named runtime imports and skips import type", async () => {
  const { impl } = await loadPipeline();
  const result = impl.analyzeImports(
    [join(SYNTHETIC, "callers/removed-export-used/src")],
    "demo-widget",
    { callerRoot: join(SYNTHETIC, "callers/removed-export-used") },
  );
  const names = result.usage.map((row) => row.symbol).sort();
  assert.deepEqual(names, ["alpha", "beta"]);
  assert.ok(result.usage.every((row) => row.dynamicImport === false));
  assert.ok(result.usage.every((row) => row.file === "src/app.js"));
  const typeOnly = result.typeOnlyUsage || [];
  assert.ok(
    typeOnly.some((row) => row.symbol === "Alpha" && row.typeOnly === true) ||
      result.limitations.some((row) => /ts/i.test(row)),
  );
  assert.equal(
    result.usage.some((row) => row.symbol === "Alpha"),
    false,
    "type-only Alpha must not count as runtime use",
  );
});

test("analyzeImports marks dynamic import()", async () => {
  const { impl } = await loadPipeline();
  const result = impl.analyzeImports(
    [join(SYNTHETIC, "callers/dynamic-import/src")],
    "demo-widget",
    { callerRoot: join(SYNTHETIC, "callers/dynamic-import") },
  );
  assert.ok(result.usage.some((row) => row.dynamicImport === true && row.specifier === "demo-widget"));
  assert.ok(result.limitations.some((row) => /dynamic/i.test(row)));
});

test("scanModuleSource does not treat commented imports as usage", async () => {
  const { impl } = await loadPipeline();
  const scanned = impl.scanModuleSource(
    `
      // import { nope } from "demo-widget";
      /* import { also } from "demo-widget"; */
      import { beta } from "demo-widget";
    `,
    { filename: "app.js" },
  );
  const names = scanned.imports.filter((row) => !row.typeOnly).map((row) => row.symbol);
  assert.deepEqual(names, ["beta"]);
});
