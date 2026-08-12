import test from "node:test";
import assert from "node:assert/strict";
import {
  WalletPolicyConformanceError,
  WALLET_POLICY_CASES,
  normalizeWalletPolicyConformanceInput,
  walletPolicyConformance,
} from "./wallet-policy-conformance.mjs";

const safe = (caseName, actual, denialClass = actual === "allowed" ? "none" : "policy") => ({
  case: caseName,
  actual,
  denialClass,
  code: actual === "allowed" ? "signed" : "policy_violation",
});

const completeMatrix = () => Object.entries(WALLET_POLICY_CASES)
  .filter(([, definition]) => definition.required)
  .map(([caseName, definition]) => safe(caseName, definition.expected === "allow" ? "allowed" : "denied"));

const base = (observations = completeMatrix()) => ({
  profileId: "privy-solana-lab",
  provider: "Privy",
  network: "solana:mainnet",
  protocol: "x402",
  observations,
});

test("a complete explicit provider-policy matrix is conformant", () => {
  const result = walletPolicyConformance(base());
  assert.equal(result.schemaVersion, "samedaydesk.wallet-policy-conformance.v1");
  assert.equal(result.decision, "conformant");
  assert.equal(result.complete, true);
  assert.equal(result.exactShapePassed, true);
  assert.equal(result.providerNativeVerified.length, 11);
  assert.deepEqual(result.providerNativeUnverified, []);
  assert.deepEqual(result.notEvaluatedByWalletPolicy, ["output_contract", "receipt", "balance_reconciliation"]);
  assert.equal(result.boundary.credentialsAccepted, false);
});

test("an allowed mutation is unsafe even when the rest of the matrix passes", () => {
  const observations = completeMatrix().map((row) =>
    row.case === "duplicate_approved_action" ? safe(row.case, "allowed") : row,
  );
  const result = walletPolicyConformance(base(observations));
  assert.equal(result.decision, "unsafe");
  assert.equal(result.exactShapePassed, false);
  assert.deepEqual(result.unsafeCases, ["duplicate_approved_action"]);
  assert.ok(result.providerNativeUnverified.includes("execution_shape"));
});

test("validation rejection does not receive provider-native credit", () => {
  const observations = completeMatrix().map((row) =>
    row.case === "wrong_chain" ? safe(row.case, "error", "validation") : row,
  );
  const result = walletPolicyConformance(base(observations));
  assert.equal(result.decision, "partial");
  assert.ok(result.inconclusiveCases.includes("wrong_chain"));
  assert.ok(result.providerNativeUnverified.includes("chain"));
  assert.equal(result.results.find((row) => row.case === "wrong_chain").finding, "expected_behavior_not_proven");
});

test("a generic provider denial does not receive policy credit", () => {
  const observations = completeMatrix().map((row) =>
    row.case === "wrong_amount" ? safe(row.case, "denied", "provider") : row,
  );
  const result = walletPolicyConformance(base(observations));
  assert.equal(result.decision, "partial");
  assert.ok(result.inconclusiveCases.includes("wrong_amount"));
  assert.ok(result.providerNativeUnverified.includes("amount"));
});

test("a partial safe matrix reports missing cases without inventing coverage", () => {
  const result = walletPolicyConformance(base([
    safe("intended", "allowed"),
    safe("wrong_operation", "denied"),
  ]));
  assert.equal(result.decision, "partial");
  assert.equal(result.complete, false);
  assert.deepEqual(result.providerNativeVerified, ["operation"]);
  assert.ok(result.missingRequiredCases.includes("duplicate_approved_action"));
});

test("optional shape probes strengthen but cannot replace the required duplicate probe", () => {
  const observations = completeMatrix().filter((row) => row.case !== "duplicate_approved_action");
  observations.push(safe("reordered_approved_actions", "denied"));
  const result = walletPolicyConformance(base(observations));
  assert.equal(result.decision, "partial");
  assert.equal(result.exactShapePassed, false);
  assert.ok(result.missingRequiredCases.includes("duplicate_approved_action"));
});

test("normalization rejects unknown, duplicate, contradictory, and secret-shaped fields", () => {
  assert.throws(
    () => normalizeWalletPolicyConformanceInput({ ...base(), apiKey: "secret" }),
    WalletPolicyConformanceError,
  );
  assert.throws(
    () => normalizeWalletPolicyConformanceInput(base([safe("intended", "allowed"), safe("intended", "allowed")])),
    /duplicate case/,
  );
  assert.throws(
    () => normalizeWalletPolicyConformanceInput(base([{ case: "wrong_amount", actual: "denied", denialClass: "none" }])),
    /explicit denialClass/,
  );
  assert.throws(
    () => normalizeWalletPolicyConformanceInput(base([{ case: "unknown", actual: "denied", denialClass: "policy" }])),
    /unsupported/,
  );
});

test("raw error messages and nested evidence are rejected", () => {
  assert.throws(
    () => normalizeWalletPolicyConformanceInput(base([{
      case: "wrong_amount",
      actual: "denied",
      denialClass: "policy",
      message: "raw provider response",
    }])),
    /unsupported fields/,
  );
  assert.throws(
    () => normalizeWalletPolicyConformanceInput(base([{
      case: "wrong_amount",
      actual: "denied",
      denialClass: "policy",
      code: "contains spaces",
    }])),
    /safe identifier/,
  );
});

