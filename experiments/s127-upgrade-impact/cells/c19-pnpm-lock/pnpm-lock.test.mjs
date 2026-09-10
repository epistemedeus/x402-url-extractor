import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyLockfileVersion,
  inspectRelativePath,
  parseNpmAlias,
  parsePackageKey,
  parseSpecifier,
  parseVersionRef,
  parseWorkspaceSpec,
} from "./dep-path.mjs";
import {
  SCHEMA,
  analyzeLockfile,
  analyzePnpmLock,
  loadFixture,
  readConfinedFile,
  resolveDependency,
  resolveLockfile,
  run,
  sha256Hex,
} from "./pnpm-lock.mjs";
import { parseYamlSubset } from "./yaml-subset.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

function analyzeNamed(name) {
  const { lockfileText, manifest } = loadFixture(name);
  return analyzePnpmLock({
    lockfileText,
    manifest,
    evidenceClass: "fixture",
  });
}

function resolution(result, name, importer = ".") {
  return result.resolutions.find((r) => r.name === name && r.importerPath === importer);
}

describe("yaml subset", () => {
  test("parses lockfileVersion, nested importers, and flow resolution", () => {
    const yaml = parseYamlSubset(readFileSync(join(fixtures, "v9-basic/pnpm-lock.yaml"), "utf8"));
    assert.equal(yaml.ok, true);
    assert.equal(yaml.value.lockfileVersion, "9.0");
    assert.equal(yaml.value.importers["."].dependencies.lodash.version, "4.17.21");
    assert.equal(
      yaml.value.packages["lodash@4.17.21"].resolution.integrity,
      "sha512-fixture-not-a-real-hash",
    );
    assert.match(
      yaml.value.packages["lodash@4.17.21"].resolution.tarball,
      /^https:\/\/registry\.npmjs\.org\//,
    );
  });

  test("quoted scoped keys round-trip as unquoted object keys", () => {
    const yaml = parseYamlSubset(readFileSync(join(fixtures, "v9-scoped/pnpm-lock.yaml"), "utf8"));
    assert.equal(yaml.ok, true);
    assert.ok(yaml.value.packages["@scope/pkg@1.2.3"]);
  });

  test("rejects YAML anchors and merge keys instead of guessing", () => {
    const yaml = parseYamlSubset(readFileSync(join(fixtures, "yaml-anchors/pnpm-lock.yaml"), "utf8"));
    assert.equal(yaml.ok, false);
    assert.equal(yaml.coverage, "unknown");
    assert.ok(yaml.unsupported.some((u) => u.code === "anchor" || u.code === "merge_key" || u.code === "alias"));
  });

  test("rejects NUL and poison keys do not pollute Object.prototype", () => {
    assert.equal(parseYamlSubset("a:\0b").ok, false);
    const yaml = parseYamlSubset("__proto__:\n  polluted: true\nsafe: 1\n");
    assert.equal(yaml.ok, true);
    assert.equal(yaml.value.safe, 1);
    assert.equal(Object.prototype.polluted, undefined);
  });

  test("YAML 1.2: unquoted no/yes stay strings; true/false are booleans", () => {
    const yaml = parseYamlSubset("a: true\nb: false\nc: no\nd: 5.4\ne: 1.0.0\n");
    assert.equal(yaml.ok, true);
    assert.equal(yaml.value.a, true);
    assert.equal(yaml.value.b, false);
    assert.equal(yaml.value.c, "no");
    assert.equal(yaml.value.d, 5.4);
    assert.equal(yaml.value.e, "1.0.0");
  });
});

