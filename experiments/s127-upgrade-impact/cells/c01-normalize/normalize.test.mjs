import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  classifyVersionToken,
  confinePath,
  INPUT_JSON_SCHEMA,
  INPUT_SCHEMA_ID,
  isNpmPackageName,
  normalizeCallerInput,
} from "../../src/normalize.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CALLER = join(here, "fixtures", "caller-ok");
const NORMALIZE_BIN = join(here, "../../src/normalize.mjs");
const CLOCK = "2026-09-10T09:54:59.000Z";

function validInput(overrides = {}) {
  return {
    clock: CLOCK,
    caller: {
      manifestPath: "package.json",
      lockfilePath: "package-lock.json",
      sourceRoots: ["src"],
      evidenceClass: "fixture",
    },
    dependency: {
      name: "s127-example-dep",
      oldVersion: "1.0.0",
      newVersion: "1.1.0",
    },
    ...overrides,
  };
}

function issueCodes(result) {
  return result.issues.map((row) => row.code);
}

test("happy path: fixture caller workspace normalizes to confined absolute paths", () => {
  const result = normalizeCallerInput(validInput(), { workspaceRoot: FIXTURE_CALLER });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.status, "ok");
  assert.equal(result.schema, INPUT_SCHEMA_ID);
  assert.equal(result.execute, false);
  assert.equal(result.executed, false);
  assert.equal(result.paidDemand, false);
  assert.equal(result.clock, CLOCK);
  assert.equal(result.caller.evidenceClass, "fixture");
  assert.equal(result.caller.workspaceRoot, FIXTURE_CALLER);
  assert.equal(result.caller.manifestPath, join(FIXTURE_CALLER, "package.json"));
  assert.equal(result.caller.manifestPathRelative, "package.json");
  assert.equal(result.caller.lockfilePath, join(FIXTURE_CALLER, "package-lock.json"));
  assert.deepEqual(result.caller.sourceRootsRelative, ["src"]);
  assert.equal(result.dependency.name, "s127-example-dep");
  assert.equal(result.dependency.resolvedOld, "1.0.0");
  assert.equal(result.dependency.resolvedNew, "1.1.0");
  assert.equal(result.dependency.resolution.lockfileConsulted, false);
  assert.equal(result.caller.fs.manifest, "file");
  assert.equal(result.coverageLabel, "fixture");
  assert.equal(result.issues.length, 0);
});

test("a newer version is accepted and is not classified as a break", () => {
  const result = normalizeCallerInput(validInput(), { workspaceRoot: FIXTURE_CALLER });
  assert.equal(result.ok, true);
  assert.notEqual(result.dependency.oldVersion, result.dependency.newVersion);
  assert.equal(result.dependency.resolution.lockfileConsulted, false);
  assert.ok(result.limitations.some((row) => /not classified as a break/i.test(row)));
});

