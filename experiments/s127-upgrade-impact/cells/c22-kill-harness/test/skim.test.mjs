import assert from "node:assert/strict";
import test from "node:test";
import { classifySemverDelta, scanChangelogKeywords, skimRegistryChangelog } from "../lib/skim.mjs";

const CLOCK = "2026-09-10T12:00:00.000Z";

test("classifySemverDelta is local and exact-version only", () => {
  assert.equal(classifySemverDelta("1.0.0", "2.0.0"), "major");
  assert.equal(classifySemverDelta("1.0.0", "1.1.0"), "minor");
  assert.equal(classifySemverDelta("1.0.0", "1.0.1"), "patch");
  assert.equal(classifySemverDelta("1.0.0", "1.0.0"), "same");
  assert.equal(classifySemverDelta("1.0.0", "^2.0.0"), "unknown");
  assert.equal(classifySemverDelta("1.0.0-beta.1", "1.0.0"), "prerelease");
});

test("keyword scan is a stub and does not claim changelog understanding", () => {
  const hit = scanChangelogKeywords("BREAKING CHANGE: removed export alpha");
  assert.equal(hit.scanned, true);
  assert.ok(hit.matches.includes("BREAKING CHANGE"));
  const miss = scanChangelogKeywords("Bugfix release. Internal cleanup.");
  assert.deepEqual(miss.matches, []);
});

test("same version → no_action", () => {
  const out = skimRegistryChangelog({
    clock: CLOCK,
    label: "synthetic",
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "1.0.0" },
    changelogCoverage: "complete",
    changelogText: "unchanged",
  });
  assert.equal(out.summary.nextAction, "no_action");
  assert.equal(out.summary.ruleId, "same_version_noop");
});

test("major bump → review_changelog, not a caller-defect claim", () => {
  const out = skimRegistryChangelog({
    clock: CLOCK,
    label: "synthetic",
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "2.0.0" },
    changelogCoverage: "complete",
    changelogText: "BREAKING CHANGE: removed export alpha",
  });
  assert.equal(out.summary.nextAction, "review_changelog");
  assert.match(out.summary.rationale, /not a caller-defect claim/);
  assert.equal(out.payment.attempted, false);
});

test("patch without keywords → no_action (newer version is not a break)", () => {
  const out = skimRegistryChangelog({
    clock: CLOCK,
    label: "synthetic",
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "1.0.1" },
    changelogCoverage: "complete",
    changelogText: "Bugfix release. Internal cleanup.",
  });
  assert.equal(out.summary.nextAction, "no_action");
  assert.equal(out.summary.ruleId, "patch_changelog_silent");
});

test("patch with stub breaking keywords → review_changelog", () => {
  const out = skimRegistryChangelog({
    clock: CLOCK,
    label: "synthetic",
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "1.0.1" },
    changelogCoverage: "complete",
    changelogText: "BREAKING CHANGE: removed export beta",
  });
  assert.equal(out.summary.nextAction, "review_changelog");
  assert.equal(out.summary.ruleId, "patch_changelog_keywords");
});

test("partial changelog stays unknown, not action", () => {
  const out = skimRegistryChangelog({
    clock: CLOCK,
    label: "synthetic",
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "2.0.0" },
    changelogCoverage: "partial",
    changelogText: "…truncated…",
  });
  assert.equal(out.summary.nextAction, "unknown");
  assert.equal(out.summary.ruleId, "partial_changelog");
});

test("missing versions stay unknown", () => {
  const out = skimRegistryChangelog({ clock: CLOCK, label: "synthetic", dependency: { name: "x" } });
  assert.equal(out.summary.nextAction, "unknown");
  assert.equal(out.summary.ruleId, "missing_versions");
});

test("unlabeled evidence is marked synthetic, never live-capture", () => {
  const out = skimRegistryChangelog({
    clock: CLOCK,
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "1.0.0" },
  });
  assert.equal(out.label, "synthetic");
  assert.notEqual(out.label, "live-capture");
});
