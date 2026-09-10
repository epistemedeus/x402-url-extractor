import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  PRIOR_SCHEMA,
  CORRECTION_SCHEMA,
  assertImmutable,
  attachPrior,
  canonicalPayload,
  correct,
  correctPrior,
  createPrior,
  replay,
  run,
  documentBytes,
  loadPrior,
  sha256Hex,
  writeSequencedPrior,
} from "../../../src/prior.mjs";

const cellRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (...parts) => join(cellRoot, "fixtures", ...parts);

function loadJson(name) {
  return JSON.parse(readFileSync(fixture(name), "utf8"));
}

const CLOCK1 = "2026-09-10T09:54:59.000Z";
const CLOCK2 = "2026-09-10T12:00:00.000Z";

test("createPrior: same packet (key-reordered matching snapshot) yields the same payload hash", () => {
  const a = createPrior(loadJson("packet-seq-1.json"));
  const b = createPrior(loadJson("packet-seq-1.json"));
  const matching = createPrior(loadJson("second-snapshot-matching.json"));
  assert.equal(a.ok, true);
  assert.equal(a.prior.schema, PRIOR_SCHEMA);
  assert.equal(a.prior.immutable, true);
  assert.equal(a.prior.payment.attempted, false);
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.sha256, matching.sha256);
  assert.equal(a.sha256, "63128fd28691fba4d29d286b702b839cd2dee18cde3e5f1c6016044413d19a2b");
  assert.equal(a.prior.clock, CLOCK1);
  assert.equal(matching.prior.clock, CLOCK2);
  assert.equal(a.prior.label, "synthetic");
  assert.equal(a.prior.evidenceClass, "fixture");
});

test("createPrior: retrievedAt is excluded so recapture of the same bytes does not change the hash", () => {
  const packet = loadJson("packet-seq-1.json");
  const first = canonicalPayload(packet);
  packet.provenance[0].retrievedAt = "2099-01-01T00:00:00.000Z";
  packet.limitations = ["changed limitations must not affect prior hash"];
  packet.createdAt = "2099-01-01T00:00:00.000Z";
  const second = canonicalPayload(packet);
  assert.equal(sha256Hex(first), sha256Hex(second));
});

test("createPrior: does not mutate the input packet and freezes the prior", () => {
  const packet = loadJson("packet-seq-1.json");
  const before = JSON.stringify(packet);
  const created = createPrior(packet);
  packet.dependency.newVersion = "9.9.9";
  assert.notEqual(JSON.stringify(packet), before);
  assert.equal(created.prior.payload.dependency.newVersion, "1.1.0");
  assert.throws(() => {
    created.prior.payload.dependency.newVersion = "9.9.9";
  });
  assert.throws(() => {
    created.prior.sha256 = "deadbeef";
  });
});

test("createPrior: refuses to invent a clock", () => {
  const packet = loadJson("packet-seq-1.json");
  delete packet.clock;
  delete packet.createdAt;
  const created = createPrior(packet);
  assert.equal(created.ok, false);
  assert.equal(created.code, "missing_clock");
});

test("createPrior: invalid packet shapes fail closed", () => {
  assert.equal(createPrior(null).code, "invalid_packet");
  assert.equal(createPrior([]).code, "invalid_packet");
  assert.equal(createPrior("packet").code, "invalid_packet");
});

test("checked-in prior.seq-1.json matches createPrior(packet-seq-1) and loads with a verified digest", () => {
  const path = fixture("prior.seq-1.json");
  const loaded = loadPrior(path);
  const created = createPrior(loadJson("packet-seq-1.json"));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.prior.immutable, true);
  assert.equal(loaded.prior.sha256, created.sha256);
  assert.equal(loaded.prior.sequence, 1);
});

test("assertImmutable: path semantics refuse different bytes and allow identical bytes", () => {
  const path = fixture("prior.seq-1.json");
  const before = readFileSync(path);
  const blocked = assertImmutable(path, "tamper");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "prior_immutable");
  assert.equal(Buffer.compare(before, readFileSync(path)), 0);
  const same = assertImmutable(path, before);
  assert.equal(same.ok, true);
  const missing = assertImmutable(join(path, "..", "no-such-prior.json"), "x");
  assert.equal(missing.ok, true);
});

test("assertImmutable: object target verifies digest and refuses a substitute document", () => {
  const created = createPrior(loadJson("packet-seq-1.json"));
  assert.equal(assertImmutable(created.prior).ok, true);
  const blocked = assertImmutable(created.prior, documentBytes({ ...created.prior, sequence: 99 }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "prior_immutable");
  const tampered = JSON.parse(JSON.stringify(created.prior));
  tampered.sha256 = "0".repeat(64);
  const mismatch = assertImmutable(tampered);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "prior_digest_mismatch");
});

