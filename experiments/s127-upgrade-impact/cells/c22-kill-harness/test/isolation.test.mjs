import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { runIsolationSelfCheck } from "../isolation-self-check.mjs";
import { CELL_ROOT, FORBIDDEN_WRITE_ROOTS, assertWritableOut, isInsideRoot } from "../lib/paths.mjs";

test("isolation self-check reports ok and jail probes pass", () => {
  const report = runIsolationSelfCheck();
  assert.equal(report.ok, true, JSON.stringify(report.jailTests, null, 2));
  assert.equal(report.cellId, "c22-kill-harness");
  assert.equal(report.payment.attempted, false);
  assert.equal(report.escapedWrites.length, 0);
  assert.ok(report.ownedFileCount > 0);
});

test("assertWritableOut allows cell paths and refuses pack src", () => {
  const ok = assertWritableOut(join(CELL_ROOT, "fixtures/out/ok.json"));
  assert.equal(ok.ok, true);
  assert.equal(ok.zone, "cell");
  const src = assertWritableOut(join(CELL_ROOT, "../../src/from-c22.mjs"));
  assert.equal(src.ok, false);
  assert.equal(src.code, "forbidden_write_root");
});

test("forbidden write roots include S124/S125 and real A/B trees", () => {
  const asText = FORBIDDEN_WRITE_ROOTS.join("\n");
  assert.match(asText, /s124-marketplace/);
  assert.match(asText, /s125-pulse/);
  assert.match(asText, /c11-real-a/);
  assert.match(asText, /c12-real-b/);
  assert.match(asText, /fixtures\/real-a/);
  assert.match(asText, /fixtures\/real-b/);
});

test("isInsideRoot does not treat prefix-siblings as inside", () => {
  assert.equal(isInsideRoot(CELL_ROOT, join(CELL_ROOT, "lib/compare.mjs")), true);
  assert.equal(isInsideRoot(CELL_ROOT, join(CELL_ROOT, "../c21-golden-e2e/x.json")), false);
});
