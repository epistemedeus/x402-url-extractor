import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  classifySemverDelta,
  detectLockfileKind,
  listDisagreements,
  parseDependencySpec,
  parseYamlSubset,
  rangeSatisfaction,
  resolveCallerDependency,
  toPacketDependencyOld,
} from "../../../src/lockfile.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");
const CLOCK = "2026-09-10T00:00:00.000Z";

function resolveFixture(dir, name, extra = {}) {
  const manifestPath = join(fixtures, dir, "package.json");
  return resolveCallerDependency({
    manifestPath,
    name,
    clock: CLOCK,
    evidenceClass: "synthetic",
    ...extra,
  });
}

test("semver 1.3.0 -> 2.0.0 is major; caret ^1.3.0 does not satisfy 2.0.0", () => {
  assert.equal(classifySemverDelta("1.3.0", "2.0.0"), "major");
  assert.equal(rangeSatisfaction("2.0.0", "^1.3.0").status, "unsatisfied");
  assert.equal(rangeSatisfaction("4.17.21", "^4.17.0").status, "satisfied");
  assert.equal(rangeSatisfaction("0.2.9", "^0.2.3").status, "satisfied");
  assert.equal(rangeSatisfaction("0.0.4", "^0.0.3").status, "unsatisfied");
  assert.equal(rangeSatisfaction("1.2.3-beta", "^1.0.0").status, "unknown");
});

test("parseDependencySpec: npm alias, workspace, file, registry", () => {
  const alias = parseDependencySpec("npm:lodash@^4.17.0");
  assert.equal(alias.protocol, "alias");
  assert.equal(alias.alias.targetName, "lodash");
  assert.equal(alias.alias.targetSpec, "^4.17.0");
  const scoped = parseDependencySpec("npm:@scope/pkg@^1.2.0");
  assert.equal(scoped.alias.targetName, "@scope/pkg");
  const ws = parseDependencySpec("workspace:*");
  assert.equal(ws.protocol, "workspace");
  assert.equal(ws.workspace.range, "*");
  assert.equal(parseDependencySpec("file:../lib").protocol, "file");
  assert.equal(parseDependencySpec("^1.2.3").protocol, "registry");
});

test("npm v3 alias: my-lodash → lodash@4.17.21 identity_resolved", () => {
  const result = resolveFixture("alias-npm-v3", "my-lodash");
  assert.equal(result.ok, true);
  assert.equal(result.schema, "s127.upgrade-impact.lockfile.v1");
  assert.equal(result.identity.protocol, "alias");
  assert.equal(result.identity.resolvedName, "lodash");
  assert.equal(result.identity.resolvedVersion, "4.17.21");
  assert.equal(result.identity.requestedName, "my-lodash");
  assert.equal(result.agreement, "match");
  assert.equal(result.identityStatus, "resolved");
  assert.equal(result.decisionHint, "identity_resolved");
  assert.equal(result.coverage.alias, true);
  assert.equal(result.coverage.rangeCheck, "satisfied");
  assert.equal(result.evidenceClass, "synthetic");
  assert.ok(result.provenance.every((p) => p.label === "synthetic"));
  const packet = toPacketDependencyOld(result);
  assert.equal(packet.name, "lodash");
  assert.equal(packet.oldVersion, "4.17.21");
  assert.equal(packet.newVersion, null);
});

test("npm v3 range disagreement is conflict/unknown, not an action", () => {
  const result = resolveFixture("disagreement-range-npm-v3", "left-pad");
  assert.equal(result.ok, true);
  assert.equal(result.identity.resolvedVersion, "2.0.0");
  assert.equal(result.agreement, "conflict");
  assert.equal(result.identityStatus, "unknown");
  assert.equal(result.decisionHint, "unknown");
  assert.ok(result.unknownReasons.includes("lockfile_manifest_disagreement"));
  assert.ok(result.conflicts.some((c) => c.kind === "range_unsatisfied"));
  assert.equal(result.coverage.rangeCheck, "unsatisfied");
});

test("alias target mismatch (lodash vs underscore) is conflict/unknown", () => {
  const result = resolveFixture("alias-target-mismatch-npm-v3", "my-lodash");
  assert.equal(result.identityStatus, "unknown");
  assert.equal(result.decisionHint, "unknown");
  assert.equal(result.agreement, "conflict");
  assert.ok(result.conflicts.some((c) => c.kind === "alias_target_mismatch"));
  assert.equal(result.identity.resolvedName, "underscore");
});

test("workspace:* is reported but unknown for registry upgrade-impact", () => {
  const result = resolveFixture("workspace-npm-v3", "@acme/lib");
  assert.equal(result.ok, true);
  assert.equal(result.identity.protocol, "workspace");
  assert.equal(result.identity.resolvedName, "@acme/lib");
  assert.equal(result.identity.resolvedVersion, "1.2.3");
  assert.equal(result.identity.workspace.linkedPath, "packages/lib");
  assert.equal(result.identityStatus, "unknown");
  assert.equal(result.decisionHint, "unknown");
  assert.ok(result.unknownReasons.includes("workspace_protocol"));
  assert.equal(result.coverage.workspace, true);
});

