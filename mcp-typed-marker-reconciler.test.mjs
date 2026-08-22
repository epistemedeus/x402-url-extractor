import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  MCP_TYPED_MARKER_RECONCILIATION_SCHEMA,
  digestMcpTypedValidationMarker,
  reconcileMcpTypedMarker,
  reconcileMcpTypedMarkerRecords,
} from "./mcp-typed-marker-reconciler.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "mcp-typed-marker-reconciler.mjs");
const MARKER = "release-canary-amendment7-20260822";
const INTERNAL_TOKEN = "internal-token-for-attribution-review-0001";
const OFFER_DIGEST = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ATTRIBUTION_SCHEMA = "samedaydesk.mcp-request-attribution.v1";

function expectedMarkerDigest(marker) {
  return createHash("sha256")
    .update("samedaydesk.mcp-request-attribution-marker.v1\0")
    .update(marker)
    .digest("hex");
}

function canonicalRow(overrides = {}) {
  return {
    v: 4,
    sourceContract: "mcp_typed_outcome",
    id: randomUUID(),
    ts: "2026-08-22T00:00:00.000Z",
    authority: "seller_declared",
    evidenceClass: "seller_operational",
    accounting: false,
    revenue: false,
    demand: false,
    independentUse: false,
    chainTruth: false,
    payerIdentity: false,
    action: "emit",
    result: "challenge",
    reason: "typed_payment_required",
    paymentPresent: false,
    paymentCredentialParsed: false,
    handlerInvoked: false,
    applicationOutcome: "not_run",
    settlementState: "not_attempted",
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: OFFER_DIGEST,
    },
    requestAttribution: {
      schemaVersion: ATTRIBUTION_SCHEMA,
      classification: "validation",
      evidence: "internal_token",
      markerDigest: expectedMarkerDigest(MARKER),
    },
    ...overrides,
  };
}

function legacyTypedRow() {
  const { requestAttribution, ...rest } = canonicalRow();
  return rest;
}

