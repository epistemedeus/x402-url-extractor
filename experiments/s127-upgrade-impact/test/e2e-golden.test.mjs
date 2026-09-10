import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SYNTHETIC, jsonReady, loadPipeline } from "./helpers.mjs";

const REQUIRED = [
  "removed-export-used",
  "removed-export-unused",
  "same-version-noop",
  "partial-missing-source",
  "dynamic-import",
  "renamed-export",
  "version-range-prerelease",
];

test("stub compose matches committed goldens for required cases", async () => {
  const { stubCompose, stub } = await loadPipeline();
  for (const id of REQUIRED) {
    const { input } = stub.cases.loadSyntheticCase(id);
    const packet = stubCompose(input);
    const golden = JSON.parse(readFileSync(join(SYNTHETIC, "goldens", `${id}.packet.json`), "utf8"));
    assert.deepEqual(jsonReady(packet), golden, id);
  }
});

test("end-to-end golden: used-removed export is the action packet", async () => {
  const golden = JSON.parse(readFileSync(join(SYNTHETIC, "goldens/removed-export-used.packet.json"), "utf8"));
  assert.equal(golden.schema, "s127.upgrade-impact.packet.v1");
  assert.equal(golden.summary.nextAction, "action");
  assert.deepEqual(golden.exportDiff.removed, ["alpha"]);
  assert.equal(golden.usage.some((row) => row.symbol === "alpha" && row.dynamicImport === false), true);
  const alpha = golden.bindings.find((row) => row.symbol === "alpha");
  assert.equal(alpha.used, true);
  assert.equal(alpha.decision, "action");
  assert.equal(golden.limitations.includes("no full TypeScript program analysis"), true);
  assert.equal(golden.prior.sequence, 1);
  assert.equal(golden.prior.immutable, true);
});
