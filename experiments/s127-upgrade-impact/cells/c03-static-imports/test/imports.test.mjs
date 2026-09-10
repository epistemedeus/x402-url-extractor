import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  SCHEMA,
  analyzeFileSource,
  analyzeStaticImports,
  matchesPackageSpecifier,
} from "../analyze.mjs";
import {
  analyzeStaticImports as fromSrc,
  SCHEMA as schemaFromSrc,
} from "../../../src/imports.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cellRoot = join(here, "..");
const packRoot = join(cellRoot, "..", "..");
const fixtures = join(cellRoot, "fixtures", "synthetic-caller");
const srcImports = join(packRoot, "src", "imports.mjs");
const cellCli = join(cellRoot, "cli.mjs");

function analyze(packageName = "example-dep") {
  return analyzeStaticImports({
    packageName,
    sourceRoots: [fixtures],
    provenanceLabel: "synthetic",
  });
}

function usageFor(result, fileSuffix) {
  return result.usage.filter((u) => u.file === fileSuffix || u.file.endsWith(`/${fileSuffix}`));
}

test("src/imports.mjs re-exports the cell analyzer", () => {
  assert.equal(schemaFromSrc, SCHEMA);
  assert.equal(fromSrc, analyzeStaticImports);
});

test("matchesPackageSpecifier: exact, subpath, glob; not prefix-extra", () => {
  assert.equal(matchesPackageSpecifier("example-dep", "example-dep"), true);
  assert.equal(matchesPackageSpecifier("example-dep/get", "example-dep"), true);
  assert.equal(matchesPackageSpecifier("example-dep/*", "example-dep"), true);
  assert.equal(matchesPackageSpecifier("example-dep-*", "example-dep"), true);
  assert.equal(matchesPackageSpecifier("example-dep-extra", "example-dep"), false);
  assert.equal(matchesPackageSpecifier("@scope/example-dep", "example-dep"), false);
  assert.equal(matchesPackageSpecifier("@scope/example-dep/sub", "@scope/example-dep"), true);
  assert.equal(matchesPackageSpecifier("@scope/example-dep-extra", "@scope/example-dep"), false);
  assert.equal(matchesPackageSpecifier(null, "example-dep"), false);
});

test("contract records are {file, specifier, names[], dynamic} plus packet dynamicImport", () => {
  const result = analyze();
  assert.equal(result.ok, true);
  assert.equal(result.schema, SCHEMA);
  assert.equal(result.provenance.label, "synthetic");
  assert.ok(result.usage.length > 0);
  for (const rec of result.usage) {
    assert.equal(typeof rec.file, "string");
    assert.ok(rec.specifier === null || typeof rec.specifier === "string");
    assert.ok(Array.isArray(rec.names));
    assert.equal(typeof rec.dynamic, "boolean");
    assert.equal(typeof rec.dynamicImport, "boolean");
    if (rec.dynamicImport) assert.equal(rec.dynamic, true);
  }
});

test("named / default / namespace / mixed / side-effect / nested", () => {
  const result = analyze();
  assert.deepEqual(usageFor(result, "src/named.mjs")[0].names, ["alpha", "beta"]);
  assert.equal(usageFor(result, "src/named.mjs")[0].dynamic, false);
  assert.equal(usageFor(result, "src/named.mjs")[0].kind, "import");

  assert.deepEqual(usageFor(result, "src/default.mjs")[0].names, ["default"]);
  assert.equal(usageFor(result, "src/default.mjs")[0].defaultImport, true);

  assert.deepEqual(usageFor(result, "src/namespace.mjs")[0].names, ["*"]);
  assert.equal(usageFor(result, "src/namespace.mjs")[0].namespaceImport, true);

  const mixed = usageFor(result, "src/mixed.mjs")[0];
  assert.deepEqual(mixed.names, ["default", "alpha"]);
  assert.equal(mixed.defaultImport, true);

  const side = usageFor(result, "src/side-effect.mjs")[0];
  assert.deepEqual(side.names, []);
  assert.equal(side.specifier, "example-dep");

  assert.deepEqual(usageFor(result, "src/nested/deep.mjs")[0].names, ["alpha"]);
});

test("export-from: named, star, default", () => {
  const recs = usageFor(analyze(), "src/export-from.mjs");
  assert.equal(recs.length, 3);
  const byNames = recs.map((r) => r.names.join(",")).sort();
  assert.deepEqual(byNames, ["*", "alpha,beta", "default"]);
  for (const r of recs) {
    assert.equal(r.kind, "export-from");
    assert.equal(r.dynamic, false);
  }
});

test("require and destructure (CJS)", () => {
  const result = analyze();
  const whole = usageFor(result, "src/require.cjs");
  assert.equal(whole.length, 1);
  assert.deepEqual(whole[0].names, ["*"]);
  assert.equal(whole[0].kind, "require");
  assert.equal(whole[0].dynamic, false);

  const dest = usageFor(result, "src/destructure.cjs");
  assert.equal(dest.length, 2);
  const destNames = dest.map((r) => r.names.join(",")).sort();
  assert.deepEqual(destNames, ["alpha", "alpha,beta"]);
});

test("createRequire still yields a static require of the package", () => {
  const recs = usageFor(analyze(), "src/create-require.mjs");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, "require");
  assert.deepEqual(recs[0].names, ["alpha"]);
});

