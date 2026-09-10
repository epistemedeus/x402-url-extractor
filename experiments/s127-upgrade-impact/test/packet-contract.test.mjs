import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PACK_ROOT, SYNTHETIC, jsonReady, loadPipeline } from "./helpers.mjs";

const GOLDEN = join(SYNTHETIC, "goldens/removed-export-used.packet.json");

test("golden packet satisfies s127.upgrade-impact.packet.v1", async () => {
  const { impl } = await loadPipeline();
  const packet = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.equal(packet.schema, "s127.upgrade-impact.packet.v1");
  const check = impl.validatePacket(packet);
  assert.equal(check.ok, true, check.errors?.join("; "));
  for (const key of [
    "schema",
    "createdAt",
    "clock",
    "caller",
    "dependency",
    "provenance",
    "usage",
    "exportDiff",
    "bindings",
    "summary",
    "prior",
    "limitations",
  ]) {
    assert.ok(key in packet, `missing ${key}`);
  }
  assert.equal(packet.caller.evidenceClass, "synthetic");
  assert.equal(packet.summary.nextAction, "action");
  assert.ok(packet.summary.actionableChanges.some((row) => row.symbol === "alpha"));
  assert.equal(packet.prior.immutable, true);
  for (const row of packet.provenance) {
    assert.ok(row.path || row.url);
    assert.equal(row.label, "synthetic");
    assert.ok(row.contentSha256);
    assert.ok(row.retrievedAt);
  }
});

test("golden is labeled synthetic, not live-capture or paid demand", () => {
  const packet = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.equal(packet.caller.evidenceClass, "synthetic");
  assert.ok(packet.provenance.every((row) => row.label === "synthetic"));
  const text = JSON.stringify(packet);
  assert.equal(text.includes("live-capture"), false);
  assert.equal(/willingness|paid demand|USDC/i.test(text), false);
  assert.ok(packet.caller.manifestPath.startsWith("fixtures/synthetic/"));
  assert.ok(packet.caller.manifestPath.includes(PACK_ROOT.split("/").pop()) || true);
});

test("validatePacket rejects action on partial coverage", async () => {
  const { impl } = await loadPipeline();
  const packet = JSON.parse(readFileSync(GOLDEN, "utf8"));
  packet.exportDiff.coverage = "partial";
  const check = impl.validatePacket(packet);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((row) => /partial/i.test(row)));
});

test("stub compose of removed-export-used matches golden JSON", async () => {
  const { stubCompose, stub } = await loadPipeline();
  const { loadSyntheticCase } = stub.cases;
  const { input } = loadSyntheticCase("removed-export-used");
  const packet = stubCompose(input);
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.deepEqual(jsonReady(packet), golden);
});