test("correctPrior: refuses to invent a clock", () => {
  const old = createPrior(loadJson("packet-seq-1.json")).prior;
  const evidence = loadJson("second-snapshot-matching.json");
  delete evidence.clock;
  delete evidence.createdAt;
  const result = correctPrior(old, evidence);
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing_clock");
});

test("loadPrior: missing path fails closed", () => {
  const loaded = loadPrior(fixture("no-such-prior.json"));
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, "missing_prior");
});

test("correctPrior: matching second snapshot returns and does not produce nextPrior", () => {
  const old = createPrior(loadJson("packet-seq-1.json")).prior;
  const result = correctPrior(old, loadJson("second-snapshot-matching.json"));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "return");
  assert.equal(result.correction.schema, CORRECTION_SCHEMA);
  assert.equal(result.correction.kind, "return");
  assert.equal(result.correction.payload.changedKeys.length, 0);
  assert.equal(result.nextPrior, null);
  assert.equal(result.oldPriorUnchanged, true);
  assert.equal(result.correction.priorRef.sha256, old.sha256);
  assert.equal(result.payment.attempted, false);
});

test("correctPrior: export-change second snapshot updates with sequenced next prior and leaves old bytes intact", () => {
  const old = createPrior(loadJson("packet-seq-1.json")).prior;
  const oldBytes = documentBytes(old);
  const oldSha = old.sha256;
  const result = correctPrior(old, loadJson("second-snapshot-export-change.json"));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "update");
  assert.equal(result.nextPrior.sequence, 2);
  assert.equal(result.nextPrior.parentSha256, oldSha);
  assert.notEqual(result.nextPrior.sha256, oldSha);
  assert.deepEqual(result.correction.payload.changedKeys, ["bindings", "exportDiff", "provenance", "summary"]);
  assert.equal(result.correction.nextPriorRef.sha256, result.nextPrior.sha256);
  assert.equal(Buffer.compare(oldBytes, documentBytes(old)), 0);
  assert.equal(old.sha256, oldSha);
  assert.deepEqual(old.payload.exportDiff.signatureChanged, []);
  assert.deepEqual(result.nextPrior.payload.exportDiff.signatureChanged, ["format"]);
});

test("correctPrior: partial second snapshot is unknown and does not replace the prior", () => {
  const old = createPrior(loadJson("packet-seq-1.json")).prior;
  const result = correctPrior(old, loadJson("second-snapshot-partial.json"));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "unknown");
  assert.equal(result.nextPrior, null);
  assert.ok(result.correction.payload.coverageReasons.includes("provenance[0].coverage=partial"));
  assert.ok(result.correction.payload.coverageReasons.includes("exportDiff.coverage=unknown"));
  assert.ok(result.correction.payload.coverageReasons.some((row) => row.includes("missing_content_sha256")));
});

test("correctPrior: same inputs produce a stable correction hash; clock stays on the envelope", () => {
  const old = createPrior(loadJson("packet-seq-1.json")).prior;
  const evidence = loadJson("second-snapshot-export-change.json");
  const a = correctPrior(old, evidence, { clock: CLOCK2 });
  const b = correctPrior(old, evidence, { clock: CLOCK2 });
  const c = correctPrior(old, evidence, { clock: "2026-09-10T18:00:00.000Z" });
  assert.equal(a.correction.sha256, b.correction.sha256);
  assert.equal(a.correction.sha256, c.correction.sha256);
  assert.equal(a.correction.clock, CLOCK2);
  assert.equal(c.correction.clock, "2026-09-10T18:00:00.000Z");
});

test("correctPrior: does not mutate old prior or the on-disk fixture", () => {
  const path = fixture("prior.seq-1.json");
  const before = readFileSync(path);
  const loaded = loadPrior(path);
  correctPrior(loaded.prior, loadJson("second-snapshot-export-change.json"));
  correctPrior(loaded.prior, loadJson("second-snapshot-partial.json"));
  correctPrior(loaded.prior, loadJson("second-snapshot-matching.json"));
  assert.equal(Buffer.compare(before, readFileSync(path)), 0);
  assert.equal(loaded.prior.sequence, 1);
});

test("correctPrior: conflicting provenance stays unknown", () => {
  const old = createPrior(loadJson("packet-seq-1.json")).prior;
  const evidence = loadJson("second-snapshot-export-change.json");
  evidence.provenance.push({
    path: evidence.provenance[1].path,
    retrievedAt: CLOCK2,
    contentSha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    coverage: "complete",
    label: "synthetic",
  });
  const result = correctPrior(old, evidence);
  assert.equal(result.kind, "unknown");
  assert.equal(result.nextPrior, null);
  assert.ok(result.correction.payload.coverageReasons.some((row) => row.startsWith("provenance_conflict:")));
});

