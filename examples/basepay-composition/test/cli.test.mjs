import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { LAYER1_NAME, LAYER2_NAME } from "../src/layers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin/cli.mjs");

function run(args, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, expectStatus, result.stderr || result.stdout);
  return result;
}

test("default CLI compose prints both named layers and refuses live-wallet assurance", () => {
  const result = run([]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.layers[LAYER1_NAME].status, "evaluated");
  assert.equal(report.layers[LAYER2_NAME].replay.checks.passed, 19);
  assert.equal(report.layers[LAYER2_NAME].replay.evidenceOrigin, "synthetic_offline_fixture");
  assert.equal(report.layers[LAYER2_NAME].replay.independentTipReplay, false);
  assert.equal(report.mappingCoverage.covered, 4);
  assert.equal(report.mappingCoverage.partial, 1);
  assert.equal(report.mappingCoverage.gap, 2);
  assert.equal(report.promotionRefused.fromLayer2ToProviderNativeVerified, true);
  assert.equal(report.boundary.liveWalletAssurance, false);
  assert.equal(report.providerNativeVerified.upgradedFromLayer2, false);
});

test("CLI help lists pins and copyable commands", () => {
  const result = run(["--help"]);
  assert.match(result.stdout, /Layer 1/);
  assert.match(result.stdout, /Layer 2/);
  assert.match(result.stdout, /94fa65d65c204c02f4af5a9bc9fd27225c688994/);
  assert.match(result.stdout, /8a46910ede4830de8481a3ae7f095e120a312d62/);
  assert.match(result.stdout, /npm run compose/);
  assert.match(result.stdout, /providerNativeVerified is layer-1 only/);
  assert.match(result.stdout, /acquire-upstream/);
  assert.match(result.stdout, /synthetic/);
});

test("contradictory observations still emit a two-layer report", () => {
  const result = run(["--observations", "./fixtures/observations/contradictory.json"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.layers[LAYER1_NAME].kind, "contradictory");
  assert.equal(report.layers[LAYER2_NAME].checks.independentCount, 19);
  assert.deepEqual(report.providerNativeVerified.controls, []);
});

test("unknown CLI arguments fail closed", () => {
  run(["--wallet"], { expectStatus: 1 });
});
