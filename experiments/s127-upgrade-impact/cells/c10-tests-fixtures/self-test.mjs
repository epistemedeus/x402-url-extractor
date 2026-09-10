import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SYNTHETIC_ROOT, loadSyntheticCase } from "./lib/cases.mjs";
import { composePacket, stubImpl } from "./lib/packet.mjs";
import { validatePacket } from "./lib/validate.mjs";

test("isolation: stub pipeline produces action for used-removed export", () => {
  const { input } = loadSyntheticCase("removed-export-used");
  const packet = composePacket(input, stubImpl());
  assert.equal(packet.ok, true);
  assert.equal(packet.summary.nextAction, "action");
  const check = validatePacket(packet);
  assert.equal(check.ok, true, check.errors?.join("; "));
  const golden = JSON.parse(readFileSync(join(SYNTHETIC_ROOT, "goldens/removed-export-used.packet.json"), "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(packet)), golden);
});

test("isolation: unused removal and same-version are no_action", () => {
  const impl = stubImpl();
  const unused = composePacket(loadSyntheticCase("removed-export-unused").input, impl);
  const noop = composePacket(loadSyntheticCase("same-version-noop").input, impl);
  assert.equal(unused.summary.nextAction, "no_action");
  assert.equal(noop.summary.nextAction, "no_action");
});

test("isolation: partial, dynamic, and lockfile-prerelease stay unknown", () => {
  const impl = stubImpl();
  for (const id of ["partial-missing-source", "dynamic-import", "version-range-prerelease"]) {
    const packet = composePacket(loadSyntheticCase(id).input, impl);
    assert.equal(packet.summary.nextAction, "unknown", id);
    assert.equal(packet.summary.actionableChanges.length, 0, id);
  }
});
