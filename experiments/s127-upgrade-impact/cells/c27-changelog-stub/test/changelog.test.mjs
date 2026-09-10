import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  BASELINE,
  DECISIONS,
  RULE_IDS,
  SCHEMA,
  applyChangelogStubToPacket,
  decide,
  decideFromChangelog,
} from "../changelog.mjs";
import {
  coarseBinderDecision,
  compareBaselineToBinder,
  decisionChangedRelativeToChangelog,
} from "../compare.mjs";
import { loadFixtures } from "../load-fixtures.mjs";
import { MAX_CHANGELOG_CHARS, extractChangelogText, scanChangelogSignals } from "../scan.mjs";
import { classifySemverDelta, versionIdentity } from "../semver.mjs";

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

test("synthetic and sibling fixtures: decision, ruleId, labels, no usage binding", () => {
  const fixtures = loadFixtures();
  assert.ok(fixtures.length >= 16, `expected a full fixture matrix, got ${fixtures.length}`);
  const labels = new Set();
  for (const fixture of fixtures) {
    assert.ok(fixture.id, "fixture id");
    assert.ok(fixture.label === "synthetic" || fixture.label === "fixture", `${fixture.id} label`);
    assert.notEqual(fixture.label, "live-capture", `${fixture.id} this cell did not live-capture`);
    labels.add(fixture.label);
    const result = decideFromChangelog(fixture.input);
    const expect = fixture.expect;
    assert.equal(result.schema, SCHEMA, fixture.id);
    assert.equal(result.baseline, BASELINE, fixture.id);
    assert.equal(result.usageBinding, false, fixture.id);
    assert.equal(result.decision, expect.decision, `${fixture.id} decision`);
    assert.equal(result.ruleId, expect.ruleId, `${fixture.id} ruleId`);
    if (expect.delta) assert.equal(result.delta, expect.delta, `${fixture.id} delta`);
    assert.equal(result.summary.nextAction, result.decision, `${fixture.id} summary`);
    assert.deepEqual(result.bindings, [], `${fixture.id} bindings must stay empty`);
    assert.deepEqual(result.summary.unusedChanges, [], `${fixture.id} unusedChanges`);
    assert.deepEqual(result.summary.actionableChanges, [], `${fixture.id} actionableChanges`);
    assert.equal(result.execute, false, fixture.id);
    assert.equal(result.paidDemand, false, fixture.id);
    if (expect.ignoredCallerSurfaces === true) {
      assert.equal(result.ignoredCallerSurfaces, true, `${fixture.id} ignoredCallerSurfaces`);
    }
    if (expect.bindingsEmpty) assert.equal(result.bindings.length, 0, fixture.id);
    if (fixture.binderWould) {
      const cmp = compareBaselineToBinder(result, {
        summary: { nextAction: fixture.binderWould.coarse },
      });
      assert.equal(
        cmp.decisionChangedRelativeToChangelog,
        fixture.binderWould.decisionChangedRelativeToChangelog,
        `${fixture.id} kill contrast`,
      );
    }
  }
  assert.ok(labels.has("synthetic"));
  assert.ok(labels.has("fixture"));
});

test("decide alias matches decideFromChangelog", () => {
  assert.equal(decide, decideFromChangelog);
});

test("rule ids and decisions are the contracted sets", () => {
  for (const id of RULE_IDS) assert.equal(typeof id, "string");
  assert.deepEqual([...DECISIONS], ["action", "unknown", "no_action"]);
});

test("usage and exportDiff never change a patch-unknown into action", () => {
  const result = decideFromChangelog({
    evidenceClass: "synthetic",
    clock: "2026-09-10T12:00:00.000Z",
    oldVersion: "1.0.0",
    newVersion: "1.0.1",
    usage: { references: [{ symbol: "foo", used: true }] },
    exportDiff: { removed: ["foo"] },
    bindings: [{ symbol: "foo", used: true, changeKind: "removed", decision: "action" }],
  });
  assert.equal(result.decision, "unknown");
  assert.equal(result.ignoredCallerSurfaces, true);
  assert.deepEqual(result.bindings, []);
});

test("breaking changelog over-fires action when usage says unused", () => {
  const result = decideFromChangelog({
    evidenceClass: "synthetic",
    oldVersion: "1.0.0",
    newVersion: "2.0.0",
    changelogText: "removed export alpha",
    usage: { references: [{ symbol: "beta" }] },
    exportDiff: { removed: ["alpha"] },
  });
  assert.equal(result.decision, "action");
  assert.equal(result.ruleId, "changelog_breaking_keyword");
  const binder = { summary: { nextAction: "no_action" } };
  assert.equal(decisionChangedRelativeToChangelog(result, binder), true);
});

test("does not invent a clock", () => {
  const result = decideFromChangelog({
    oldVersion: "1.0.0",
    newVersion: "2.0.0",
  });
  assert.equal(result.clock, null);
  assert.equal(result.createdAt, null);
});

