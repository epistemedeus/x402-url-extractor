import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  HASH_ALGO,
  HASH_SCHEMA,
  PACKET_SCHEMA,
  canonicalJson,
  canonicalPayload,
  compareReplay,
  decisionHash,
  decisionView,
  documentBytes,
  hashPacket,
  hashPacketFile,
  hashPacketText,
  packetHash,
  payloadHash,
  sha256Hex,
  sortKeys,
  stableStringify,
} from "../packet-hash.mjs";
import {
  canonicalPayload as priorCanonicalPayload,
  sha256Hex as priorSha256Hex,
} from "../../../src/prior.mjs";

const cellRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = (...parts) => join(cellRoot, "fixtures", ...parts);

function loadJson(...parts) {
  return JSON.parse(readFileSync(fixtures(...parts), "utf8"));
}

function loadText(...parts) {
  return readFileSync(fixtures(...parts));
}

const expected = loadJson("expected-digests.json");

test("pinned fixture catalog is synthetic, not live-capture", () => {
  assert.equal(expected.label, "synthetic");
  assert.equal(expected.capturedFromLive, false);
  assert.equal(expected.algo, HASH_ALGO);
  const provenance = loadJson("PROVENANCE.json");
  assert.equal(provenance.label, "synthetic");
  assert.equal(provenance.capturedFromLive, false);
  assert.equal(provenance.paidDemand, false);
});

test("key-order unit fixtures: same canonical JSON and sha256, different source bytes", () => {
  const forwardRaw = loadText("key-order", "simple-forward.json");
  const reversedRaw = loadText("key-order", "simple-reversed.json");
  const prettyRaw = loadText("key-order", "simple-pretty.json");
  const forward = JSON.parse(forwardRaw);
  const reversed = JSON.parse(reversedRaw);
  const pretty = JSON.parse(prettyRaw);

  assert.notEqual(forwardRaw.toString("utf8"), reversedRaw.toString("utf8"));
  assert.notEqual(JSON.stringify(forward), JSON.stringify(reversed));
  assert.notEqual(sha256Hex(forwardRaw), sha256Hex(reversedRaw));
  assert.notEqual(sha256Hex(forwardRaw), sha256Hex(prettyRaw));

  assert.equal(canonicalJson(forward), '{"a":1,"b":2,"nested":{"m":8,"z":9}}');
  assert.equal(canonicalJson(reversed), canonicalJson(forward));
  assert.equal(canonicalJson(pretty), canonicalJson(forward));
  assert.equal(sha256Hex(forward), sha256Hex(reversed));
  assert.equal(sha256Hex(forward), sha256Hex(pretty));
  assert.equal(sha256Hex(forward), "a8974cf94dcf1d7ba73135b7046afc2c9e8484d4af94fda719422d0f399b73ea");
});

test("nested object key order is independent; array order is not", () => {
  const nested = loadJson("key-order", "nested-objects.json");
  const nestedReordered = loadJson("key-order", "nested-objects-reordered.json");
  const nestedRaw = loadText("key-order", "nested-objects.json");
  const nestedReorderedRaw = loadText("key-order", "nested-objects-reordered.json");

  assert.notEqual(nestedRaw.toString("utf8"), nestedReorderedRaw.toString("utf8"));
  assert.equal(canonicalJson(nested), canonicalJson(nestedReordered));
  assert.equal(sha256Hex(nested), sha256Hex(nestedReordered));

  const a = loadJson("key-order", "array-order-a.json");
  const b = loadJson("key-order", "array-order-b.json");
  assert.equal(canonicalJson(a.k), canonicalJson(b.k));
  assert.notEqual(canonicalJson(a), canonicalJson(b));
  assert.notEqual(sha256Hex(a), sha256Hex(b));
});

test("__proto__ is hashed as a key, not a prototype mutation", () => {
  const a = loadJson("key-order", "proto-keys.json");
  const b = loadJson("key-order", "proto-keys-reordered.json");
  assert.equal(Object.prototype.x, undefined);
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.ok(canonicalJson(a).includes('"__proto__"'));
  assert.equal(sha256Hex(a), sha256Hex(b));
  const sorted = sortKeys(a);
  assert.equal(Object.getPrototypeOf(sorted), Object.prototype);
  assert.equal(sorted.x, undefined);
});