test("writeSequencedPrior: writes seq-N once and refuses overwrite", () => {
  const dir = mkdtempSync(join(tmpdir(), "s127-c08-"));
  const created = createPrior(loadJson("packet-seq-1.json"));
  const written = writeSequencedPrior(dir, created.prior);
  assert.equal(written.ok, true);
  const again = writeSequencedPrior(dir, created.prior);
  assert.equal(again.ok, false);
  assert.equal(again.code, "artifact_exists");
  const loaded = loadPrior(written.path);
  assert.equal(loaded.prior.sha256, created.sha256);
  const updated = correctPrior(created.prior, loadJson("second-snapshot-export-change.json"));
  const seq2 = writeSequencedPrior(dir, updated.nextPrior);
  assert.equal(seq2.ok, true);
  assert.match(seq2.path, /seq-2\.json$/);
  assert.notEqual(seq2.path, written.path);
  rmSync(dir, { recursive: true, force: true });
});

test("CLI ctx run/replay/correct overlay does not mutate the packet and classifies second snapshots", () => {
  const packet = loadJson("packet-seq-1.json");
  const first = run({ command: "analyze", input: { clock: CLOCK1 }, packet });
  assert.equal(first.prior.sha256, "63128fd28691fba4d29d286b702b839cd2dee18cde3e5f1c6016044413d19a2b");
  assert.equal(first.prior.correction, null);
  assert.equal(packet.prior, null);

  const ctx = {
    command: "correct",
    input: { clock: CLOCK2, priorPath: fixture("prior.seq-1.json") },
    packet: loadJson("second-snapshot-matching.json"),
    priorDoc: null,
  };
  const returned = correct(ctx);
  assert.equal(returned.prior.correction.kind, "return");
  assert.equal(returned.prior.nextPrior, null);
  assert.equal(returned.prior.sha256, first.prior.sha256);

  const updated = replay({
    command: "replay",
    input: { clock: CLOCK2, priorPath: fixture("prior.seq-1.json") },
    packet: loadJson("second-snapshot-export-change.json"),
  });
  assert.equal(updated.prior.correction.kind, "update");
  assert.equal(updated.prior.nextPrior.sequence, 2);
  assert.equal(updated.prior.ref.sha256, first.prior.sha256);

  const unknown = attachPrior({
    command: "analyze",
    input: { clock: CLOCK2, priorPath: fixture("prior.seq-1.json") },
    packet: loadJson("second-snapshot-partial.json"),
  });
  assert.equal(unknown.prior.correction.kind, "unknown");
  assert.equal(unknown.prior.nextPrior, null);
});

test("attachPrior: returns a new packet and does not mutate the input", () => {
  const packet = loadJson("packet-seq-1.json");
  const created = createPrior(packet);
  const correction = correctPrior(created.prior, loadJson("second-snapshot-matching.json")).correction;
  const attached = attachPrior(packet, created.prior, correction);
  assert.equal(attached.ok, true);
  assert.equal(packet.prior, null);
  assert.equal(attached.packet.prior.ref.sha256, created.sha256);
  assert.equal(attached.packet.prior.correction.kind, "return");
});

test("synthetic-dep file bytes match provenance contentSha256 (auditable fixture, not live-capture)", () => {
  const fileSha = (name) =>
    createHash("sha256").update(readFileSync(fixture("synthetic-dep", name))).digest("hex");
  const seq1 = loadJson("packet-seq-1.json");
  assert.equal(seq1.provenance[0].contentSha256, fileSha("v1.0.0.js"));
  assert.equal(seq1.provenance[1].contentSha256, fileSha("v1.1.0.js"));
  const changed = loadJson("second-snapshot-export-change.json");
  assert.equal(changed.provenance[1].contentSha256, fileSha("v1.1.0-signature.js"));
  const partial = loadJson("second-snapshot-partial.json");
  assert.equal(partial.provenance[0].contentSha256, undefined);
  assert.equal(fileSha("v1.1.0-partial.js"), "713bdcfb88ce9585412580b6cd13f22fe29974516c971dd7b12e90cd986b18fc");
});

test("fixtures are labeled synthetic/fixture, not live-capture or paid demand", () => {
  const provenance = loadJson("PROVENANCE.json");
  assert.equal(provenance.label, "synthetic");
  assert.equal(provenance.capturedFromLive, false);
  assert.equal(provenance.paidDemand, false);
  for (const name of [
    "packet-seq-1.json",
    "second-snapshot-matching.json",
    "second-snapshot-export-change.json",
    "second-snapshot-partial.json",
  ]) {
    const packet = loadJson(name);
    assert.ok(packet.provenance.every((row) => row.label === "synthetic"));
    assert.equal(packet.caller.evidenceClass, "fixture");
  }
});