describe("dep-path helpers", () => {
  test("classifies lockfileVersion 6/9 vs 5", () => {
    assert.equal(classifyLockfileVersion("9.0").family, "v9");
    assert.equal(classifyLockfileVersion("6.0").family, "v6");
    assert.equal(classifyLockfileVersion(5.4).family, "v5");
    assert.equal(classifyLockfileVersion("5.4").reason, "unsupported_lockfile_version");
  });

  test("parses npm: aliases including scoped targets", () => {
    assert.deepEqual(parseNpmAlias("npm:demo-widget@1.0.0"), {
      protocol: "npm",
      targetName: "demo-widget",
      targetSpec: "1.0.0",
      raw: "npm:demo-widget@1.0.0",
    });
    assert.equal(parseNpmAlias("npm:@scope/pkg@^1.0.0").targetName, "@scope/pkg");
    assert.equal(parseSpecifier("^4.17.21").kind, "range");
    assert.equal(parseSpecifier("2.0.0").kind, "exact");
  });

  test("parses v6 and v9 package keys and peer suffixes", () => {
    const v6 = parsePackageKey("/foo@1.0.0(@types/node@18.0.0)", "v6");
    assert.equal(v6.ok, true);
    assert.equal(v6.name, "foo");
    assert.equal(v6.version, "1.0.0");
    assert.equal(v6.peers, "(@types/node@18.0.0)");
    const v9 = parsePackageKey("@scope/pkg@1.2.3", "v9");
    assert.equal(v9.name, "@scope/pkg");
    assert.equal(v9.version, "1.2.3");
  });

  test("version refs: bare, name@version, and link:", () => {
    const bare = parseVersionRef("1.0.0(@types/node@18.0.0)", { importerName: "foo" });
    assert.equal(bare.kind, "bare");
    assert.equal(bare.version, "1.0.0");
    const id = parseVersionRef("demo-widget@1.0.0", { importerName: "widget" });
    assert.equal(id.kind, "id");
    assert.equal(id.name, "demo-widget");
    const link = parseVersionRef("link:packages/lib");
    assert.equal(link.kind, "link");
    assert.equal(link.path, "packages/lib");
  });

  test("workspace spec and path inspection", () => {
    assert.equal(parseWorkspaceSpec("workspace:*").protocol, "workspace");
    assert.equal(parseWorkspaceSpec("workspace:foo@*").alias.name, "foo");
    assert.equal(inspectRelativePath("packages/lib").ok, true);
    assert.equal(inspectRelativePath("../escape").ok, false);
    assert.equal(inspectRelativePath("/abs").ok, false);
    assert.equal(inspectRelativePath("a\0b").ok, false);
  });
});

