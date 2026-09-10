import assert from "node:assert/strict";
import test from "node:test";
import { assertCaseExpectations, loadPipeline } from "./helpers.mjs";

const REQUIRED = [
  "removed-export-used",
  "removed-export-unused",
  "same-version-noop",
  "partial-missing-source",
  "dynamic-import",
  "renamed-export",
  "version-range-prerelease",
];

test("required synthetic cases match catalog expectations via pipeline", async () => {
  const { stubCompose: compose, stub } = await loadPipeline();
  for (const id of REQUIRED) {
    const { spec, input } = stub.cases.loadSyntheticCase(id);
    const packet = compose(input);
    assert.equal(packet.ok, true, `${id}: ${packet.code} ${packet.message}`);
    assert.equal(packet.schema, "s127.upgrade-impact.packet.v1");
    assert.equal(packet.caller.evidenceClass, "synthetic");
    assertCaseExpectations(assert, packet, spec);
  }
});

test("extra synthetic cases still refuse paid-demand claims", async () => {
  const { stubCompose: compose, stub } = await loadPipeline();
  for (const id of ["signature-changed", "workspace-alias"]) {
    const { spec, input } = stub.cases.loadSyntheticCase(id);
    const packet = compose(input);
    assert.equal(packet.ok, true, id);
    assertCaseExpectations(assert, packet, spec);
    assert.equal(packet.caller.evidenceClass, "synthetic");
  }
});

test("a newer version with no used export change is not action", async () => {
  const { stubCompose: compose, stub } = await loadPipeline();
  const { input } = stub.cases.loadSyntheticCase("removed-export-unused");
  const packet = compose(input);
  assert.equal(packet.dependency.oldVersion, "1.0.0");
  assert.equal(packet.dependency.newVersion, "2.0.0");
  assert.notEqual(packet.dependency.oldVersion, packet.dependency.newVersion);
  assert.equal(packet.summary.nextAction, "no_action");
});