test("hostile or non-object input is unknown, not action", () => {
  for (const input of [null, undefined, "1.0.0", 12, [], true]) {
    const result = decideFromChangelog(input);
    assert.equal(result.decision, "unknown", String(input));
    assert.notEqual(result.decision, "action");
  }
});

test("changelog truncation marks partial coverage", () => {
  const text = `${"removed ".repeat(10)}${"x".repeat(MAX_CHANGELOG_CHARS)}`;
  const result = decideFromChangelog({
    oldVersion: "1.0.0",
    newVersion: "2.0.0",
    changelogText: text,
    evidenceClass: "synthetic",
  });
  assert.equal(result.changelog.truncated, true);
  assert.equal(result.changelog.coverage, "partial");
  assert.equal(result.decision, "action");
});

test("contentSha256 is sha256 of the skimmed changelog text", () => {
  const text = "The old parse method has been renamed to parseCookie.";
  const result = decideFromChangelog({
    oldVersion: "1.0.0",
    newVersion: "2.0.0",
    changelogText: text,
  });
  assert.equal(result.changelog.contentSha256, sha256Hex(text));
  assert.equal(result.provenance[0].contentSha256, sha256Hex(text));
});

test("applyChangelogStubToPacket leaves caller bindings in place", () => {
  const packet = {
    schema: "s127.upgrade-impact.packet.v1",
    clock: "2026-09-10T12:00:00.000Z",
    dependency: { name: "demo", oldVersion: "1.0.0", newVersion: "2.0.0" },
    bindings: [
      {
        symbol: "alpha",
        used: false,
        changeKind: "removed",
        decision: "no_action",
        rationale: "unused",
      },
    ],
    summary: { nextAction: "no_action", unknownReasons: [], unusedChanges: ["alpha"], actionableChanges: [] },
    changelogText: "BREAKING CHANGE: removed alpha",
    evidenceClass: "synthetic",
  };
  const out = applyChangelogStubToPacket(packet);
  assert.equal(out.bindings[0].decision, "no_action");
  assert.equal(out.changelogBaseline.decision, "action");
  assert.equal(out.changelogBaseline.usageBinding, false);
  assert.equal(decisionChangedRelativeToChangelog(out.changelogBaseline, packet), true);
});

test("coarseBinderDecision maps c06 nextAction words", () => {
  assert.equal(coarseBinderDecision({ summary: { nextAction: "review_breakages" } }), "action");
  assert.equal(coarseBinderDecision({ summary: { nextAction: "upgrade_with_edits" } }), "action");
  assert.equal(coarseBinderDecision({ summary: { nextAction: "no_action" } }), "no_action");
  assert.equal(coarseBinderDecision({ summary: { nextAction: "unknown" } }), "unknown");
});

test("semver identity and delta", () => {
  assert.equal(versionIdentity("1.0.0", "1.0.0"), "same");
  assert.equal(versionIdentity("v1.0.0", "1.0.0"), "same");
  assert.equal(versionIdentity("1.0.0-rc.1", "1.0.0"), "prerelease_or_build_diff");
  assert.equal(classifySemverDelta("1.0.0", "2.0.0"), "major");
  assert.equal(classifySemverDelta("1.0.0", "1.1.0"), "minor");
  assert.equal(classifySemverDelta("1.0.0", "1.0.1"), "patch");
  assert.equal(classifySemverDelta("workspace:*", "1.0.0"), "unknown");
});

test("keyword skim: cookie-like rename notes are breakingLike", () => {
  const signals = scanChangelogSignals(
    "The old parse and stringify methods have been renamed: parseCookie and stringifySetCookie. Remove deprecated code paths. ESM only.",
  );
  assert.equal(signals.renamed, true);
  assert.equal(signals.removed, true);
  assert.equal(signals.breaking, true);
  assert.equal(signals.breakingLike, true);
});

test("extractChangelogText concatenates GitHub-style releases as partial coverage", () => {
  const extracted = extractChangelogText({
    label: "fixture",
    url: "https://example.invalid/releases",
    releases: [
      { tag_name: "v2.0.0", body: "renamed parse" },
      { tag_name: "v2.0.1", body: "performance tweak" },
    ],
  });
  assert.equal(extracted.present, true);
  assert.equal(extracted.coverage, "partial");
  assert.match(extracted.text, /renamed parse/);
  assert.match(extracted.text, /performance tweak/);
  assert.equal(extracted.label, "fixture");
});

test("path/url without body is missing coverage, not a fetch", () => {
  const extracted = extractChangelogText({
    url: "https://registry.npmjs.org/cookie",
    path: "does-not-read-from-disk.md",
  });
  assert.equal(extracted.present, false);
  assert.equal(extracted.coverage, "missing");
});