describe("v6/v9 resolution", () => {
  test("v9 basic resolved version agrees with package.json range specifier", () => {
    const result = analyzeNamed("v9-basic");
    assert.equal(result.schema, SCHEMA);
    assert.equal(result.lockfileFamily, "v9");
    assert.equal(result.ok, true);
    assert.equal(result.disagreement, false);
    const lodash = resolution(result, "lodash");
    assert.equal(lodash.resolvedVersion, "4.17.21");
    assert.equal(lodash.resolvedName, "lodash");
    assert.equal(lodash.decision, "resolved");
    assert.equal(lodash.packageKey, "lodash@4.17.21");
    assert.equal(result.provenance.label, "fixture");
    assert.equal(result.provenance.paidDemand, false);
    assert.equal(result.provenance.liveCapture, false);
  });

  test("v6 basic uses leading-slash package keys", () => {
    const result = analyzeNamed("v6-basic");
    assert.equal(result.lockfileFamily, "v6");
    assert.equal(result.ok, true);
    const lodash = resolution(result, "lodash");
    assert.equal(lodash.resolvedVersion, "4.17.21");
    assert.equal(lodash.packageKey, "/lodash@4.17.21");
    assert.match(lodash.integrity, /^sha512-/);
  });

  test("v9 npm: alias records target name and resolved version", () => {
    const result = analyzeNamed("v9-alias-npm");
    assert.equal(result.ok, true);
    const widget = resolution(result, "widget");
    assert.equal(widget.alias.present, true);
    assert.equal(widget.alias.targetName, "demo-widget");
    assert.equal(widget.resolvedName, "demo-widget");
    assert.equal(widget.resolvedVersion, "1.0.0");
    assert.equal(widget.disagreement, false);
  });

  test("v6 npm: alias uses bare version field plus /target@ver key", () => {
    const result = analyzeNamed("v6-alias-npm");
    assert.equal(result.ok, true);
    const widget = resolution(result, "widget");
    assert.equal(widget.alias.targetName, "demo-widget");
    assert.equal(widget.resolvedName, "demo-widget");
    assert.equal(widget.resolvedVersion, "1.0.0");
    assert.equal(widget.packageKey, "/demo-widget@1.0.0");
  });

  test("v9 workspace link: yields package path", () => {
    const result = analyzeNamed("v9-workspace");
    assert.equal(result.ok, true);
    const lib = resolution(result, "@acme/lib");
    assert.equal(lib.workspace.present, true);
    assert.equal(lib.workspace.path, "packages/lib");
    assert.equal(lib.workspace.unresolved, false);
    assert.equal(lib.disagreement, false);
    const nested = resolution(result, "lodash", "packages/lib");
    assert.equal(nested.resolvedVersion, "4.17.21");
  });

  test("v6 workspace link: yields package path", () => {
    const result = analyzeNamed("v6-workspace");
    const lib = resolution(result, "@acme/lib");
    assert.equal(lib.workspace.path, "packages/lib");
    assert.equal(result.ok, true);
  });

  test("workspace:foo@* alias form still records link path", () => {
    const result = analyzeNamed("workspace-alias-name");
    const bar = resolution(result, "bar");
    assert.equal(bar.workspace.path, "packages/foo");
    assert.equal(result.ok, true);
  });

  test("scoped package resolved version", () => {
    const result = analyzeNamed("v9-scoped");
    const pkg = resolution(result, "@scope/pkg");
    assert.equal(pkg.resolvedVersion, "1.2.3");
    assert.equal(pkg.packageKey, "@scope/pkg@1.2.3");
    assert.equal(result.ok, true);
  });

  test("peer suffix does not hide the resolved version", () => {
    const v9 = analyzeNamed("v9-peers");
    const foo = resolution(v9, "foo");
    assert.equal(foo.resolvedVersion, "1.0.0");
    assert.equal(foo.packageKey, "foo@1.0.0");
    assert.equal(foo.snapshotKey, "foo@1.0.0(@types/node@18.0.0)");
    assert.equal(v9.ok, true);
    const v6 = analyzeNamed("v6-peers");
    const foo6 = resolution(v6, "foo");
    assert.equal(foo6.resolvedVersion, "1.0.0");
    assert.equal(foo6.packageKey, "/foo@1.0.0(@types/node@18.0.0)");
    assert.equal(v6.ok, true);
  });

  test("catalog: specifier uses catalogs map when present", () => {
    const result = analyzeNamed("catalog-ok");
    const react = resolution(result, "react");
    assert.equal(react.resolvedVersion, "18.2.0");
    assert.equal(react.disagreement, false);
    assert.equal(result.ok, true);
  });

  test("catalog: without catalogs map still uses importer version", () => {
    const result = analyzeNamed("catalog-missing");
    const react = resolution(result, "react");
    assert.equal(react.resolvedVersion, "18.2.0");
    assert.ok(react.reasons.includes("catalog_section_missing"));
    assert.equal(react.disagreement, false);
  });
});

describe("package.json disagreement ⇒ unknown", () => {
  test("exact pin 2.0.0 vs resolved 2.1.0", () => {
    const result = analyzeNamed("disagreement-exact-pin");
    assert.equal(result.ok, false);
    assert.equal(result.disagreement, true);
    assert.equal(result.decision, "unknown");
    assert.ok(result.unknownReasons.includes("lockfile_disagreement"));
    const dep = resolution(result, "hostile-dep");
    assert.equal(dep.resolvedVersion, "2.1.0");
    assert.equal(dep.disagreement, true);
    assert.ok(dep.reasons.includes("exact_pin_mismatch") || dep.reasons.includes("specifier_resolved_mismatch"));
  });

  test("specifier text mismatch", () => {
    const result = analyzeNamed("disagreement-specifier");
    assert.equal(result.disagreement, true);
    const dep = resolution(result, "lodash");
    assert.ok(dep.reasons.includes("specifier_mismatch"));
    assert.equal(dep.decision, "unknown");
  });

  test("npm: alias target mismatch", () => {
    const result = analyzeNamed("disagreement-alias");
    assert.equal(result.disagreement, true);
    const dep = resolution(result, "foo");
    assert.ok(dep.reasons.includes("alias_target_mismatch"));
    assert.equal(dep.alias.targetName, "baz");
    assert.equal(result.aliasUnresolved, true);
  });

  test("workspace protocol vs registry resolution", () => {
    const result = analyzeNamed("disagreement-workspace");
    assert.equal(result.disagreement, true);
    const dep = resolution(result, "@acme/lib");
    assert.ok(dep.reasons.includes("workspace_presence_mismatch"));
    assert.ok(dep.reasons.includes("workspace_resolved_from_registry") || dep.reasons.includes("specifier_mismatch"));
    assert.equal(result.workspaceUnresolved, true);
  });

  test("manifest name missing from lockfile importer", () => {
    const result = analyzeNamed("missing-entry");
    assert.equal(result.disagreement, true);
    const left = resolution(result, "left-pad");
    assert.equal(left.resolvedVersion, null);
    assert.ok(left.reasons.includes("missing_lockfile_entry"));
    const lodash = resolution(result, "lodash");
    assert.equal(lodash.disagreement, false);
  });
});

