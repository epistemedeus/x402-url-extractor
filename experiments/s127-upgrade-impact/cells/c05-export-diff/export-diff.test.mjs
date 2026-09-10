import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { diffExports, scanExportSurface } from "../../src/export-diff.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");
const CLOCK = "2026-09-10T10:49:11.000Z";

function pair(id) {
  return {
    oldRoot: join(fixtures, id, "old"),
    newRoot: join(fixtures, id, "new"),
    clock: CLOCK,
  };
}

function names(list, kind) {
  return list.filter((x) => !kind || x.kind === kind).map((x) => x.name);
}

test("identical tree hash yields empty diff even though versions could be compared", async () => {
  const result = await diffExports(pair("noop-identical"));
  assert.equal(result.ok, true);
  assert.equal(result.identicalTree, true);
  assert.equal(result.versionBumpOnly, false);
  assert.equal(result.treeHash.old, result.treeHash.new);
  assert.deepEqual(result.exportDiff.added, []);
  assert.deepEqual(result.exportDiff.removed, []);
  assert.deepEqual(result.exportDiff.renamed, []);
  assert.deepEqual(result.exportDiff.signatureChanged, []);
  assert.equal(result.exportDiff.coverage, "full");
  assert.equal(result.provenance.every((p) => p.label === "fixture"), true);
});

test("version bump alone is not an export change", async () => {
  const result = await diffExports(pair("noop-version-bump"));
  assert.equal(result.ok, true);
  assert.equal(result.identicalTree, false);
  assert.equal(result.versionBumpOnly, true);
  assert.equal(result.versions.old, "1.0.0");
  assert.equal(result.versions.new, "2.0.0");
  assert.deepEqual(result.exportDiff.added, []);
  assert.deepEqual(result.exportDiff.removed, []);
  assert.deepEqual(result.exportDiff.renamed, []);
  assert.deepEqual(result.exportDiff.signatureChanged, []);
  assert.match(result.notes.join(" "), /version bump alone/);
});

test("removed named export is classified removed, not a version-driven break", async () => {
  const result = await diffExports(pair("removed"));
  assert.equal(result.ok, true);
  assert.equal(result.versionBumpOnly, false);
  assert.deepEqual(names(result.exportDiff.added), []);
  assert.equal(names(result.exportDiff.removed, "named").includes("gone"), true);
  assert.equal(names(result.exportDiff.removed, "named").includes("keep"), false);
  assert.equal(result.exportDiff.renamed.length, 0);
});

test("renamed heuristic fires only with same signature and name proximity", async () => {
  const result = await diffExports(pair("renamed"));
  assert.equal(result.ok, true);
  assert.equal(result.exportDiff.renamed.length, 1);
  const r = result.exportDiff.renamed[0];
  assert.equal(r.from, "parseQuery");
  assert.equal(r.to, "parseQueryString");
  assert.equal(r.heuristic, true);
  assert.equal(r.evidence.reason.includes("same-signature"), true);
  assert.equal(names(result.exportDiff.added, "named").includes("parseQueryString"), false);
  assert.equal(names(result.exportDiff.removed, "named").includes("parseQuery"), false);
});

test("rename is not claimed when signatures differ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "c05-rename-no-"));
  const oldRoot = join(dir, "old");
  const newRoot = join(dir, "new");
  mkdirSync(oldRoot);
  mkdirSync(newRoot);
  writeFileSync(
    join(oldRoot, "package.json"),
    JSON.stringify({ name: "x", version: "1.0.0", type: "module", exports: { ".": "./index.js" } }),
  );
  writeFileSync(
    join(newRoot, "package.json"),
    JSON.stringify({ name: "x", version: "1.1.0", type: "module", exports: { ".": "./index.js" } }),
  );
  writeFileSync(join(oldRoot, "index.js"), "export function alpha(a) { return a; }\n");
  writeFileSync(join(newRoot, "index.js"), "export function alphabet(a, b) { return a; }\n");
  const result = await diffExports({ oldRoot, newRoot, clock: CLOCK });
  assert.equal(result.exportDiff.renamed.length, 0);
  assert.equal(names(result.exportDiff.removed, "named").includes("alpha"), true);
  assert.equal(names(result.exportDiff.added, "named").includes("alphabet"), true);
});

