#!/usr/bin/env node
/** One-shot generator for labelled synthetic BasePay shape fixtures. Not a runtime path. */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "fixtures", "basepay");

const CHECK_IDS = [
  "P0", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9",
  "F10", "F11", "F12", "F13", "F14", "F15", "F16", "F16b", "F17",
];

function gitBlobSha(bytes) {
  const buffer = Buffer.from(bytes);
  return createHash("sha1")
    .update(Buffer.from(`blob ${buffer.length}\0`))
    .update(buffer)
    .digest("hex");
}

function sha256(bytes) {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function digestOf(bytes) {
  const buffer = Buffer.from(bytes);
  return { bytes: buffer.length, gitBlobSha: gitBlobSha(buffer), sha256: sha256(buffer) };
}

const TARGET = {
  repository: "LumenFromTheFuture/agentkit",
  upstream_pr: "https://github.com/coinbase/agentkit/pull/1349",
  head_sha: "8380c34b9769cc255ff50d78b4ad2bafdd3de354",
  acceptance_shape: "synthetic lab shape only; not an executed harness result",
};

function syntheticResult({ commit, generated_at, role }) {
  return {
    schema: "basepay-conformance/result",
    schema_version: "1.0.0",
    evidence_label: "synthetic_offline_fixture",
    synthetic: true,
    notice:
      "SameDayDesk synthetic offline fixture. Same structural shape as a basepay-conformance/result 1.0.0 report (schema, 19 check IDs, six limits). Different bytes from LumenFromTheFuture/basepay-conformance. Not upstream JSON, not a license grant, and not an independently executed harness result.",
    fixture: {
      name: "samedaydesk-synthetic-offline-fixture",
      version: "0.1.0",
      repo: "https://github.com/LumenFromTheFuture/basepay-conformance",
      commit,
      role,
    },
    target: TARGET,
    provenance: {
      blob_identities: [],
      substitutions: [],
      note: "Synthetic lab fixture. Provenance blobs are intentionally empty so this file cannot be mistaken for a vendored upstream report.",
    },
    runner: {
      name: "samedaydesk synthetic shape fixture",
      version: "0.1.0",
      node: "v22.23.2",
      platform: "lab",
      offline: true,
      executed: false,
    },
    checks: {
      total: 19,
      passed: 19,
      failed: 0,
      cases: CHECK_IDS.map((id) => ({
        id,
        name: `synthetic ${id} shape row`,
        pass: true,
        detail: `offline lab placeholder for harness check ${id}; not executed`,
      })),
    },
    findings: [
      {
        id: "SYN-1",
        severity: "observation",
        status: "lab-only",
        summary:
          "Synthetic fixture finding. This file is a shape stand-in for offline tests and does not report an executed BasePay harness.",
      },
    ],
    limits: [
      "Synthetic offline fixture only. It is not a live-wallet result and not an independently executed BasePay harness replay.",
      "The 19 check IDs are harness identity labels for loader tests. Pass rows here are synthetic and must not be read as executed PASS.",
      "Six limits are present to match the result shape. They do not become providerNativeVerified or full stateful coverage.",
      "Default composition uses this file without network and without upstream JSON present.",
      "Optional acquire downloads pinned upstream JSON into a gitignored runtime directory and never executes those bytes.",
      "This example does not relicense third-party JSON and does not claim MIT covers upstream reports.",
    ],
    generated_at,
  };
}

const mapping = {
  schema: "lumen.composition-contract.taxonomy-mapping.v1",
  evidence_label: "synthetic_offline_fixture",
  synthetic: true,
  notice:
    "SameDayDesk synthetic offline mapping fixture. Same 4 covered / 1 partial / 2 gap case assignment the loader tests, with original lab rationales. Different bytes from LumenFromTheFuture/basepay-conformance. Not a license grant.",
  generated_at: "2026-09-10T00:00:00.000Z",
  layer1: {
    operator: "SameDayDesk",
    product: "samedaydesk-stateful-wallet-policy-conformance",
    endpoint: "POST /security/stateful-wallet-policy-conformance",
    credential_boundary: "Accepts no credentials, wallet or resource IDs, counter values, signatures, transactions, or raw provider responses",
    taxonomy_reference: "samedaydesk.stateful-wallet-policy-conformance.v1",
  },
  layer2: {
    operator: "SameDayDesk synthetic fixture",
    repo: "https://github.com/LumenFromTheFuture/basepay-conformance",
    tested_target: "shape-only; not independently executed here",
    execution_model: "synthetic offline fixture; no harness execution",
    result_shape: "basepay-conformance/result 1.0.0",
  },
  mapping: [
    {
      samedaydesk_case: "first_within_cap",
      expected: "allow",
      control: null,
      coverage: "covered",
      lumen_cases: ["F1", "F12"],
      rationale: "Synthetic covered row for allow-path binding shape (F1, F12).",
    },
    {
      samedaydesk_case: "sequential_exceeds_cap",
      expected: "deny",
      control: "cumulative_limit",
      coverage: "partial",
      lumen_cases: ["F2", "F10", "F13"],
      rationale: "Synthetic partial row for cumulative-limit shape. Not a verified policy object.",
    },
    {
      samedaydesk_case: "signed_unbroadcast_counts",
      expected: "deny",
      control: "post_sign_accounting",
      coverage: "covered",
      lumen_cases: ["F12", "F14"],
      rationale: "Synthetic covered row for post-sign accounting shape (F12, F14).",
    },
    {
      samedaydesk_case: "unrecognized_calldata",
      expected: "deny",
      control: "extraction_integrity",
      coverage: "gap",
      lumen_cases: [],
      rationale: "Synthetic gap row: no extraction-integrity evidence in this lab fixture.",
    },
    {
      samedaydesk_case: "concurrent_exceeds_cap",
      expected: "deny",
      control: "concurrency",
      coverage: "covered",
      lumen_cases: ["F11"],
      rationale: "Synthetic covered row for concurrency shape (F11).",
    },
    {
      samedaydesk_case: "missing_counter_reference",
      expected: "deny",
      control: "reference_integrity",
      coverage: "covered",
      lumen_cases: ["F3", "F6", "F16b"],
      rationale: "Synthetic covered row for reference-integrity shape (F3, F6, F16b).",
    },
    {
      samedaydesk_case: "application_serialized_concurrent_exceeds_cap",
      expected: "deny",
      control: "application_serialization",
      coverage: "gap",
      lumen_cases: [],
      rationale: "Synthetic gap row: no application-serialization evidence in this lab fixture.",
    },
  ],
  summary: {
    covered: 4,
    partial: 1,
    gap: 2,
    falsifiable_claim:
      "Synthetic 4/1/2 coverage shape for offline loader tests. Not an independently executed confirmation of the upstream mapping.",
  },
  provenance: {
    sources: [
      "samedaydesk synthetic offline fixture",
      "https://github.com/LumenFromTheFuture/basepay-conformance (pinned metadata only; bytes not shipped)",
    ],
    note: "Property-level 4/1/2 shape for tests. Layer 1 is caller-supplied observations. Layer 2 origin is labelled per loaded bytes.",
  },
};

const published = syntheticResult({
  commit: "8a46910ede4830de8481a3ae7f095e120a312d62",
  generated_at: "2026-09-10T00:00:00.000Z",
  role: "synthetic_published_shape",
});
const replay = syntheticResult({
  commit: "94fa65d65c204c02f4af5a9bc9fd27225c688994",
  generated_at: "2026-09-10T00:00:01.000Z",
  role: "synthetic_replay_shape",
});

function writeJson(name, value) {
  const path = join(outDir, name);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, bytes);
  return { path, ...digestOf(bytes) };
}