describe("unknown / unsupported", () => {
  test("unparseable lockfile is unknown, not a caller defect", () => {
    const result = analyzeNamed("unparseable");
    assert.equal(result.ok, false);
    assert.equal(result.decision, "unknown");
    assert.ok(result.unknownReasons.includes("lockfile_unparseable"));
    assert.equal(result.disagreement, false);
  });

  test("YAML anchors stay unknown", () => {
    const result = analyzeNamed("yaml-anchors");
    assert.equal(result.decision, "unknown");
    assert.ok(result.unknownReasons.includes("lockfile_unparseable"));
  });

  test("v5 lockfile family is unknown (this cell is v6/v9)", () => {
    const result = analyzeNamed("v5-unsupported");
    assert.equal(result.lockfileFamily, "v5");
    assert.equal(result.ok, false);
    assert.equal(result.decision, "unknown");
    assert.ok(result.unknownReasons.includes("unsupported_lockfile_version"));
  });

  test("missing lockfile text is unknown", () => {
    const result = analyzePnpmLock({ manifest: { dependencies: { a: "1.0.0" } } });
    assert.equal(result.decision, "unknown");
    assert.ok(result.unknownReasons.includes("missing_lockfile_text"));
  });
});

describe("exports and confinement", () => {
  test("resolveLockfile / analyzeLockfile / run aliases", () => {
    const { lockfileText, manifest } = loadFixture("v9-basic");
    const a = resolveLockfile({ lockfileText, manifest });
    const b = analyzeLockfile({ lockfileText, manifest });
    const c = run({ lockfileText, manifest });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(c.ok, true);
  });

  test("resolveDependency selects one name", () => {
    const { lockfileText, manifest } = loadFixture("v9-basic");
    const one = resolveDependency({ lockfileText, manifest, name: "lodash" });
    assert.equal(one.ok, true);
    assert.equal(one.resolution.resolvedVersion, "4.17.21");
    const missing = resolveDependency({ lockfileText, manifest, name: "nope" });
    assert.equal(missing.ok, false);
    assert.equal(missing.decision, "unknown");
  });

  test("file reads require a root and refuse escape", () => {
    const escaped = readConfinedFile("../package.json", fixtures);
    assert.equal(escaped.ok, false);
    assert.equal(escaped.reason, "path_escape");
    const noRoot = readConfinedFile("/etc/passwd", null);
    assert.equal(noRoot.ok, false);
    const ok = readConfinedFile("v9-basic/pnpm-lock.yaml", fixtures);
    assert.equal(ok.ok, true);
    assert.match(ok.text, /lockfileVersion/);
  });

  test("lifecycle sentinel is not created by parsing", () => {
    const marker = join(fixtures, "lifecycle-sentinel/SCRIPT_RAN.marker");
    assert.equal(existsSync(marker), false);
    const result = analyzeNamed("lifecycle-sentinel");
    assert.equal(result.ok, true);
    assert.equal(existsSync(marker), false);
  });

  test("sha256 is stable for a fixture lockfile", () => {
    const text = readFileSync(join(fixtures, "v9-basic/pnpm-lock.yaml"), "utf8");
    assert.equal(sha256Hex(text), sha256Hex(text));
    assert.equal(sha256Hex(text).length, 64);
  });
});