test("same old/new version is valid input (no_action is a later cell)", () => {
  const result = normalizeCallerInput(
    validInput({
      dependency: { name: "s127-example-dep", oldVersion: "1.0.0", newVersion: "1.0.0" },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.dependency.resolvedOld, result.dependency.resolvedNew);
  assert.ok(result.limitations.some((row) => /identical/i.test(row)));
});

test("lifecycle scripts in fixture package.json are not executed", () => {
  const sentinel = join(FIXTURE_CALLER, "SENTINEL_SHOULD_NOT_EXIST");
  if (existsSync(sentinel)) rmSync(sentinel);
  const result = normalizeCallerInput(validInput(), { workspaceRoot: FIXTURE_CALLER });
  assert.equal(result.ok, true);
  assert.equal(result.executed, false);
  assert.equal(existsSync(sentinel), false);
});

test("relative path escape is invalid and does not leak a usable path", () => {
  const result = normalizeCallerInput(
    validInput({
      caller: {
        manifestPath: "../secret/package.json",
        sourceRoots: ["src"],
        evidenceClass: "fixture",
      },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "invalid");
  assert.ok(issueCodes(result).includes("path_escape"));
  assert.equal(result.caller.manifestPath, null);
  const escape = result.issues.find((row) => row.code === "path_escape");
  assert.equal(escape.kind, "invalid");
  assert.equal(escape.keyword, "pathEscape");
  assert.equal(escape.instancePath, "/caller/manifestPath");
  assert.equal(escape.params.escaped, true);
  assert.equal(Object.prototype.hasOwnProperty.call(escape.params, "resolved"), false);
});

test("absolute path outside workspace is invalid", () => {
  const result = normalizeCallerInput(
    validInput({
      caller: {
        manifestPath: "/etc/passwd",
        sourceRoots: ["src"],
        evidenceClass: "fixture",
      },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.status, "invalid");
  assert.ok(issueCodes(result).includes("path_escape"));
  assert.equal(result.caller.manifestPath, null);
});

test("null byte in path is invalid", () => {
  const result = normalizeCallerInput(
    validInput({
      caller: {
        manifestPath: "package.json\0.txt",
        sourceRoots: ["src"],
        evidenceClass: "fixture",
      },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.status, "invalid");
  assert.ok(issueCodes(result).includes("pattern"));
});

test("file:// and home/env paths are rejected", () => {
  for (const manifestPath of ["file:///etc/passwd", "~/package.json", "$HOME/package.json", "//server/share"]) {
    const result = normalizeCallerInput(
      validInput({
        caller: { manifestPath, sourceRoots: ["src"], evidenceClass: "fixture" },
      }),
      { workspaceRoot: FIXTURE_CALLER },
    );
    assert.equal(result.status, "invalid", manifestPath);
    assert.ok(issueCodes(result).includes("path_escape"), manifestPath);
  }
});

test("missing operator clock is invalid; now is refused", () => {
  const missing = normalizeCallerInput(
    { caller: { manifestPath: "package.json" }, dependency: { name: "s127-example-dep", oldVersion: "1.0.0" } },
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(missing.status, "invalid");
  assert.ok(issueCodes(missing).includes("required"));
  assert.ok(missing.issues.some((row) => row.instancePath === "/clock"));

  const now = normalizeCallerInput(validInput({ clock: "now" }), { workspaceRoot: FIXTURE_CALLER });
  assert.equal(now.status, "invalid");
  assert.ok(now.issues.some((row) => row.instancePath === "/clock"));
});

test("clock without timezone offset is invalid", () => {
  const result = normalizeCallerInput(validInput({ clock: "2026-09-10T09:54:59" }), {
    workspaceRoot: FIXTURE_CALLER,
  });
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.keyword === "format" && row.instancePath === "/clock"));
});

test("invalid package name is invalid", () => {
  for (const name of ["", "Foo", "../evil", ".hidden", "_private", "s127-example-dep/nested", "node_modules"]) {
    const result = normalizeCallerInput(
      validInput({ dependency: { name, oldVersion: "1.0.0", newVersion: "1.1.0" } }),
      { workspaceRoot: FIXTURE_CALLER },
    );
    assert.equal(result.status, "invalid", name);
    assert.ok(result.issues.some((row) => row.instancePath === "/dependency/name"), name);
  }
  assert.equal(isNpmPackageName("s127-example-dep"), true);
  assert.equal(isNpmPackageName("@scope/pkg"), true);
  assert.equal(isNpmPackageName("Left-Pad"), false);
});

test("missing manifest file is unknown, not a throw", () => {
  const result = normalizeCallerInput(
    validInput({
      caller: {
        manifestPath: "no-such-package.json",
        lockfilePath: "package-lock.json",
        sourceRoots: ["src"],
        evidenceClass: "fixture",
      },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "unknown");
  assert.ok(issueCodes(result).includes("missing_path"));
  assert.equal(result.caller.manifestPath, join(FIXTURE_CALLER, "no-such-package.json"));
  assert.equal(result.partial, true);
});

test("range and dist-tag versions stay unresolved (unknown coverage, not a schema crash)", () => {
  const range = normalizeCallerInput(
    validInput({
      dependency: { name: "s127-example-dep", oldVersion: "^1.0.0", newVersion: "latest" },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(range.ok, true, JSON.stringify(range.issues, null, 2));
  assert.equal(range.dependency.resolvedOld, null);
  assert.equal(range.dependency.resolvedNew, null);
  assert.ok(range.unknownReasons.includes("unresolved_range"));
  assert.ok(range.unknownReasons.includes("unresolved_dist_tag"));
  assert.equal(range.dependency.oldKind, "range");
  assert.equal(range.dependency.newKind, "dist-tag");
});

test("file: protocol version is unknown and is not opened as a path", () => {
  const result = normalizeCallerInput(
    validInput({
      dependency: { name: "s127-example-dep", oldVersion: "file:../outside", newVersion: "2.0.0" },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.dependency.oldKind, "protocol");
  assert.equal(result.dependency.resolvedOld, null);
  assert.ok(result.unknownReasons.includes("protocol_version"));
  assert.ok(result.limitations.some((row) => /not opened or executed/i.test(row)));
});

test("garbage input never throws; returns structured invalid", () => {
  for (const garbage of [null, undefined, 12, "string", [], true]) {
    const result = normalizeCallerInput(garbage);
    assert.equal(result.ok, false);
    assert.equal(result.status, "invalid");
    assert.equal(result.execute, false);
    assert.ok(Array.isArray(result.issues));
    assert.ok(result.issues[0].keyword);
    assert.ok(result.issues[0].instancePath !== undefined);
    assert.ok(result.issues[0].message);
  }
});

test("JSON Schema-ish issue shape is present", () => {
  const result = normalizeCallerInput({ clock: 1, dependency: { name: 2 } });
  assert.equal(result.status, "invalid");
  for (const issue of result.issues) {
    assert.equal(typeof issue.kind, "string");
    assert.ok(issue.kind === "invalid" || issue.kind === "unknown");
    assert.equal(typeof issue.code, "string");
    assert.equal(typeof issue.keyword, "string");
    assert.equal(typeof issue.instancePath, "string");
    assert.equal(typeof issue.schemaPath, "string");
    assert.equal(typeof issue.message, "string");
    assert.equal(typeof issue.params, "object");
  }
  assert.equal(INPUT_JSON_SCHEMA.$id, INPUT_SCHEMA_ID);
  assert.deepEqual(INPUT_JSON_SCHEMA.properties.caller.properties.evidenceClass.enum, [
    "fixture",
    "live-capture",
    "synthetic",
    "owner-qa",
  ]);
});

test("conflicting nested vs flat fields is invalid", () => {
  const result = normalizeCallerInput(
    {
      clock: CLOCK,
      name: "alpha",
      dependency: { name: "beta", oldVersion: "1.0.0", newVersion: "1.1.0" },
      caller: {
        manifestPath: "package.json",
        sourceRoots: ["src"],
        evidenceClass: "fixture",
      },
    },
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.status, "invalid");
  assert.ok(issueCodes(result).includes("conflicting_fields"));
});

test("pin object is an oldVersion/name alias (S122-shaped operator)", () => {
  const result = normalizeCallerInput(
    {
      clock: CLOCK,
      pin: { package: "s127-example-dep", version: "1.0.0" },
      dependency: { newVersion: "1.1.0" },
      caller: {
        manifestPath: "package.json",
        lockfilePath: "package-lock.json",
        sourceRoots: ["src"],
        evidenceClass: "fixture",
      },
    },
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.dependency.name, "s127-example-dep");
  assert.equal(result.dependency.oldVersion, "1.0.0");
  assert.equal(result.dependency.resolvedOld, "1.0.0");
});

test("evidenceClass defaults to fixture and live-replay maps to live-capture", () => {
  const def = normalizeCallerInput(
    {
      clock: CLOCK,
      dependency: { name: "s127-example-dep", oldVersion: "1.0.0", newVersion: "1.1.0" },
      caller: { manifestPath: "package.json", sourceRoots: ["src"] },
    },
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(def.ok, true, JSON.stringify(def.issues, null, 2));
  assert.equal(def.caller.evidenceClass, "fixture");
  assert.ok(def.defaultsApplied.some((row) => /evidenceClass=fixture/.test(row)));

  const mapped = normalizeCallerInput(
    validInput({
      caller: {
        manifestPath: "package.json",
        sourceRoots: ["src"],
        evidenceClass: "live-replay",
      },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(mapped.ok, true, JSON.stringify(mapped.issues, null, 2));
  assert.equal(mapped.caller.evidenceClass, "live-capture");
});

test("omitted lockfile is allowed; specified missing lockfile is unknown", () => {
  const omitted = normalizeCallerInput(
    validInput({
      caller: {
        manifestPath: "package.json",
        sourceRoots: ["src"],
        evidenceClass: "fixture",
      },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(omitted.ok, true, JSON.stringify(omitted.issues, null, 2));
  assert.equal(omitted.caller.lockfilePath, null);
  assert.equal(omitted.caller.fs.lockfile, "omitted");

  const missing = normalizeCallerInput(
    validInput({
      caller: {
        manifestPath: "package.json",
        lockfilePath: "yarn.lock",
        sourceRoots: ["src"],
        evidenceClass: "fixture",
      },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(missing.status, "unknown");
  assert.ok(issueCodes(missing).includes("missing_path"));
});

test("explicit empty sourceRoots is ok-shaped with unknown usage coverage", () => {
  const result = normalizeCallerInput(
    validInput({
      caller: {
        manifestPath: "package.json",
        lockfilePath: "package-lock.json",
        sourceRoots: [],
        evidenceClass: "fixture",
      },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.caller.sourceRoots, []);
  assert.ok(result.unknownReasons.includes("empty_source_roots"));
});

test("sourceRoots oversize is invalid", () => {
  const result = normalizeCallerInput(
    validInput({
      caller: {
        manifestPath: "package.json",
        sourceRoots: Array.from({ length: 65 }, (_, i) => `src-${i}`),
        evidenceClass: "fixture",
      },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.status, "invalid");
  assert.ok(issueCodes(result).includes("maxItems"));
});

test("options.workspaceRoot jail rejects an escaping input workspaceRoot", () => {
  const result = normalizeCallerInput(
    validInput({ workspaceRoot: "/etc" }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.status, "invalid");
  assert.ok(issueCodes(result).includes("path_escape"));
});

test("symlink paths are refused and not followed", () => {
  const root = mkdtempSync(join(tmpdir(), "s127-c01-"));
  try {
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "tmp", private: true })}\n`);
    mkdirSync(join(root, "src"));
    symlinkSync("/etc/passwd", join(root, "lock-link"));
    const result = normalizeCallerInput(
      {
        clock: CLOCK,
        caller: {
          manifestPath: "package.json",
          lockfilePath: "lock-link",
          sourceRoots: ["src"],
          evidenceClass: "fixture",
        },
        dependency: { name: "s127-example-dep", oldVersion: "1.0.0", newVersion: "1.1.0" },
      },
      { workspaceRoot: root },
    );
    assert.equal(result.status, "invalid");
    assert.ok(issueCodes(result).includes("symlink_refused"));
    assert.equal(result.caller.lockfilePath, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("v-prefixed exact semver canonicalizes resolved fields", () => {
  const result = normalizeCallerInput(
    validInput({
      dependency: { name: "s127-example-dep", oldVersion: "v1.2.3-rc.1", newVersion: "1.2.3" },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.dependency.resolvedOld, "1.2.3-rc.1");
  assert.equal(result.dependency.oldVersion, "v1.2.3-rc.1");
});

test("classifyVersionToken covers exact, range, dist-tag, protocol, invalid", () => {
  assert.equal(classifyVersionToken("1.2.3").kind, "exact");
  assert.equal(classifyVersionToken("^1.2.3").kind, "range");
  assert.equal(classifyVersionToken("latest").kind, "dist-tag");
  assert.equal(classifyVersionToken("workspace:*").kind, "protocol");
  assert.equal(classifyVersionToken("not a version").kind, "invalid");
});

test("confinePath: inside-jail .. is ok; escaping .. is invalid; missing is unknown", () => {
  const inside = confinePath("src/../package.json", {
    workspaceRoot: FIXTURE_CALLER,
    instancePath: "/caller/manifestPath",
    expect: "file",
  });
  assert.equal(inside.ok, true, JSON.stringify(inside.issues, null, 2));
  assert.equal(inside.relative, "package.json");

  const escape = confinePath("../../etc/passwd", {
    workspaceRoot: FIXTURE_CALLER,
    instancePath: "/caller/manifestPath",
    expect: "file",
  });
  assert.equal(escape.ok, false);
  assert.equal(escape.status, "invalid");
  assert.equal(escape.path, null);

  const missing = confinePath("absent.json", {
    workspaceRoot: FIXTURE_CALLER,
    instancePath: "/caller/manifestPath",
    expect: "file",
  });
  assert.equal(missing.status, "unknown");
  assert.equal(missing.exists, false);
});

test("does not mutate the caller input object", () => {
  const input = validInput();
  const copy = JSON.parse(JSON.stringify(input));
  normalizeCallerInput(input, { workspaceRoot: FIXTURE_CALLER });
  assert.deepEqual(input, copy);
});

test("extra unknown keys are ignored (not additionalProperties errors)", () => {
  const result = normalizeCallerInput(
    validInput({ scheduleHint: "weekly", unused: { nested: true } }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("resolvedOld conflict with exact oldVersion is unknown, not a crash", () => {
  const result = normalizeCallerInput(
    validInput({
      dependency: {
        name: "s127-example-dep",
        oldVersion: "1.0.0",
        newVersion: "1.1.0",
        resolvedOld: "9.9.9",
      },
    }),
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.status, "unknown");
  assert.ok(issueCodes(result).includes("conflicting_fields"));
  assert.equal(result.dependency.resolvedOld, null);
});

test("stdin JSON CLI writes a result object and never throws", () => {
  const proc = spawnSync(process.execPath, [NORMALIZE_BIN], {
    encoding: "utf8",
    input: JSON.stringify({
      workspaceRoot: FIXTURE_CALLER,
      clock: CLOCK,
      caller: {
        manifestPath: "package.json",
        lockfilePath: "package-lock.json",
        sourceRoots: ["src"],
        evidenceClass: "fixture",
      },
      dependency: { name: "s127-example-dep", oldVersion: "1.0.0", newVersion: "1.1.0" },
    }),
    timeout: 15000,
  });
  assert.equal(proc.error, undefined, String(proc.error));
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  const result = JSON.parse(proc.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.execute, false);
  assert.equal(result.dependency.name, "s127-example-dep");
});

test("stdin invalid JSON is structured invalid with exit 1", () => {
  const proc = spawnSync(process.execPath, [NORMALIZE_BIN], {
    encoding: "utf8",
    input: "{ not json",
    timeout: 15000,
  });
  assert.equal(proc.status, 1);
  const result = JSON.parse(proc.stdout);
  assert.equal(result.ok, false);
  assert.equal(result.status, "invalid");
  assert.ok(issueCodes(result).includes("invalid_json"));
});

test("default sourceRoots is the manifest directory", () => {
  const result = normalizeCallerInput(
    {
      clock: CLOCK,
      dependency: { name: "s127-example-dep", oldVersion: "1.0.0", newVersion: "1.1.0" },
      caller: { manifestPath: "package.json", evidenceClass: "fixture" },
    },
    { workspaceRoot: FIXTURE_CALLER },
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.caller.sourceRoots, [FIXTURE_CALLER]);
  assert.deepEqual(result.caller.sourceRootsRelative, ["."]);
});
