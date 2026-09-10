import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { analyzeLockfile, readLockfileText, resolveLockfile } from "../overlay.mjs";

const cellRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (...parts) => join(cellRoot, "fixtures", ...parts);

test("overlay simple: resolvedOld from lockfile, resolvedNew not invented", () => {
  const { overlay } = resolveLockfile({
    input: {
      lockfilePath: fixture("classic-simple", "yarn.lock"),
      manifestPath: fixture("classic-simple", "package.json"),
      dep: "demo-widget",
      old: "1.0.0",
      new: "2.0.0",
      clock: "2026-09-10T12:00:00.000Z",
      evidenceClass: "fixture",
    },
  });
  assert.equal(overlay.dependency.resolvedOld, "1.0.0");
  assert.equal(overlay.dependency.resolvedNew, null);
  assert.equal(overlay.dependency.lockfileDisagreement, false);
  assert.equal(overlay.lockfile.format, "classic-v1");
  assert.equal(overlay.provenance[0].label, "fixture");
  assert.equal(overlay.provenance[0].retrievedAt, "2026-09-10T12:00:00.000Z");
  assert.equal(overlay.provenance[0].contentSha256.length, 64);
  assert.ok(overlay.limitations.some((l) => /berry stays unknown/.test(l)));
});

test("overlay alias: unique alias is resolved, not forced unknown", () => {
  const { overlay } = resolveLockfile({
    input: {
      lockfilePath: fixture("classic-alias", "yarn.lock"),
      manifestPath: fixture("classic-alias", "package.json"),
      dep: "widget",
      clock: "2026-09-10T12:00:00.000Z",
      evidenceClass: "synthetic",
    },
  });
  assert.equal(overlay.dependency.resolvedOld, "1.2.3");
  assert.equal(overlay.dependency.aliasDisagreement, false);
  assert.equal(overlay.lockfile.aliases[0].targetName, "demo-widget");
});

test("overlay conflict: disagreement unknown; does not pick first version", () => {
  const { overlay } = resolveLockfile({
    input: {
      lockfilePath: fixture("classic-conflict", "yarn.lock"),
      manifestPath: fixture("classic-conflict", "package.json"),
      dep: "lodash",
      old: "4.17.21",
      new: "4.17.21",
      clock: "2026-09-10T12:00:00.000Z",
      evidenceClass: "fixture",
    },
  });
  assert.equal(overlay.dependency.resolvedOld, null);
  assert.equal(overlay.dependency.lockfileDisagreement, true);
  assert.ok(overlay.summary.unknownReasons.includes("lockfile_alias_or_workspace_disagreement"));
  assert.ok(overlay.lockfile.conflicts.some((c) => c.kind === "multiple_resolved_versions"));
  assert.deepEqual(overlay.lockfile.uniqueVersions, ["3.10.1", "4.17.21"]);
});

test("overlay berry: unknown, empty resolved", () => {
  const { overlay } = resolveLockfile({
    input: {
      lockfilePath: fixture("berry-v6", "yarn.lock"),
      dep: "demo-widget",
      evidenceClass: "synthetic",
    },
  });
  assert.equal(overlay.dependency.resolvedOld, null);
  assert.ok(overlay.summary.unknownReasons.includes("yarn_berry_unsupported"));
  assert.equal(overlay.lockfile.format, "berry");
  assert.equal(overlay.lockfile.coverage, "unknown");
});

test("overlay missing lockfile: unknown", () => {
  const { overlay } = resolveLockfile({
    input: { lockfilePath: fixture("no-such", "yarn.lock"), dep: "x" },
  });
  assert.equal(overlay.dependency.resolvedOld, null);
  assert.ok(overlay.summary.unknownReasons.some((r) => r.includes("missing_path")));
});

test("analyzeLockfile optional second lockfile fills resolvedNew", () => {
  const analyzed = analyzeLockfile({
    lockfilePath: fixture("classic-simple", "yarn.lock"),
    newLockfilePath: fixture("classic-alias", "yarn.lock"),
    name: "demo-widget",
    clock: "2026-09-10T12:00:00.000Z",
    evidenceClass: "fixture",
  });
  assert.equal(analyzed.resolved.version, "1.0.0");
  // second lockfile aliases widget→demo-widget, so demo-widget still resolves
  assert.equal(analyzed.resolvedNew.status, "resolved");
  assert.equal(analyzed.resolvedNew.version, "1.2.3");
});

test("inline unknown text does not invent a resolved version", () => {
  const analyzed = analyzeLockfile({
    lockfileText: "this is not a lockfile",
    name: "x",
  });
  assert.equal(analyzed.resolved.format, "unknown");
  assert.equal(analyzed.resolved.version, null);
});

test("symlink lockfile is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "c20-yarn-"));
  const target = fixture("classic-simple", "yarn.lock");
  const link = join(dir, "yarn.lock");
  try {
    symlinkSync(target, link);
    const loaded = readLockfileText(link);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.code, "symlink_refused");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
