import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  parseDescriptor,
  packageNameFromResolved,
  resolveYarnPackage,
  splitNameRange,
} from "../resolve.mjs";

const cellRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (...parts) => join(cellRoot, "fixtures", ...parts);
const read = (...parts) => readFileSync(fixture(...parts), "utf8");
const readJson = (...parts) => JSON.parse(readFileSync(fixture(...parts), "utf8"));

test("splitNameRange: unscoped, scoped, alias", () => {
  assert.deepEqual(splitNameRange("lodash@^4.17.0"), { name: "lodash", range: "^4.17.0", raw: "lodash@^4.17.0" });
  assert.deepEqual(splitNameRange("@scope/pkg@^1.0.0"), {
    name: "@scope/pkg",
    range: "^1.0.0",
    raw: "@scope/pkg@^1.0.0",
  });
  const alias = parseDescriptor("widget@npm:demo-widget@^1.0.0");
  assert.equal(alias.name, "widget");
  assert.equal(alias.protocol, "npm");
  assert.equal(alias.aliasTarget, "demo-widget");
  assert.equal(alias.aliasRange, "^1.0.0");
  const scopedAlias = parseDescriptor("@team/ui@npm:@company/ui@^2.0.0");
  assert.equal(scopedAlias.name, "@team/ui");
  assert.equal(scopedAlias.aliasTarget, "@company/ui");
  assert.equal(scopedAlias.aliasRange, "^2.0.0");
});

test("packageNameFromResolved: scoped tarball URL", () => {
  assert.equal(
    packageNameFromResolved(
      "https://registry.yarnpkg.com/@scope/pkg/-/pkg-1.2.4.tgz#eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    ),
    "@scope/pkg",
  );
  assert.equal(
    packageNameFromResolved(
      "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#679591c564c3bffaae8454cf0b3df370c3d6911c",
    ),
    "lodash",
  );
  assert.equal(packageNameFromResolved("file:packages/local-widget"), null);
});

test("resolve simple: demo-widget uniquely 1.0.0", () => {
  const r = resolveYarnPackage({ text: read("classic-simple", "yarn.lock"), name: "demo-widget" });
  assert.equal(r.status, "resolved");
  assert.equal(r.version, "1.0.0");
  assert.equal(r.decision, "no_action");
  assert.equal(r.disagreement, false);
  assert.match(r.resolvedUrl, /demo-widget-1\.0\.0\.tgz/);
});

test("resolve simple: left-pad multi-key is not a conflict", () => {
  const r = resolveYarnPackage({ text: read("classic-simple", "yarn.lock"), name: "left-pad" });
  assert.equal(r.status, "resolved");
  assert.equal(r.version, "1.3.0");
  assert.deepEqual(r.uniqueVersions, ["1.3.0"]);
  assert.equal(r.disagreement, false);
});

test("resolve alias: widget → demo-widget@1.2.3 uniquely", () => {
  const manifest = readJson("classic-alias", "package.json");
  const r = resolveYarnPackage({
    text: read("classic-alias", "yarn.lock"),
    name: "widget",
    manifest,
  });
  assert.equal(r.status, "resolved");
  assert.equal(r.version, "1.2.3");
  assert.equal(r.aliases.length, 1);
  assert.equal(r.aliases[0].requestedName, "widget");
  assert.equal(r.aliases[0].targetName, "demo-widget");
  assert.equal(r.aliasDisagreement, false);
  assert.equal(r.disagreement, false);
  const viaTarget = resolveYarnPackage({
    text: read("classic-alias", "yarn.lock"),
    name: "demo-widget",
  });
  assert.equal(viaTarget.status, "resolved");
  assert.equal(viaTarget.version, "1.2.3");
});

test("resolve scoped npm alias", () => {
  const r = resolveYarnPackage({
    text: read("classic-scoped-alias", "yarn.lock"),
    name: "@team/ui",
  });
  assert.equal(r.status, "resolved");
  assert.equal(r.version, "2.1.0");
  assert.equal(r.aliases[0].targetName, "@company/ui");
  assert.equal(r.matches[0].resolvedName, "@company/ui");
});

test("resolve conflict: lodash two versions → unknown, not first-wins", () => {
  const text = read("classic-conflict", "yarn.lock");
  const r = resolveYarnPackage({ text, name: "lodash" });
  assert.equal(r.status, "unknown");
  assert.equal(r.decision, "unknown");
  assert.equal(r.disagreement, true);
  assert.equal(r.version, null);
  assert.deepEqual(r.uniqueVersions, ["3.10.1", "4.17.21"]);
  assert.ok(r.unknownReasons.includes("lockfile_version_conflict"));
  assert.ok(r.unknownReasons.includes("lockfile_disagreement"));
  // c14-style first-wins would have returned 3.10.1 because lodash@^3 appears first.
  assert.notEqual(r.uniqueVersions[0] === "3.10.1" && r.status === "resolved", true);
});

test("resolve conflict: non-conflicting name in the same lockfile still resolves", () => {
  const r = resolveYarnPackage({
    text: read("classic-conflict", "yarn.lock"),
    name: "demo-widget",
  });
  assert.equal(r.status, "resolved");
  assert.equal(r.version, "1.0.0");
});

test("resolve alias mismatch: lockfile resolved name ≠ alias target → unknown", () => {
  const manifest = readJson("classic-alias-mismatch", "package.json");
  const r = resolveYarnPackage({
    text: read("classic-alias-mismatch", "yarn.lock"),
    name: "widget",
    manifest,
  });
  assert.equal(r.status, "unknown");
  assert.equal(r.aliasDisagreement, true);
  assert.ok(r.unknownReasons.includes("alias_resolved_name_mismatch"));
  assert.equal(r.version, null);
});

test("resolve missing package → unknown", () => {
  const r = resolveYarnPackage({ text: read("classic-simple", "yarn.lock"), name: "not-a-dep" });
  assert.equal(r.status, "unknown");
  assert.ok(r.unknownReasons.includes("lockfile_package_missing"));
});

test("resolve berry → unknown, no version claimed", () => {
  const r = resolveYarnPackage({ text: read("berry-v6", "yarn.lock"), name: "demo-widget" });
  assert.equal(r.ok, false);
  assert.equal(r.status, "unknown");
  assert.equal(r.format, "berry");
  assert.equal(r.version, null);
  assert.ok(r.unknownReasons.includes("yarn_berry_unsupported"));
});

test("resolve berry workspace protocol → unknown", () => {
  const r = resolveYarnPackage({
    text: read("berry-workspace", "yarn.lock"),
    name: "local-widget",
  });
  assert.equal(r.status, "unknown");
  assert.equal(r.format, "berry");
});

test("resolve classic file: locator uniquely", () => {
  const r = resolveYarnPackage({
    text: read("classic-file-workspace", "yarn.lock"),
    name: "local-widget",
  });
  assert.equal(r.status, "resolved");
  assert.equal(r.version, "0.0.0");
  assert.equal(r.resolvedUrl, "file:packages/local-widget");
  assert.equal(r.matches[0].fileish, true);
});

test("index without name reports lodash conflict count", () => {
  const r = resolveYarnPackage({ text: read("classic-conflict", "yarn.lock") });
  assert.equal(r.status, "unknown");
  assert.equal(r.disagreement, true);
  const lodash = r.index.packages.find((p) => p.name === "lodash");
  assert.deepEqual(lodash.versions, ["3.10.1", "4.17.21"]);
  assert.equal(lodash.conflict, true);
});