const publishedDigest = writeJson("synthetic-published-conformance-result.json", published);
const replayDigest = writeJson("synthetic-replay-conformance-result.json", replay);
const mappingDigest = writeJson("synthetic-stateful-taxonomy-mapping.json", mapping);

const UPSTREAM = {
  published: {
    gitBlobSha: "719cca62633f659ce2306b98c3be84652bcd9140",
    sha256: "7575ceb160c6e15992f6950cf2b02cb3736a0d14dd7f3c82a98266d3cd04e11f",
  },
  mapping: {
    gitBlobSha: "b6b288603676f597b208d765876d3efda8939cae",
    sha256: "c2116337fb8972fab75d7e21acecf381d0deeb1b3b6e0b1e98f7538ed1bbe568",
  },
  replay: {
    gitBlobSha: "f455ae744deec6a73f23816d9c5937f3131c5934",
    sha256: "632720dc1a7ec83b0f88296cbca103d83c73e64e7e59206853dc7673fa7efbc3",
  },
};

function assertDifferent(label, got, forbidden) {
  if (got.gitBlobSha === forbidden.gitBlobSha || got.sha256 === forbidden.sha256) {
    throw new Error(`${label} unexpectedly matches upstream digest`);
  }
}

assertDifferent("synthetic published", publishedDigest, UPSTREAM.published);
assertDifferent("synthetic mapping", mappingDigest, UPSTREAM.mapping);
assertDifferent("synthetic replay", replayDigest, UPSTREAM.replay);

console.log(JSON.stringify({ publishedDigest, replayDigest, mappingDigest }, null, 2));
