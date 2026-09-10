import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { rmSync } from "node:fs";
import { cloneReplay, writeTempJson } from "./helpers.mjs";
import { classifyLayer2EvidenceOrigin, EVIDENCE_ORIGIN, isIndependentlyExecutedHarnessOrigin } from "../src/evidence.mjs";
import { REPLAY_RESULT_GIT_BLOB, RESULT_GIT_BLOB, SYNTHETIC_REPLAY_GIT_BLOB } from "../src/pins.mjs";

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

test("unknown structurally valid harness input keeps its label without execution certification", () => {
  const input = cloneReplay();
  input.generated_at = "2026-09-10T12:34:56Z";
  const path = writeTempJson("unknown-harness.json", input);
  try {
    for (const flag of ["--harness-result", "--replay-result"]) {
      const report = JSON.parse(run([flag, path]).stdout);
      const replay = report.layers[LAYER2_NAME].replay;
      assert.equal(replay.checks.passed, 19);
      assert.equal(replay.evidenceOrigin, flag === "--harness-result"
        ? "separately_labelled_harness_input" : "caller_supplied_unverified_report");
      assert.equal(replay.independentlyExecutedHarnessResult, false);
      assert.equal(replay.independentTipReplay, false);
      assert.equal(replay.executedByThisHelper, false);
      assert.equal(report.evidenceClasses.independently_executed_harness_result, null);
      assert.equal(report.providerNativeVerified.upgradedFromLayer2, false);
      assert.equal(report.mappingCoverage.confirmation, "author_claim_only");
    }
  } finally { rmSync(dirname(path), { recursive: true, force: true }); }
});

test("caller labels preserve known origins and only historical pinned replay origin carries execution credit", () => {
  for (const [blob, expected] of [
    [REPLAY_RESULT_GIT_BLOB, EVIDENCE_ORIGIN.PINNED_WORKER_REPLAY],
    [RESULT_GIT_BLOB, EVIDENCE_ORIGIN.PROVIDED_REPORT],
    [SYNTHETIC_REPLAY_GIT_BLOB, EVIDENCE_ORIGIN.SYNTHETIC],
  ]) {
    assert.equal(classifyLayer2EvidenceOrigin(blob, { separatelyLabelled: true }), expected);
    assert.equal(isIndependentlyExecutedHarnessOrigin(expected), expected === EVIDENCE_ORIGIN.PINNED_WORKER_REPLAY);
  }
  assert.equal(isIndependentlyExecutedHarnessOrigin(EVIDENCE_ORIGIN.SEPARATELY_LABELLED_HARNESS), false);
  assert.equal(isIndependentlyExecutedHarnessOrigin(EVIDENCE_ORIGIN.CALLER_UNVERIFIED), false);
});
