/** Immutable S89 pins. Treat as assertions; layer-2 still verifies file bytes and check IDs. */

export const COMMENT = Object.freeze({
  url: "https://github.com/MetaMask/agent-skills/issues/17#issuecomment-5611527986",
  id: 5611527986,
  created_at: "2026-09-10T01:59:54Z",
  author: "LumenFromTheFuture",
});

export const BASEPAY_REPO = "https://github.com/LumenFromTheFuture/basepay-conformance";
export const BASEPAY_TIP_COMMIT = "94fa65d65c204c02f4af5a9bc9fd27225c688994";
export const PUBLISHED_RESULT_FIXTURE_COMMIT = "8a46910ede4830de8481a3ae7f095e120a312d62";
export const RESULT_PATH = "reports/conformance-result.json";
export const MAPPING_PATH = "reports/stateful-taxonomy-mapping-2026-09-05.json";
export const RESULT_GIT_BLOB = "719cca62633f659ce2306b98c3be84652bcd9140";
export const MAPPING_GIT_BLOB = "b6b288603676f597b208d765876d3efda8939cae";
export const REPLAY_RESULT_GIT_BLOB = "f455ae744deec6a73f23816d9c5937f3131c5934";

export const RESULT_SHA256 = "7575ceb160c6e15992f6950cf2b02cb3736a0d14dd7f3c82a98266d3cd04e11f";
export const MAPPING_SHA256 = "c2116337fb8972fab75d7e21acecf381d0deeb1b3b6e0b1e98f7538ed1bbe568";
export const REPLAY_RESULT_SHA256 = "632720dc1a7ec83b0f88296cbca103d83c73e64e7e59206853dc7673fa7efbc3";

export const OFFICIAL_COMMAND = "npm run conformance";
export const RESULT_SCHEMA = "basepay-conformance/result";
export const RESULT_SCHEMA_VERSION = "1.0.0";

export const TARGET_REPOSITORY = "LumenFromTheFuture/agentkit";
export const TARGET_HEAD_SHA = "8380c34b9769cc255ff50d78b4ad2bafdd3de354";
export const TARGET_UPSTREAM_PR = "https://github.com/coinbase/agentkit/pull/1349";

export const MERCHANT_REPO = "https://github.com/epistemedeus/x402-url-extractor";
export const MERCHANT_PIN = "4910f83bd2be1e38667f1a3cfa23c70fcff6b0c1";
export const MERCHANT_BRANCH = "codex/s89-basepay-composition-20260910";
export const MERCHANT_PRODUCT = "samedaydesk-stateful-wallet-policy-conformance";
export const MERCHANT_SCHEMA = "samedaydesk.stateful-wallet-policy-conformance.v1";
export const MERCHANT_ENDPOINT = "POST /security/stateful-wallet-policy-conformance";
export const STANDARD_PACKAGE = "agent-payment-policy";
export const STANDARD_VERSION = "0.12.0";

export const COVERAGE_AUTHOR_CLAIM = Object.freeze({
  covered: 4,
  partial: 1,
  gap: 2,
});

export const MERCHANT_CASE_NAMES = Object.freeze([
  "first_within_cap",
  "sequential_exceeds_cap",
  "signed_unbroadcast_counts",
  "unrecognized_calldata",
  "concurrent_exceeds_cap",
  "missing_counter_reference",
  "application_serialized_concurrent_exceeds_cap",
]);

export const EXPECTED_MAPPING_COVERAGE = Object.freeze({
  covered: Object.freeze([
    "first_within_cap",
    "signed_unbroadcast_counts",
    "concurrent_exceeds_cap",
    "missing_counter_reference",
  ]),
  partial: Object.freeze(["sequential_exceeds_cap"]),
  gap: Object.freeze([
    "unrecognized_calldata",
    "application_serialized_concurrent_exceeds_cap",
  ]),
});

export const REPLAY = Object.freeze({
  commit: BASEPAY_TIP_COMMIT,
  command: OFFICIAL_COMMAND,
  checksPassed: 19,
  checksTotal: 19,
  log: "/tmp/s89-replay-run2.txt",
  node: "v22.14.0",
});