test("pnpm-lock.yaml v9 alias resolves lodash@4.17.21", () => {
  const result = resolveFixture("alias-pnpm-v9", "my-lodash");
  assert.equal(result.lockfile.kind, "pnpm");
  assert.equal(result.identity.resolvedName, "lodash");
  assert.equal(result.identity.resolvedVersion, "4.17.21");
  assert.equal(result.identityStatus, "resolved");
  assert.equal(result.decisionHint, "identity_resolved");
});

test("pnpm-lock.yaml v6 alias with /lodash@version key", () => {
  const result = resolveFixture("pnpm-v6-alias", "my-lodash");
  assert.equal(result.lockfile.kind, "pnpm");
  assert.equal(result.identity.resolvedName, "lodash");
  assert.equal(result.identity.resolvedVersion, "4.17.21");
  assert.equal(result.identityStatus, "resolved");
});

test("pnpm range disagreement is conflict/unknown", () => {
  const result = resolveFixture("disagreement-pnpm-v9", "left-pad");
  assert.equal(result.agreement, "conflict");
  assert.equal(result.decisionHint, "unknown");
  assert.ok(result.conflicts.some((c) => c.kind === "range_unsatisfied"));
});

test("yarn.lock v1 alias descriptor", () => {
  const result = resolveFixture("alias-yarn-v1", "my-lodash");
  assert.equal(result.lockfile.kind, "yarn-v1");
  assert.equal(result.identity.resolvedName, "lodash");
  assert.equal(result.identity.resolvedVersion, "4.17.21");
  assert.equal(result.identityStatus, "resolved");
});

test("yarn berry YAML alias uses resolution field", () => {
  const result = resolveFixture("alias-yarn-berry", "my-lodash");
  assert.equal(result.lockfile.kind, "yarn-berry");
  assert.equal(result.identity.resolvedName, "lodash");
  assert.equal(result.identity.resolvedVersion, "4.17.21");
  assert.equal(result.identityStatus, "resolved");
});

test("exact pin + npm v3 is identity_resolved; devDep also listed", () => {
  const result = resolveFixture("exact-npm-v3", "left-pad");
  assert.equal(result.identity.resolvedVersion, "1.3.0");
  assert.equal(result.identity.depType, "dependencies");
  assert.equal(result.identityStatus, "resolved");
  const ts = resolveFixture("exact-npm-v3", "typescript");
  assert.equal(ts.identity.depType, "devDependencies");
  assert.equal(ts.identity.resolvedVersion, "5.6.3");
  assert.equal(ts.identityStatus, "resolved");
});

test("npm-shrinkwrap.json is a supported npm lockfile", () => {
  const result = resolveFixture("shrinkwrap-alias", "my-lodash");
  assert.equal(result.lockfile.kind, "npm-shrinkwrap");
  assert.equal(result.identity.resolvedName, "lodash");
  assert.equal(result.identityStatus, "resolved");
});

test("missing lockfile stays unknown (range-only is not a resolved identity)", () => {
  const result = resolveFixture("missing-lockfile", "left-pad");
  assert.equal(result.identityStatus, "unknown");
  assert.equal(result.decisionHint, "unknown");
  assert.equal(result.agreement, "lockfile_missing");
  assert.ok(result.unknownReasons.includes("lockfile_missing"));
});

test("Cargo.lock is unsupported → unknown", () => {
  const result = resolveFixture("unsupported-cargo", "left-pad", {
    lockfilePath: join(fixtures, "unsupported-cargo", "Cargo.lock"),
  });
  assert.equal(result.lockfile.kind, "cargo");
  assert.equal(result.lockfile.formatSupport, "unsupported");
  assert.equal(result.identityStatus, "unknown");
  assert.equal(result.agreement, "unsupported_format");
  assert.ok(result.unknownReasons.some((r) => r.includes("unsupported_lockfile_kind")));
});

test("multiple sibling lockfiles without lockfilePath → unknown; specifying path resolves", () => {
  const ambiguous = resolveFixture("multiple-lockfiles", "left-pad");
  assert.equal(ambiguous.identityStatus, "unknown");
  assert.ok(ambiguous.unknownReasons.includes("multiple_lockfiles"));
  const pinned = resolveFixture("multiple-lockfiles", "left-pad", {
    lockfilePath: join(fixtures, "multiple-lockfiles", "package-lock.json"),
  });
  assert.equal(pinned.identityStatus, "resolved");
  assert.equal(pinned.identity.resolvedVersion, "1.3.0");
});

test("overrides: range miss is reported as override/unknown, not action", () => {
  const result = resolveFixture("override-npm-v3", "left-pad");
  assert.equal(result.decisionHint, "unknown");
  assert.equal(result.agreement, "override");
  assert.equal(result.identity.override.kind, "overrides");
  assert.equal(result.identity.override.spec, "2.0.0");
  assert.ok(result.unknownReasons.includes("override_present"));
});