test("each packet family: reordered and pretty files share packet/payload/decision hashes", () => {
  for (const [id, family] of Object.entries(expected.families)) {
    const base = hashPacketFile(fixtures(family.base));
    const reordered = hashPacketFile(fixtures(family.reordered));
    const pretty = hashPacketFile(fixtures(family.pretty));
    assert.equal(base.ok, true, id);
    assert.equal(base.packetSchema, PACKET_SCHEMA);
    assert.equal(base.schema, HASH_SCHEMA);
    assert.equal(base.label, "synthetic");
    assert.equal(base.evidenceClass, "fixture");
    assert.notEqual(base.sourceSha256, reordered.sourceSha256, `${id} source bytes must differ`);
    assert.notEqual(base.sourceSha256, pretty.sourceSha256, `${id} pretty source bytes must differ`);
    assert.equal(base.packetHash, reordered.packetHash, `${id} packetHash key-order`);
    assert.equal(base.packetHash, pretty.packetHash, `${id} packetHash whitespace`);
    assert.equal(base.payloadHash, reordered.payloadHash, `${id} payloadHash key-order`);
    assert.equal(base.decisionHash, reordered.decisionHash, `${id} decisionHash key-order`);
    assert.match(base.packetHash, /^[0-9a-f]{64}$/);
    assert.match(base.payloadHash, /^[0-9a-f]{64}$/);
    assert.match(base.decisionHash, /^[0-9a-f]{64}$/);
  }
});

test("pinned expected-digests match recomputed hashes", () => {
  for (const row of expected.packets) {
    const hashed = hashPacketFile(fixtures(row.file));
    assert.equal(hashed.ok, true, row.file);
    assert.equal(hashed.packetHash, row.packetHash, `${row.file} packetHash`);
    assert.equal(hashed.payloadHash, row.payloadHash, `${row.file} payloadHash`);
    assert.equal(hashed.decisionHash, row.decisionHash, `${row.file} decisionHash`);
    assert.equal(hashed.sourceSha256, row.sourceSha256, `${row.file} sourceSha256`);
    assert.equal(hashed.nextAction, row.nextAction, `${row.file} nextAction`);
  }
  for (const row of expected.keyOrder) {
    const raw = loadText(row.file);
    const parsed = JSON.parse(raw.toString("utf8"));
    assert.equal(canonicalJson(parsed), row.canonicalJson, row.file);
    assert.equal(sha256Hex(parsed), row.sha256, row.file);
    assert.equal(sha256Hex(raw), row.sourceSha256, `${row.file} source`);
  }
});

test("clock/retrievedAt recapture: packet hash changes, payload and decision do not", () => {
  const base = hashPacketFile(fixtures("packets", "action-used-removed.json"));
  const later = hashPacketFile(fixtures("packets", "action-used-removed.clock-diff.json"));
  assert.notEqual(base.packetHash, later.packetHash);
  assert.equal(base.payloadHash, later.payloadHash);
  assert.equal(base.decisionHash, later.decisionHash);
  const cmp = compareReplay(
    loadJson("packets", "action-used-removed.json"),
    loadJson("packets", "action-used-removed.clock-diff.json"),
  );
  assert.equal(cmp.identicalPacket, false);
  assert.equal(cmp.identicalPayload, true);
  assert.equal(cmp.identicalDecision, true);
});

test("binding array order and rationale wording do not change decision identity", () => {
  const base = loadJson("packets", "action-used-removed.json");
  const bindings = loadJson("packets", "action-used-removed.bindings-reordered.json");
  const rationale = loadJson("packets", "action-used-removed.rationale-diff.json");
  assert.equal(decisionHash(base), decisionHash(bindings));
  assert.equal(decisionHash(base), decisionHash(rationale));
  assert.notEqual(packetHash(base), packetHash(bindings));
  assert.notEqual(payloadHash(base), payloadHash(bindings));
  assert.notEqual(packetHash(base), packetHash(rationale));
  assert.notEqual(payloadHash(base), payloadHash(rationale));
  const view = decisionView(bindings);
  assert.deepEqual(
    view.bindings.map((row) => row.symbol),
    ["compat", "parse"],
  );
  assert.equal(view.summary.nextAction, "action");
});

test("array order in exportDiff changes packet and payload hashes", () => {
  const base = loadJson("packets", "action-used-removed.json");
  const changed = loadJson("packets", "action-used-removed.array-order-changed.json");
  assert.notEqual(packetHash(base), packetHash(changed));
  assert.notEqual(payloadHash(base), payloadHash(changed));
  assert.equal(decisionHash(base), decisionHash(changed));
});

test("distinct decisions produce distinct decision hashes", () => {
  const action = decisionHash(loadJson("packets", "action-used-removed.json"));
  const unused = decisionHash(loadJson("packets", "no-action-unused.json"));
  const unknown = decisionHash(loadJson("packets", "unknown-dynamic.json"));
  const noop = decisionHash(loadJson("packets", "same-version-noop.json"));
  const hashes = new Set([action, unused, unknown, noop]);
  assert.equal(hashes.size, 4);
  assert.equal(hashPacket(loadJson("packets", "action-used-removed.json")).nextAction, "action");
  assert.equal(hashPacket(loadJson("packets", "no-action-unused.json")).nextAction, "no_action");
  assert.equal(hashPacket(loadJson("packets", "unknown-dynamic.json")).nextAction, "unknown");
  assert.equal(hashPacket(loadJson("packets", "same-version-noop.json")).nextAction, "no_action");
});

