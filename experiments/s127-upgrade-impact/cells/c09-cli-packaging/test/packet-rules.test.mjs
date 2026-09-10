import assert from "node:assert/strict";
import test from "node:test";
import {
  createBasePacket,
  finalizePacket,
  hasLockfileDisagreement,
  isSameDeclaredVersion,
} from "../../../scripts/lib/packet.mjs";

const clock = "2026-09-10T12:00:00.000Z";

function base(overrides = {}) {
  const packet = createBasePacket({
    command: "analyze",
    input: {
      clock,
      dep: "demo-dep",
      old: "1.0.0",
      new: "2.0.0",
      sourceRoots: [],
      liveCapture: false,
    },
  });
  return { ...packet, ...overrides, dependency: { ...packet.dependency, ...(overrides.dependency || {}) } };
}

test("same declared version is no_action even if a binding claims action", () => {
  const packet = finalizePacket(
    base({
      dependency: { name: "demo-dep", oldVersion: "1.0.0", newVersion: "1.0.0", resolvedOld: null, resolvedNew: null },
      usage: { items: [], dynamicImport: false, coverage: "stub" },
      exportDiff: { added: [], removed: [], renamed: [], signatureChanged: [], coverage: "stub" },
      bindings: [
        {
          symbol: "alpha",
          used: true,
          changeKind: "removed",
          decision: "action",
          rationale: "should be coerced",
        },
      ],
    }),
  );
  assert.equal(packet.summary.nextAction, "no_action");
  assert.equal(packet.bindings[0].decision, "no_action");
  assert.equal(isSameDeclaredVersion(packet.dependency), true);
});

test("unused export change is not a caller defect", () => {
  const packet = finalizePacket(
    base({
      usage: { items: [], dynamicImport: false, coverage: "stub" },
      exportDiff: { added: [], removed: ["gamma"], renamed: [], signatureChanged: [], coverage: "stub" },
      bindings: [
        {
          symbol: "gamma",
          used: false,
          changeKind: "removed",
          decision: "action",
          rationale: "illegal action on unused",
        },
      ],
    }),
  );
  assert.equal(packet.bindings[0].decision, "no_action");
  assert.deepEqual(packet.summary.unusedChanges, ["gamma"]);
  assert.equal(packet.summary.nextAction, "no_action");
  assert.deepEqual(packet.summary.actionableChanges, []);
});

test("version bump with unknown coverage and no used bindings is unknown, not action", () => {
  const packet = finalizePacket(base());
  assert.equal(packet.summary.nextAction, "unknown");
  assert.ok(packet.summary.unknownReasons.includes("partial_or_missing_source_or_analysis"));
  assert.deepEqual(packet.summary.actionableChanges, []);
});

test("used removed export may be action", () => {
  const packet = finalizePacket(
    base({
      usage: {
        items: [{ specifier: "demo-dep", symbols: ["alpha"], dynamicImport: false }],
        dynamicImport: false,
        coverage: "stub",
      },
      exportDiff: { added: [], removed: ["alpha"], renamed: [], signatureChanged: [], coverage: "stub" },
      bindings: [
        {
          symbol: "alpha",
          used: true,
          changeKind: "removed",
          decision: "action",
          rationale: "used export removed",
        },
      ],
    }),
  );
  assert.equal(packet.summary.nextAction, "action");
  assert.deepEqual(packet.summary.actionableChanges, ["alpha"]);
});

test("dynamic import of package surface is unknown, not action", () => {
  const packet = finalizePacket(
    base({
      usage: {
        items: [{ specifier: "demo-dep", symbols: ["alpha"], dynamicImport: true }],
        dynamicImport: true,
        coverage: "stub",
      },
      exportDiff: { added: [], removed: ["alpha"], renamed: [], signatureChanged: [], coverage: "stub" },
      bindings: [
        {
          symbol: "alpha",
          used: true,
          dynamicImport: true,
          changeKind: "removed",
          decision: "action",
          rationale: "dynamic",
        },
      ],
    }),
  );
  assert.equal(packet.bindings[0].decision, "unknown");
  assert.equal(packet.summary.nextAction, "unknown");
  assert.deepEqual(packet.summary.actionableChanges, []);
});

test("lockfile disagreement is unknown even on same declared version", () => {
  const packet = finalizePacket(
    base({
      dependency: {
        name: "demo-dep",
        oldVersion: "1.0.0",
        newVersion: "1.0.0",
        resolvedOld: "1.0.0",
        resolvedNew: "1.0.0",
        lockfileDisagreement: true,
      },
      usage: { items: [], dynamicImport: false, coverage: "stub" },
      exportDiff: { added: [], removed: [], renamed: [], signatureChanged: [], coverage: "stub" },
    }),
  );
  assert.equal(hasLockfileDisagreement(packet), true);
  assert.equal(packet.summary.nextAction, "unknown");
});
