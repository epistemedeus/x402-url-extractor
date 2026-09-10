import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { SYNTHETIC, loadPipeline } from "./helpers.mjs";

test("rangeSatisfies: caret 1.x does not include 2.0.0-beta.1", async () => {
  const { impl } = await loadPipeline();
  const sat = impl.rangeSatisfies("^1.0.0", "2.0.0-beta.1");
  assert.equal(sat.unknown, false);
  assert.equal(sat.ok, false);
});

test("rangeSatisfies: exact and caret happy paths", async () => {
  const { impl } = await loadPipeline();
  assert.equal(impl.rangeSatisfies("1.0.0", "1.0.0").ok, true);
  assert.equal(impl.rangeSatisfies("^1.0.0", "1.2.3").ok, true);
  assert.equal(impl.rangeSatisfies("^1.0.0", "1.0.0").ok, true);
  const alias = impl.rangeSatisfies("npm:demo-widget@1.0.0", "1.0.0");
  assert.equal(alias.unknown, true);
  assert.equal(alias.reason, "npm_alias");
  const ws = impl.rangeSatisfies("workspace:*", "9.9.9");
  assert.equal(ws.unknown, true);
});

test("resolveDependency reports lockfile vs range disagreement on prerelease", async () => {
  const { impl } = await loadPipeline();
  const resolved = impl.resolveDependency({
    name: "demo-widget",
    manifestPath: join(SYNTHETIC, "callers/version-range-prerelease/package.json"),
    lockfilePath: join(SYNTHETIC, "callers/version-range-prerelease/package-lock.json"),
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.requestedRange, "^1.0.0");
  assert.equal(resolved.resolved, "2.0.0-beta.1");
  assert.ok(resolved.disagreements.some((row) => row.kind === "lockfile_range_disagreement"));
  assert.ok(resolved.limitations.some((row) => String(row).includes("prerelease")));
});

test("resolveDependency records npm alias as unknown identity", async () => {
  const { impl } = await loadPipeline();
  const resolved = impl.resolveDependency({
    name: "widget",
    manifestPath: join(SYNTHETIC, "callers/workspace-alias/package.json"),
    lockfilePath: join(SYNTHETIC, "callers/workspace-alias/package-lock.json"),
  });
  assert.equal(resolved.ok, true);
  assert.ok(resolved.aliases.length >= 1);
  assert.ok(resolved.unknownReasons.includes("alias_or_workspace"));
});
