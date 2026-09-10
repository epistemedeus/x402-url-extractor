import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SYNTHETIC, loadPipeline } from "./helpers.mjs";

test("loadPrior reads the synthetic immutable prior", async () => {
  const { impl } = await loadPipeline();
  const loaded = impl.loadPrior(join(SYNTHETIC, "priors/removed-export-used.seq-1.json"));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.prior.immutable, true);
  assert.equal(loaded.prior.sequence, 1);
  assert.equal(loaded.prior.payload.dependency.name, "demo-widget");
  assert.equal(loaded.prior.schema, "s127.upgrade-impact.prior.v1");
});

test("assertImmutable refuses a different payload at the same path", async () => {
  const { impl } = await loadPipeline();
  const path = join(SYNTHETIC, "priors/removed-export-used.seq-1.json");
  const blocked = impl.assertImmutable(path, "tamper");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "prior_immutable");
  const same = impl.assertImmutable(path, readFileSync(path));
  assert.equal(same.ok, true);
});

test("writeSequencedArtifact does not overwrite seq-1", async () => {
  const { impl } = await loadPipeline();
  const dir = mkdtempSync(join(tmpdir(), "s127-prior-"));
  try {
    const first = impl.writeSequencedArtifact(dir, "demo", 1, { hello: "world" });
    assert.equal(first.ok, true);
    const second = impl.writeSequencedArtifact(dir, "demo", 1, { hello: "other" });
    assert.equal(second.ok, false);
    assert.equal(second.code, "artifact_exists");
    const seq2 = impl.writeSequencedArtifact(dir, "demo", 2, { hello: "next" });
    assert.equal(seq2.ok, true);
    assert.notEqual(seq2.path, first.path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyCorrection writes a new sequence pointer and keeps prior immutable", async () => {
  const { impl } = await loadPipeline();
  const packet = {
    prior: { ref: "priors/removed-export-used.seq-1.json", sequence: 1, immutable: true, correction: null },
  };
  const next = impl.applyCorrection(packet, { reason: "operator_notes" });
  assert.equal(next.prior.immutable, true);
  assert.equal(next.prior.correction.sequence, 2);
  assert.equal(next.prior.correction.replacesRef, "priors/removed-export-used.seq-1.json");
  assert.equal(packet.prior.correction, null);
});
