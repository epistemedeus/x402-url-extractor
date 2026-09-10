import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertNoScriptRan,
  assertOwnedWrites,
  CELL_ROOT,
  isolationSnapshot,
  listFilesRecursive,
  refuseEscapingTypesField,
} from "../isolation.mjs";
import { extractPackageTypes } from "../types-entry.mjs";
import { inspectRelPath } from "../lib/paths.mjs";

const cell = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (...p) => join(cell, "fixtures", ...p);

test("owned write root is the cell directory", () => {
  const files = listFilesRecursive(CELL_ROOT);
  const owned = assertOwnedWrites(files, CELL_ROOT);
  assert.equal(owned.ok, true);
  assert.equal(owned.escapes.length, 0);
  assert.ok(files.some((f) => f.endsWith("extract.mjs")));
});

test("hostile types path that escapes the package is refused", () => {
  const pkg = fx("hostile/traversal");
  const inspected = refuseEscapingTypesField(pkg, "../../../../../etc/passwd");
  assert.equal(inspected.ok, false);
  assert.equal(inspected.reason, "escapes_package_root");

  const surface = extractPackageTypes(pkg, { packageName: "evil-types", label: "synthetic" });
  assert.equal(surface.ok, false);
  assert.equal(surface.coverage, "unknown");
  assert.ok(surface.unknowns.some((u) => String(u.reason).includes("escapes_package_root")));
  assert.equal(existsSync("/etc/passwd") ? surface.exports.length : surface.exports.length, 0);
  assert.equal(assertNoScriptRan(pkg).ok, true);
});

test("absolute and url types fields are refused", () => {
  const root = fx("packages/type-kit/1.0.0");
  assert.equal(inspectRelPath(root, "types", "/etc/passwd").ok, false);
  assert.equal(inspectRelPath(root, "types", "file:///etc/passwd").ok, false);
  assert.equal(inspectRelPath(root, "types", "https://example.invalid/x.d.ts").ok, false);
});

test("lifecycle scripts in fixtures are not executed", () => {
  const pkg = fx("packages/type-kit/1.0.0");
  extractPackageTypes(pkg, { packageName: "type-kit", label: "synthetic" });
  assert.equal(assertNoScriptRan(pkg).ok, true);
  assert.equal(existsSync(join(pkg, "SCRIPT_RAN.marker")), false);
});

test("isolation snapshot records no checker claim", () => {
  const snap = isolationSnapshot();
  assert.equal(snap.ownedWritesOk, true);
  assert.equal(snap.claimsFullChecker, false);
  assert.equal(snap.noNpmInstall, true);
});
