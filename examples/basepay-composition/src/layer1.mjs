import {
  STATEFUL_WALLET_POLICY_CASE_NAMES,
  STATEFUL_WALLET_POLICY_CASES,
  StatefulWalletPolicyConformanceError,
  statefulWalletPolicyConformance,
} from "../../../stateful-wallet-policy-conformance.mjs";

import { fail } from "./errors.mjs";
import { LAYER1_NAME, LAYER1_TITLE } from "./layers.mjs";
import {
  MERCHANT_ENDPOINT,
  MERCHANT_PRODUCT,
  MERCHANT_SCHEMA,
  STANDARD_PACKAGE,
  STANDARD_VERSION,
} from "./pins.mjs";

export const LAYER1_AUTHORITY = Object.freeze({
  product: MERCHANT_PRODUCT,
  evaluator: "statefulWalletPolicyConformance",
  schemaVersion: MERCHANT_SCHEMA,
  standardPackage: STANDARD_PACKAGE,
  standardVersion: STANDARD_VERSION,
  endpoint: MERCHANT_ENDPOINT,
  source: "caller-supplied observations only",
  providerNativeVerifiedRule:
    "providerNativeVerified is derived only from caller-supplied observations (deny + enforcementClass policy).",
});

function looksLikeBasePayResult(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value.schema === "basepay-conformance/result" || value.checks || value.fixture),
  );
}

export function classifyLayer1Error(message) {
  const text = String(message || "");
  if (/unsupported stateful wallet policy observation schema/.test(text)) return "version_change";
  if (/case is unsupported/.test(text)) return "unknown_case";
  if (/duplicate case/.test(text)) return "contradictory";
  if (/explicit enforcementClass/.test(text)) return "contradictory";
  if (/allowed outcomes require/.test(text)) return "contradictory";
  if (/error outcomes require/.test(text)) return "contradictory";
  if (/unsupported fields/.test(text)) return "contradictory";
  if (/unsupported/.test(text) && /actual|enforcementClass/.test(text)) return "contradictory";
  if (/must contain 1-7/.test(text)) return "invalid_shape";
  if (/must be an object/.test(text)) return "invalid_shape";
  return "rejected";
}

function observationForCase(caseName, definition, override = {}) {
  if (override === null) return null;
  const expectedAllow = definition.expected === "allow";
  const base = expectedAllow
    ? { case: caseName, actual: "allowed", enforcementClass: "none", code: "signed" }
    : caseName === "application_serialized_concurrent_exceeds_cap"
      ? { case: caseName, actual: "denied", enforcementClass: "application", code: "application_guard" }
      : { case: caseName, actual: "denied", enforcementClass: "policy", code: "policy_violation" };
  return { ...base, ...override, case: override.case ?? caseName };
}

export function buildObservationMatrix({
  profileId = "basepay-composition-lab",
  provider = "BasePay recording mock",
  network = "eip155:8453",
  protocol = "x402",
  includeOptional = true,
  omit = [],
  overrides = {},
  extra = [],
  schemaVersion,
} = {}) {
  const omitted = new Set(omit);
  const observations = [];
  for (const caseName of STATEFUL_WALLET_POLICY_CASE_NAMES) {
    const definition = STATEFUL_WALLET_POLICY_CASES[caseName];
    if (omitted.has(caseName)) continue;
    if (!definition.required && !includeOptional) continue;
    const row = observationForCase(caseName, definition, overrides[caseName]);
    if (row) observations.push(row);
  }
  observations.push(...extra);
  const input = {
    profileId,
    provider,
    network,
    protocol,
    observations,
  };
  if (schemaVersion !== undefined) input.schemaVersion = schemaVersion;
  return input;
}

export function evaluateLayer1(input) {
  if (looksLikeBasePayResult(input)) {
    return Object.freeze({
      name: LAYER1_NAME,
      title: LAYER1_TITLE,
      authority: LAYER1_AUTHORITY,
      status: "rejected",
      kind: "wrong_layer",
      rejection: Object.freeze({
        kind: "wrong_layer",
        message: "BasePay conformance JSON is layer 2 and cannot be evaluated as a layer-1 observation matrix",
      }),
      evaluation: null,
      providerNativeVerified: Object.freeze([]),
      providerNativeUnverified: Object.freeze([]),
      applicationVerified: Object.freeze([]),
    });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("layer1 observations must be an object", { kind: "invalid_shape", layer: LAYER1_NAME });
  }

  try {
    const evaluation = statefulWalletPolicyConformance(input);
    return Object.freeze({
      name: LAYER1_NAME,
      title: LAYER1_TITLE,
      authority: LAYER1_AUTHORITY,
      status: "evaluated",
      kind: evaluation.decision,
      rejection: null,
      evaluation,
      providerNativeVerified: Object.freeze([...(evaluation.providerNativeVerified || [])]),
      providerNativeUnverified: Object.freeze([...(evaluation.providerNativeUnverified || [])]),
      applicationVerified: Object.freeze([...(evaluation.applicationVerified || [])]),
    });
  } catch (error) {
    const message = String(error?.message || error);
    const kind = classifyLayer1Error(message);
    if (!(error instanceof StatefulWalletPolicyConformanceError) && kind === "rejected") {
      throw error;
    }
    return Object.freeze({
      name: LAYER1_NAME,
      title: LAYER1_TITLE,
      authority: LAYER1_AUTHORITY,
      status: "rejected",
      kind,
      rejection: Object.freeze({ kind, message }),
      evaluation: null,
      providerNativeVerified: Object.freeze([]),
      providerNativeUnverified: Object.freeze([]),
      applicationVerified: Object.freeze([]),
    });
  }
}