test("signatureChanged when the same export gains a parameter", async () => {
  const result = await diffExports(pair("signature-changed"));
  assert.equal(result.ok, true);
  const hit = result.exportDiff.signatureChanged.find((s) => s.name === "parse");
  assert.ok(hit, JSON.stringify(result.exportDiff, null, 2));
  assert.equal(hit.coverage, "bounded");
  assert.equal(String(hit.before).includes("options"), false);
  assert.equal(String(hit.after).includes("options"), true);
  assert.equal(result.exportDiff.removed.filter((s) => s.name === "parse").length, 0);
});

test("subpath removed from exports map even if the file still exists", async () => {
  const result = await diffExports(pair("subpath-removed"));
  assert.equal(result.ok, true);
  const removedEntries = result.exportDiff.removed.filter((s) => s.kind === "entry");
  assert.equal(removedEntries.some((s) => s.entry === "./legacy"), true);
  assert.equal(result.exportDiff.removed.some((s) => s.name === "oldApi"), true);
  assert.equal(result.exportDiff.removed.some((s) => s.name === "current"), false);
});

test("ambient declare module marks coverage partial and does not invent sneak()", async () => {
  const result = await diffExports(pair("dts-partial"));
  assert.equal(result.ok, true);
  assert.equal(result.exportDiff.coverage, "partial");
  assert.equal(result.unknownReasons.some((r) => r.includes("ambient declare module")), true);
  assert.equal(result.exportDiff.added.some((s) => s.name === "sneak"), false);
});

test("relative export * is expanded into the public entry", async () => {
  const oldSurface = await scanExportSurface(join(fixtures, "reexport-star", "old"));
  const namesOld = oldSurface.symbols.filter((s) => s.kind !== "entry").map((s) => s.name).sort();
  assert.deepEqual(namesOld, ["extra", "helper"]);
  const result = await diffExports(pair("reexport-star"));
  assert.equal(names(result.exportDiff.added, "named").includes("addedTop"), true);
  assert.equal(names(result.exportDiff.removed).includes("helper"), false);
  assert.equal(names(result.exportDiff.removed).includes("extra"), false);
});

test("missing roots yield unknown coverage, not an action", async () => {
  const result = await diffExports({
    oldRoot: join(fixtures, "no-such-old"),
    newRoot: join(fixtures, "no-such-new"),
    clock: CLOCK,
  });
  assert.equal(result.ok, false);
  assert.equal(result.exportDiff.coverage, "unknown");
  assert.equal(result.code, "missing-root");
});

test("CJS named exports are scanned via cjs-module-lexer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "c05-cjs-"));
  const oldRoot = join(dir, "old");
  const newRoot = join(dir, "new");
  mkdirSync(oldRoot);
  mkdirSync(newRoot);
  writeFileSync(join(oldRoot, "package.json"), JSON.stringify({ name: "cjs", version: "1.0.0", main: "./index.js" }));
  writeFileSync(join(newRoot, "package.json"), JSON.stringify({ name: "cjs", version: "1.1.0", main: "./index.js" }));
  writeFileSync(join(oldRoot, "index.js"), "exports.keep = 1;\nexports.gone = 2;\n");
  writeFileSync(join(newRoot, "index.js"), "exports.keep = 1;\nexports.added = 3;\n");
  const result = await diffExports({ oldRoot, newRoot, clock: CLOCK });
  assert.equal(names(result.exportDiff.removed, "named").includes("gone"), true);
  assert.equal(names(result.exportDiff.added, "named").includes("added"), true);
  assert.equal(names(result.exportDiff.removed, "named").includes("keep"), false);
});

test("scan labels TS/dynamic limits without claiming full TS analysis", async () => {
  const dir = mkdtempSync(join(tmpdir(), "c05-dyn-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "dyn", version: "1.0.0", type: "module", exports: { ".": "./index.js" } }),
  );
  writeFileSync(
    join(dir, "index.js"),
    "export function keep(x) { return x; }\nexport async function load() { return import('./mod.js'); }\n",
  );
  const surface = await scanExportSurface(dir);
  assert.equal(surface.symbols.some((s) => s.name === "keep"), true);
  assert.equal(surface.unknownReasons.some((r) => r.includes("dynamic import")), true);
});
