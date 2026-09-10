import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { detectTypescriptApi } from "../engine.mjs";
import { extractFromText, exportNames } from "../extract.mjs";
import { extractPackageTypes } from "../types-entry.mjs";

const cell = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (...p) => join(cell, "fixtures", ...p);

function namesOf(text, opts) {
  return exportNames(extractFromText(text, opts)).sort();
}

test("engine: typescript API is not required and checker is not claimed", () => {
  const detected = detectTypescriptApi();
  assert.equal(detected.claimsFullChecker, false);
  assert.equal(detected.used, false);
  if (!detected.available) {
    assert.equal(detected.kind, "lexer-bounded");
  }
});

test("named type / interface / function exports", () => {
  const text = readFileSync(fx("packages/type-kit/1.0.0/index.d.ts"), "utf8");
  const result = extractFromText(text, { file: "index.d.ts", packageName: "type-kit" });
  assert.equal(result.claimsFullChecker, false);
  assert.equal(result.engine, "lexer-bounded");
  const names = exportNames(result);
  assert.ok(names.includes("Alpha"));
  assert.ok(names.includes("Beta"));
  assert.ok(names.includes("gamma"));
  assert.ok(names.includes("Kept"));
  assert.ok(names.includes("Delta"));
  assert.ok(names.includes("Relayed"));
  assert.equal(names.includes("NotFromComment"), false);
  assert.equal(names.includes("NotFromBlock"), false);
  assert.equal(names.includes("NotFromString"), false);
  assert.equal(names.includes("ExtraOnly"), false);
  const alpha = result.exports.find((e) => e.name === "Alpha");
  assert.equal(alpha.declKind, "type");
  assert.equal(alpha.typeOnly, true);
  const relayed = result.exports.find((e) => e.name === "Relayed");
  assert.equal(relayed.from, "./extra");
  assert.equal(relayed.typeOnly, true);
});

test("comments and strings are not exports", () => {
  const text = readFileSync(fx("hostile/comments-and-strings.d.ts"), "utf8");
  const names = namesOf(text);
  assert.deepEqual(names.sort(), ["AlsoReal", "Real"]);
});

test("export = and export as namespace", () => {
  const text = readFileSync(fx("packages/type-kit/1.0.0/umd.d.ts"), "utf8");
  const result = extractFromText(text, { file: "umd.d.ts" });
  const byKind = Object.fromEntries(result.exports.map((e) => [e.kind, e]));
  assert.equal(byKind.exportEquals.name, "export=");
  assert.equal(byKind.exportEquals.target, "TypeKit");
  assert.equal(byKind.exportAsNamespace.name, "TypeKit");
  assert.equal(result.exports.some((e) => e.name === "helper"), false);
});

test("declare module augmentation is not harvested as package exports", () => {
  const text = readFileSync(fx("hostile/declare-module.d.ts"), "utf8");
  const result = extractFromText(text, { file: "declare-module.d.ts", packageName: "type-kit" });
  assert.deepEqual(exportNames(result), ["Local"]);
  assert.ok(result.unknowns.some((u) => String(u.reason).includes("declare-module-augmentation")));
  assert.ok(result.unknowns.some((u) => u.reason === "declare-global"));
});

test("unresolved star reexport is partial coverage", () => {
  const text = readFileSync(fx("hostile/unresolved-star.d.ts"), "utf8");
  const result = extractFromText(text, { file: "unresolved-star.d.ts" });
  assert.ok(exportNames(result).includes("Local"));
  assert.equal(result.coverage, "partial");
  assert.ok(result.unknowns.some((u) => u.reason === "star-reexport"));
});

test("triple-slash reference is unknown contribution", () => {
  const text = readFileSync(fx("hostile/triple-slash.d.ts"), "utf8");
  const result = extractFromText(text);
  assert.ok(exportNames(result).includes("AfterRef"));
  assert.equal(result.coverage, "partial");
  assert.ok(result.unknowns.some((u) => u.reason === "triple-slash-reference"));
});

test("export default and export type list", () => {
  const result = extractFromText(`
    export default function make(): void;
    export type { Foo as Bar };
    export const enum Kind { A, B }
  `);
  const names = exportNames(result).sort();
  assert.ok(names.includes("default"));
  assert.ok(names.includes("Bar"));
  assert.ok(names.includes("Kind"));
});

test("package types entry loads index.d.ts and does not run scripts", () => {
  const surface = extractPackageTypes(fx("packages/type-kit/1.0.0"), {
    packageName: "type-kit",
    label: "synthetic",
    retrievedAt: "2026-09-10T12:00:00.000Z",
  });
  assert.equal(surface.ok, true);
  assert.equal(surface.claimsFullChecker, false);
  assert.ok(surface.exports.some((e) => e.name === "Alpha"));
  assert.ok(surface.lifecycleScripts.includes("preinstall"));
  assert.ok(surface.provenance.every((p) => p.label === "synthetic"));
  assert.ok(surface.provenance.every((p) => p.contentSha256 && p.contentSha256.length === 64));
});

test("oversize source is unknown, not a full surface", () => {
  const huge = `${"export type X = 1;\n"}${"x".repeat(300 * 1024)}`;
  const result = extractFromText(huge);
  assert.equal(result.coverage, "unknown");
  assert.equal(result.claimsFullChecker, false);
});
