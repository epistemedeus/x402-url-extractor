import assert from "node:assert/strict";
import test from "node:test";

import {
  STATEFUL_WALLET_POLICY_CASES,
  StatefulWalletPolicyConformanceError,
  normalizeStatefulWalletPolicyConformanceInput,
  statefulWalletPolicyConformance,
  statefulWalletPolicyConformanceContract,
  statefulWalletPolicyConformanceInputSchema,
  statefulWalletPolicyConformanceOutputSchema,
} from "./stateful-wallet-policy-conformance.mjs";

const observation = (caseName, actual, enforcementClass = actual === "allowed" ? "none" : "policy") => ({
  case: caseName,
  actual,
  enforcementClass,
  code: actual === "allowed" ? "signed" : "policy_violation",
});
const completeMatrix = () => Object.entries(STATEFUL_WALLET_POLICY_CASES)
  .filter(([, definition]) => definition.required)
  .map(([caseName, definition]) => observation(caseName, definition.expected === "allow" ? "allowed" : "denied"));
const base = (observations = completeMatrix()) => ({
  profileId: "provider-stateful-lab",
  provider: "Example Wallet",
  network: "eip155:8453",
  protocol: "x402",
  observations,
});

test("a complete explicit provider-policy stateful matrix is conformant", () => {
  const result = statefulWalletPolicyConformance(base());
  assert.equal(result.schemaVersion, "samedaydesk.stateful-wallet-policy-conformance.v1");
  assert.equal(result.standardSchemaVersion, "agent-payment-policy.stateful-wallet-policy-observation-report.v1");
  assert.equal(result.decision, "conformant");
  assert.equal(result.strictBudgetPassed, true);
  assert.equal(result.providerNativeVerified.length, 5);
});

test("ABI extraction and concurrent oversubscription remain separate unsafe cases", () => {
  const observations = completeMatrix().map((row) => (
    ["unrecognized_calldata", "concurrent_exceeds_cap"].includes(row.case)
      ? observation(row.case, "allowed")
      : row
  ));
  const result = statefulWalletPolicyConformance(base(observations));
  assert.equal(result.decision, "unsafe");
  assert.deepEqual(result.unsafeCases, ["unrecognized_calldata", "concurrent_exceeds_cap"]);
  assert.deepEqual(result.providerNativeVerified, ["cumulative_limit", "post_sign_accounting", "reference_integrity"]);
});

test("application guard receives separate credit", () => {
  const observations = completeMatrix();
  observations.push(observation("application_serialized_concurrent_exceeds_cap", "denied", "application"));
  const result = statefulWalletPolicyConformance(base(observations));
  assert.deepEqual(result.applicationVerified, ["application_serialization"]);
  assert.ok(!result.providerNativeVerified.includes("application_serialization"));
});

test("normalization rejects secret, raw, duplicate, and contradictory fields", () => {
  assert.throws(() => normalizeStatefulWalletPolicyConformanceInput({ ...base(), apiKey: "secret" }), StatefulWalletPolicyConformanceError);
  assert.throws(() => normalizeStatefulWalletPolicyConformanceInput(base([
    observation("first_within_cap", "allowed"),
    observation("first_within_cap", "allowed"),
  ])), /duplicate case/);
  assert.throws(() => normalizeStatefulWalletPolicyConformanceInput(base([{
    ...observation("sequential_exceeds_cap", "denied"),
    rawCounter: 1,
  }])), /unsupported fields/);
  assert.throws(() => normalizeStatefulWalletPolicyConformanceInput(base([{
    case: "sequential_exceeds_cap",
    actual: "denied",
    enforcementClass: "none",
  }])), /explicit enforcementClass/);
});

test("publishes one canonical free stateful machine contract", () => {
  const contract = statefulWalletPolicyConformanceContract({
    endpoint: "https://agents.samedaydesk.com/security/stateful-wallet-policy-conformance",
    priceAtomicUsdc: "10000",
  });
  assert.equal(contract.standard.version, "0.6.0");
  assert.equal(contract.endpoint.method, "POST");
  assert.deepEqual(contract.endpoint.paymentProtocols, ["x402", "mpp"]);
  assert.equal(contract.cases.length, 7);
  assert.equal(contract.requiredCases.length, 6);
  assert.deepEqual(contract.inputSchema, statefulWalletPolicyConformanceInputSchema());
  assert.deepEqual(contract.outputSchema, statefulWalletPolicyConformanceOutputSchema());
});

test("contract rejects unsafe endpoints, prices, and protocols", () => {
  assert.throws(() => statefulWalletPolicyConformanceContract({ endpoint: "http://example.com/report", priceAtomicUsdc: "10000" }), /HTTPS/);
  assert.throws(() => statefulWalletPolicyConformanceContract({ endpoint: "https://user@example.com/report", priceAtomicUsdc: "10000" }), /credential-free/);
  assert.throws(() => statefulWalletPolicyConformanceContract({ endpoint: "https://example.com/report", priceAtomicUsdc: "0" }), /positive integer/);
  assert.throws(() => statefulWalletPolicyConformanceContract({ endpoint: "https://example.com/report", priceAtomicUsdc: "10000", paymentProtocols: ["other"] }), /x402 or mpp/);
});