function jsonl(...records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function assertRejected(run, reason, message) {
  assert.throws(run, (error) => error instanceof Error && error.reason === reason, message);
}

test("derives the repository's domain-separated release-canary digest exactly", () => {
  const digest = digestMcpTypedValidationMarker(MARKER);
  assert.equal(digest, expectedMarkerDigest(MARKER));
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("rejects markers outside the repository's marker grammar", () => {
  assert.equal(digestMcpTypedValidationMarker("short-marker"), null);
  assert.equal(digestMcpTypedValidationMarker("has spaces and is long enough for pattern"), null);
  assert.equal(digestMcpTypedValidationMarker("a".repeat(129)), null);
  assert.equal(digestMcpTypedValidationMarker(null), null);
  assert.equal(digestMcpTypedValidationMarker(12345), null);
});

test("reconciles exactly one canonical attributed validation row without disclosing the marker", () => {
  const result = reconcileMcpTypedMarker({ marker: MARKER, events: jsonl(canonicalRow()) });
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, MCP_TYPED_MARKER_RECONCILIATION_SCHEMA);
  assert.equal(result.sourceContract, "mcp_typed_outcome");
  assert.equal(result.markerDigest, expectedMarkerDigest(MARKER));
  assert.equal(result.matchedRows, 1);
  assert.equal(result.row.result, "challenge");
  assert.equal(result.row.binding.tool, "enrich");
  assert.equal(Object.hasOwn(result.row.binding, "issuedOfferDigest"), false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(MARKER), false);
  assert.equal(serialized.includes(INTERNAL_TOKEN), false);
});

test("skips well-formed unrelated rows (legacy typed rows and other markers) in a mixed ledger", () => {
  const otherMarkerRow = canonicalRow({
    id: randomUUID(),
    requestAttribution: {
      schemaVersion: ATTRIBUTION_SCHEMA,
      classification: "validation",
      evidence: "internal_token",
      markerDigest: expectedMarkerDigest("release-canary-amendment8-20260822"),
    },
  });
  const result = reconcileMcpTypedMarker({
    marker: MARKER,
    events: jsonl(legacyTypedRow(), otherMarkerRow, canonicalRow({ id: randomUUID() })),
  });
  assert.equal(result.ok, true);
  assert.equal(result.matchedRows, 1);
});

test("rejects zero matches and empty input", () => {
  assertRejected(
    () => reconcileMcpTypedMarker({ marker: MARKER, events: jsonl(legacyTypedRow()) }),
    "no_matching_row",
  );
  assertRejected(() => reconcileMcpTypedMarker({ marker: MARKER, events: "" }), "empty_input");
  assertRejected(() => reconcileMcpTypedMarker({ marker: MARKER, events: "\n\n" }), "empty_input");
});

test("rejects a duplicate row carrying the same matching digest", () => {
  const events = jsonl(canonicalRow(), canonicalRow({ id: randomUUID() }));
  assertRejected(
    () => reconcileMcpTypedMarker({ marker: MARKER, events }),
    "duplicate_matching_rows",
  );
});

test("rejects forged authority booleans claiming accounting, revenue, demand, independent use, chain truth, or payer identity", () => {
  const flags = [
    "accounting",
    "revenue",
    "demand",
    "independentUse",
    "chainTruth",
    "payerIdentity",
  ];
  for (const flag of flags) {
    const events = jsonl(canonicalRow({ [flag]: true }));
    assertRejected(
      () => reconcileMcpTypedMarker({ marker: MARKER, events }),
      "non_canonical_typed_row",
      `flag ${flag}`,
    );
  }
});

test("rejects authority and evidence-class promotion", () => {
  for (const overrides of [
    { authority: "chain_truth" },
    { authority: "attested" },
    { evidenceClass: "chain_verified" },
    { evidenceClass: "independent" },
  ]) {
    assertRejected(
      () => reconcileMcpTypedMarker({ marker: MARKER, events: jsonl(canonicalRow(overrides)) }),
      "non_canonical_typed_row",
    );
  }
});

test("rejects unsupported source generations claiming the digest", () => {
  for (const overrides of [
    { v: 5 },
    { v: 3 },
    { sourceContract: "mcp_typed_outcome_v2" },
    { sourceContract: "commerce_event" },
  ]) {
    assertRejected(
      () => reconcileMcpTypedMarker({ marker: MARKER, events: jsonl(canonicalRow(overrides)) }),
      "unsupported_source_generation",
    );
  }
});

test("rejects malformed and corrupt JSONL input", () => {
  const broken = `${JSON.stringify(canonicalRow())}\nnot-json-at-all{{{\n`;
  assertRejected(
    () => reconcileMcpTypedMarker({ marker: MARKER, events: broken }),
    "malformed_jsonl",
  );
  assertRejected(
    () => reconcileMcpTypedMarker({ marker: MARKER, events: "[1,2,3]\n" }),
    "malformed_jsonl",
  );
  assertRejected(
    () => reconcileMcpTypedMarker({ marker: MARKER, events: '"just a string"\n' }),
    "malformed_jsonl",
  );
  assertRejected(
    () => reconcileMcpTypedMarker({ marker: MARKER, events: "null\n" }),
    "malformed_jsonl",
  );
});

test("rejects corrupt request attributions including attested proof-carrying variants", () => {
  const base = canonicalRow();
  const cases = [
    { ...base.requestAttribution, proof: "f".repeat(64) },
    { ...base.requestAttribution, schemaVersion: "samedaydesk.mcp-request-attribution.v2" },
    { ...base.requestAttribution, classification: "reconciliation" },
    { ...base.requestAttribution, evidence: "session" },
    { ...base.requestAttribution, markerDigest: "ZZZZ" },
    { ...base.requestAttribution, markerDigest: expectedMarkerDigest(MARKER).slice(0, 63) },
  ];
  for (const requestAttribution of cases) {
    assertRejected(
      () => reconcileMcpTypedMarker({
        marker: MARKER,
        events: jsonl({ ...base, requestAttribution }),
      }),
      "invalid_request_attribution",
    );
  }
});

test("rejects tampered decision cross-fields and unknown tool bindings", () => {
  assertRejected(
    () => reconcileMcpTypedMarker({
      marker: MARKER,
      events: jsonl(canonicalRow({ settlementState: "succeeded" })),
    }),
    "non_canonical_typed_row",
  );
  assertRejected(
    () => reconcileMcpTypedMarker({
      marker: MARKER,
      events: jsonl(canonicalRow({
        binding: {
          tool: "not_a_closed_tool",
          productSku: "samedaydesk-not-a-closed-tool",
          resource: "mcp://tool/not_a_closed_tool",
          issuedOfferDigest: OFFER_DIGEST,
        },
      })),
    }),
    "non_canonical_typed_row",
  );
});

test("rejects unrecognized ledger records instead of silently ignoring them", () => {
  assertRejected(
    () => reconcileMcpTypedMarker({ marker: MARKER, events: jsonl({ hello: "world" }) }),
    "unrecognized_ledger_record",
  );
});

test("handles prototype-hostile in-memory inputs without crashing or matching", () => {
  // Null-prototype row (what JSON.parse produces) still reconciles.
  const flat = JSON.parse(jsonl(canonicalRow()));
  const nullProto = Object.create(null);
  for (const [key, value] of Object.entries(flat)) {
    nullProto[key] = typeof value === "object" && value !== null
      ? Object.assign(Object.create(null), value)
      : value;
  }
  const result = reconcileMcpTypedMarkerRecords([nullProto], expectedMarkerDigest(MARKER));
  assert.equal(result.ok, true);
  assert.equal(result.matchedRows, 1);

  // A record whose requestAttribution getter throws is rejected cleanly.
  const hostile = canonicalRow();
  Object.defineProperty(hostile, "requestAttribution", {
    enumerable: true,
    get() {
      throw new Error("getter bomb");
    },
  });
  assertRejected(
    () => reconcileMcpTypedMarkerRecords([hostile], expectedMarkerDigest(MARKER)),
    "hostile_input",
  );

  // Prototype pollution must not turn unattributed rows into candidates.
  const pollution = { markerDigest: expectedMarkerDigest(MARKER) };
  Object.prototype.requestAttribution = pollution;
  try {
    assertRejected(
      () => reconcileMcpTypedMarkerRecords([legacyTypedRow()], expectedMarkerDigest(MARKER)),
      "no_matching_row",
    );
  } finally {
    delete Object.prototype.requestAttribution;
  }
  assert.equal(Object.hasOwn(Object.prototype, "requestAttribution"), false);
});

test("enforces bounded input limits", () => {
  const tinyLines = { maxInputBytes: 1024 * 1024, maxLineBytes: 32, maxRecords: 4 };
  assertRejected(
    () => reconcileMcpTypedMarker({ marker: MARKER, events: jsonl(canonicalRow()), limits: tinyLines }),
    "line_too_large",
  );
  const tiny = { maxInputBytes: 64, maxLineBytes: 32, maxRecords: 4 };
  const fewAllowed = { maxInputBytes: 1024 * 1024, maxLineBytes: 1024 * 1024, maxRecords: 4 };
  const many = Array.from({ length: 6 }, () => JSON.stringify(legacyTypedRow())).join("\n");
  assertRejected(
    () => reconcileMcpTypedMarker({ marker: MARKER, events: many, limits: fewAllowed }),
    "too_many_records",
  );
  assertRejected(
    () => reconcileMcpTypedMarker({
      marker: MARKER,
      events: "x".repeat(65),
      limits: tiny,
    }),
    "input_too_large",
  );
});

test("CLI reconciles via stdin and never emits the raw marker or internal token", () => {
  const run = spawnSync(process.execPath, [TOOL, "--marker", MARKER], {
    input: jsonl(canonicalRow()),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.matchedRows, 1);
  assert.equal(payload.markerDigest, expectedMarkerDigest(MARKER));
  const combined = `${run.stdout}${run.stderr}`;
  assert.equal(combined.includes(MARKER), false);
  assert.equal(combined.includes(INTERNAL_TOKEN), false);
});

test("CLI rejects hostile ledgers with a reason code only, exit code 1", () => {
  const run = spawnSync(process.execPath, [TOOL, "--marker", MARKER], {
    input: jsonl(canonicalRow(), canonicalRow({ id: randomUUID() })),
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  const payload = JSON.parse(run.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.reason, "duplicate_matching_rows");
  assert.equal(run.stdout, "");
  const combined = `${run.stdout}${run.stderr}`;
  assert.equal(combined.includes(MARKER), false);
});

test("CLI reports invalid markers and usage errors without echoing arguments", () => {
  const shortMarkerRun = spawnSync(
    process.execPath,
    [TOOL, "--marker", "tiny-marker-xyz"],
    { input: jsonl(canonicalRow()), encoding: "utf8" },
  );
  assert.equal(shortMarkerRun.status, 1);
  assert.match(JSON.parse(shortMarkerRun.stderr).reason, /^invalid_marker$/);

  const noMarkerRun = spawnSync(process.execPath, [TOOL], {
    input: jsonl(canonicalRow()),
    encoding: "utf8",
  });
  assert.equal(noMarkerRun.status, 2);
  assert.equal(JSON.parse(noMarkerRun.stderr).reason, "usage_error");

  const badArgRun = spawnSync(process.execPath, [TOOL, "--marker", MARKER, "--evil=1"], {
    input: jsonl(canonicalRow()),
    encoding: "utf8",
  });
  assert.equal(badArgRun.status, 2);

  const duplicateMarkerRun = spawnSync(
    process.execPath,
    [TOOL, "--marker", MARKER, "--marker=release-canary-duplicate-20260822"],
    { input: jsonl(canonicalRow()), encoding: "utf8" },
  );
  assert.equal(duplicateMarkerRun.status, 2);
  assert.equal(JSON.parse(duplicateMarkerRun.stderr).reason, "usage_error");
});