test("subpath matches; unrelated and comments do not", () => {
  const result = analyze();
  assert.equal(usageFor(result, "src/subpath.mjs")[0].specifier, "example-dep/get");
  assert.equal(usageFor(result, "src/unrelated.mjs").length, 0);
  assert.equal(usageFor(result, "src/comments.mjs").length, 0);
  assert.equal(
    result.usage.some((u) => u.specifier === "example-dep-extra"),
    false,
  );
});

test("node_modules under a source root is not scanned", () => {
  const result = analyze();
  assert.equal(
    result.usage.some((u) => u.file.includes("node_modules") || u.names.includes("shouldNotSee")),
    false,
  );
});

test("dynamic import(string/template/glob) is flagged; expr is unresolved", () => {
  const result = analyze();
  const recs = usageFor(result, "src/dynamic.mjs");
  assert.ok(recs.length >= 3);
  for (const r of recs) {
    assert.equal(r.dynamic, true);
    assert.equal(r.dynamicImport, true);
    assert.equal(r.kind, "dynamic-import");
    assert.equal(r.coverage, "unknown");
    assert.deepEqual(r.names, []);
  }
  const specs = recs.map((r) => r.specifier).sort();
  assert.ok(specs.includes("example-dep"));
  assert.ok(specs.includes("example-dep/*"));
  assert.equal(
    recs.some((r) => r.specifier === "other-pkg"),
    false,
  );

  const unresolved = result.unresolvedDynamics.filter((u) => u.file === "src/dynamic.mjs");
  assert.ok(unresolved.length >= 1);
  assert.equal(unresolved[0].reason, "expression-specifier");
  assert.equal(unresolved[0].coverage, "unknown");
});

test("TS type-only + inline type + value imports; coverage partial; no type-aware claim", () => {
  const recs = usageFor(analyze(), "ts/types.ts");
  assert.ok(recs.length >= 3);
  const typeOnly = recs.find((r) => r.typeOnly && r.names.includes("Alpha"));
  assert.ok(typeOnly, "import type { Alpha }");
  const inline = recs.find((r) => r.names.includes("gamma"));
  assert.ok(inline);
  assert.ok(inline.names.includes("Beta"));
  assert.deepEqual(inline.typeNames, ["Beta"]);
  assert.equal(inline.typeOnly, false);
  const value = recs.find((r) => r.names.length === 1 && r.names[0] === "delta");
  assert.ok(value);
  for (const r of recs) {
    assert.equal(r.language, "ts");
    assert.equal(r.coverage, "partial");
  }
});

test("TSX default+named import", () => {
  const rec = usageFor(analyze(), "ts/component.tsx")[0];
  assert.ok(rec);
  assert.deepEqual(rec.names, ["default", "alpha"]);
  assert.equal(rec.language, "tsx");
  assert.equal(rec.coverage, "partial");
});

test("TS import-equals is recorded as namespace-like without claiming CJS resolution", () => {
  const rec = usageFor(analyze(), "ts/import-equals.ts")[0];
  assert.ok(rec);
  assert.equal(rec.kind, "import-equals");
  assert.deepEqual(rec.names, ["*"]);
  assert.equal(rec.coverage, "partial");
});

test("syntax-error file is unknown, not a fabricated usage list", () => {
  const result = analyze();
  assert.equal(usageFor(result, "src/syntax-error.js").length, 0);
  assert.ok(result.filesUnknown.some((f) => f.file === "src/syntax-error.js"));
});

test("scoped package is a separate target", () => {
  const scoped = analyze("@scope/example-dep");
  assert.ok(usageFor(scoped, "src/scoped.mjs").length >= 2);
  const specs = usageFor(scoped, "src/scoped.mjs").map((u) => u.specifier).sort();
  assert.deepEqual(specs, ["@scope/example-dep", "@scope/example-dep/sub"]);
  assert.equal(usageFor(scoped, "src/named.mjs").length, 0);
});

test("in-memory: comments and strings are not imports; require(expr) is unresolved", () => {
  const comments = analyzeFileSource({
    source: `// import { alpha } from "example-dep";\nconst s = 'import { alpha } from "example-dep"';\n`,
    file: "virtual.js",
    packageName: "example-dep",
    language: "js",
  });
  assert.equal(comments.usage.length, 0);

  const dynReq = analyzeFileSource({
    source: `const x = require("example-" + "dep");\n`,
    file: "virtual.cjs",
    packageName: "example-dep",
    language: "js",
  });
  assert.equal(dynReq.usage.length, 0);
  assert.equal(dynReq.unresolvedDynamics.length, 1);
  assert.equal(dynReq.unresolvedDynamics[0].kind, "require");
});

test("missing inputs fail closed", () => {
  const noPkg = analyzeStaticImports({ sourceRoots: [fixtures] });
  assert.equal(noPkg.ok, false);
  const noRoots = analyzeStaticImports({ packageName: "example-dep" });
  assert.equal(noRoots.ok, false);
});

test("cell CLI and src/imports.mjs CLI emit JSON usage for the synthetic fixture", () => {
  for (const cli of [cellCli, srcImports]) {
    const proc = spawnSync(
      process.execPath,
      [cli, "--package", "example-dep", "--root", fixtures, "--label", "synthetic"],
      { encoding: "utf8" },
    );
    assert.equal(proc.status, 0, proc.stderr);
    const json = JSON.parse(proc.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.schema, SCHEMA);
    assert.ok(json.usage.some((u) => u.file === "src/named.mjs"));
  }
});

test("limitations mention no full TS analysis and dynamic unknown", () => {
  const result = analyze();
  const blob = result.limitations.join(" ");
  assert.match(blob, /TypeScript type-aware/i);
  assert.match(blob, /Dynamic import/i);
});