test("payload hash ignores envelope fields that prior.mjs also ignores", () => {
  const packet = loadJson("packets", "action-used-removed.json");
  const first = canonicalPayload(packet);
  packet.clock = "2099-01-01T00:00:00.000Z";
  packet.createdAt = "2099-01-01T00:00:00.000Z";
  packet.limitations = ["changed envelope"];
  packet.prior = { sha256: "deadbeef" };
  packet.provenance[0].retrievedAt = "2099-01-01T00:00:00.000Z";
  const second = canonicalPayload(packet);
  assert.equal(sha256Hex(first), sha256Hex(second));
  assert.equal("retrievedAt" in second.provenance[0], false);
  assert.equal(second.provenance[0].locator, packet.provenance[0].path);
});

test("payloadHash matches src/prior.mjs canonicalPayload (c08 replay identity)", () => {
  const packet = loadJson("packets", "action-used-removed.json");
  assert.equal(payloadHash(packet), priorSha256Hex(priorCanonicalPayload(packet)));

  const c08Path = join(cellRoot, "..", "c08-prior-correct", "fixtures", "packet-seq-1.json");
  if (!existsSync(c08Path)) return;
  const c08 = JSON.parse(readFileSync(c08Path, "utf8"));
  assert.equal(payloadHash(c08), priorSha256Hex(priorCanonicalPayload(c08)));
  assert.equal(payloadHash(c08), "63128fd28691fba4d29d286b702b839cd2dee18cde3e5f1c6016044413d19a2b");
});

test("hashPacketText parses whitespace; hashPacket rejects non-objects", () => {
  const pretty = loadText("packets", "action-used-removed.pretty.json").toString("utf8");
  const min = loadText("packets", "action-used-removed.json").toString("utf8");
  const fromPretty = hashPacketText(pretty);
  const fromMin = hashPacketText(min);
  assert.equal(fromPretty.ok, true);
  assert.equal(fromPretty.packetHash, fromMin.packetHash);
  assert.equal(hashPacket(null).ok, false);
  assert.equal(hashPacket(null).code, "invalid_packet");
  assert.equal(hashPacketText("{").ok, false);
  assert.equal(hashPacketText("{").code, "invalid_json");
});

test("unhashable values fail closed", () => {
  assert.throws(() => stableStringify({ a: 1n }), /bigint/);
  assert.throws(() => stableStringify({ a: () => {} }), /function/);
  assert.throws(() => stableStringify({ a: Number.NaN }), /non-finite/);
  assert.throws(() => stableStringify(new Date("2026-09-10T09:54:59.000Z")), /non-plain/);
  const circular = { a: 1 };
  circular.self = circular;
  assert.throws(() => stableStringify(circular));
  const hashed = hashPacket({ schema: PACKET_SCHEMA, boom: 1n });
  assert.equal(hashed.ok, false);
  assert.equal(hashed.code, "unhashable");
});

test("integer-like keys follow JSON.stringify numeric enumeration (not RFC 8785)", () => {
  // Limitation: JSON.stringify emits integer-like keys in numeric order.
  // Packet contract fields are not integer-like; replay of packets is unaffected.
  assert.equal(canonicalJson({ 10: 1, 2: 2, a: 3 }), '{"2":2,"10":1,"a":3}');
});

test("documentBytes is canonical JSON plus newline and is not the digest input", () => {
  const value = { b: 1, a: 2 };
  const digest = sha256Hex(value);
  assert.equal(digest, sha256Hex('{"a":2,"b":1}'));
  assert.notEqual(digest, sha256Hex(documentBytes(value)));
  assert.equal(documentBytes(value).toString("utf8"), '{"a":2,"b":1}\n');
});

test("synthetic-dep contentSha256 in packets matches file bytes", () => {
  for (const [rel, sha] of Object.entries(expected.syntheticContentSha256)) {
    assert.equal(sha256Hex(readFileSync(fixtures(rel))), sha, rel);
  }
  const packet = loadJson("packets", "action-used-removed.json");
  assert.equal(packet.provenance[0].label, "synthetic");
  assert.equal(packet.caller.evidenceClass, "fixture");
  assert.equal(packet.provenance[0].contentSha256, expected.syntheticContentSha256["synthetic-dep/v1.0.0.js"]);
});