test("scoped package @scope/pkg from npm v3", () => {
  const result = resolveFixture("scoped-npm-v3", "@scope/pkg");
  assert.equal(result.identity.resolvedName, "@scope/pkg");
  assert.equal(result.identity.resolvedVersion, "1.2.3");
  assert.equal(result.identityStatus, "resolved");
});

test("file: protocol is non-registry unknown", () => {
  const result = resolveFixture("file-protocol", "local-lib");
  assert.equal(result.identity.protocol, "file");
  assert.equal(result.identityStatus, "unknown");
  assert.ok(result.unknownReasons.includes("non_registry_protocol:file"));
});

test("npm lockfileVersion 1 dependencies tree", () => {
  const result = resolveFixture("npm-v1-dependencies", "left-pad");
  assert.equal(result.lockfile.lockfileVersion, 1);
  assert.equal(result.identity.resolvedVersion, "1.3.0");
  assert.equal(result.identityStatus, "resolved");
});

test("undeclared name is unknown, not a caller defect", () => {
  const result = resolveFixture("exact-npm-v3", "not-a-dep");
  assert.equal(result.agreement, "manifest_missing");
  assert.equal(result.identityStatus, "unknown");
  assert.ok(result.unknownReasons.includes("not_declared_in_manifest"));
});

test("__proto__ dependency key is ignored; left-pad still resolves", () => {
  const result = resolveFixture("hostile-proto", "left-pad");
  assert.equal(result.identity.resolvedVersion, "1.3.0");
  assert.equal(result.identityStatus, "resolved");
  const proto = resolveFixture("hostile-proto", "__proto__");
  assert.equal(proto.agreement, "manifest_missing");
});

test("symlink lockfile is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "c02-lock-"));
  const target = join(fixtures, "exact-npm-v3", "package-lock.json");
  const link = join(dir, "package-lock.json");
  symlinkSync(target, link);
  const result = resolveCallerDependency({
    manifestPath: join(fixtures, "exact-npm-v3", "package.json"),
    lockfilePath: link,
    name: "left-pad",
    clock: CLOCK,
    evidenceClass: "synthetic",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "symlink_refused");
  assert.equal(result.decisionHint, "unknown");
});

test("truncated package-lock.json is invalid_json, not a resolved identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "c02-trunc-"));
  const lockPath = join(dir, "package-lock.json");
  writeFileSync(lockPath, "{\n");
  const result = resolveCallerDependency({
    manifestPath: join(fixtures, "exact-npm-v3", "package.json"),
    lockfilePath: lockPath,
    name: "left-pad",
    clock: CLOCK,
    evidenceClass: "synthetic",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_json");
  assert.equal(result.decisionHint, "unknown");
  assert.equal(result.identityStatus, "unknown");
});

test("listDisagreements reports the range-conflict fixture and not the alias match", () => {
  const bad = listDisagreements({
    manifestPath: join(fixtures, "disagreement-range-npm-v3", "package.json"),
    clock: CLOCK,
    evidenceClass: "synthetic",
  });
  assert.equal(bad.ok, true);
  assert.equal(bad.summary.conflictCount, 1);
  const good = listDisagreements({
    manifestPath: join(fixtures, "alias-npm-v3", "package.json"),
    clock: CLOCK,
    evidenceClass: "synthetic",
  });
  assert.equal(good.summary.disagreementCount, 0);
});

test("detectLockfileKind sniffs yarn v1 vs berry vs pnpm vs cargo", () => {
  assert.equal(detectLockfileKind(join(fixtures, "alias-yarn-v1", "yarn.lock"), "# yarn lockfile v1\n"), "yarn-v1");
  assert.equal(detectLockfileKind("yarn.lock", "__metadata:\n  version: 6\nlanguageName: node\n"), "yarn-berry");
  assert.equal(detectLockfileKind("pnpm-lock.yaml"), "pnpm");
  assert.equal(detectLockfileKind("Cargo.lock"), "cargo");
  assert.equal(detectLockfileKind("bun.lockb"), "bun-binary");
});

test("YAML subset parses pnpm flow maps without claiming full YAML", () => {
  const doc = parseYamlSubset(`lockfileVersion: '9.0'\npackages:\n  lodash@4.17.21:\n    resolution: {integrity: sha512-abc, tarball: https://example.test/lodash.tgz}\n`);
  assert.equal(doc.ok, true);
  assert.equal(doc.value.lockfileVersion, "9.0");
  assert.equal(doc.value.packages["lodash@4.17.21"].resolution.tarball, "https://example.test/lodash.tgz");
});

test("in-memory manifest+lockfile does not touch the network", () => {
  const result = resolveCallerDependency({
    manifestText: JSON.stringify({ name: "mem", dependencies: { foo: "^1.0.0" } }),
    lockfileText: JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { foo: "^1.0.0" } },
        "node_modules/foo": { version: "1.2.3" },
      },
    }),
    lockfilePath: "memory/package-lock.json",
    name: "foo",
    clock: CLOCK,
    evidenceClass: "synthetic",
  });
  assert.equal(result.identity.resolvedVersion, "1.2.3");
  assert.equal(result.identityStatus, "resolved");
  assert.equal(result.provenance[0].label, "synthetic");
});
