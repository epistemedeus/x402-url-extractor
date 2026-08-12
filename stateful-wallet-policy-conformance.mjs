import {
  SCHEMAS,
  STATEFUL_WALLET_POLICY_OBSERVATION_CASES,
  STATEFUL_WALLET_POLICY_OBSERVATION_CASE_NAMES,
  evaluateStatefulWalletPolicyObservations,
  normalizeStatefulWalletPolicyObservations,
  statefulWalletPolicyObservationInputSchema,
  statefulWalletPolicyObservationOutputSchema,
} from "agent-payment-policy";

const PRODUCT_SCHEMA = "samedaydesk.stateful-wallet-policy-conformance.v1";
const STANDARD_INPUT_SCHEMA = SCHEMAS.statefulWalletPolicyObservation;
const STANDARD_OUTPUT_SCHEMA = SCHEMAS.statefulWalletPolicyObservationReport;

export const STATEFUL_WALLET_POLICY_CASES = STATEFUL_WALLET_POLICY_OBSERVATION_CASES;
export const STATEFUL_WALLET_POLICY_CASE_NAMES = STATEFUL_WALLET_POLICY_OBSERVATION_CASE_NAMES;

export class StatefulWalletPolicyConformanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "StatefulWalletPolicyConformanceError";
  }
}

function fail(message) {
  throw new StatefulWalletPolicyConformanceError(message);
}

function toStandardInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("request must be an object");
  return { ...input, schemaVersion: input.schemaVersion || STANDARD_INPUT_SCHEMA };
}

export function normalizeStatefulWalletPolicyConformanceInput(input) {
  try {
    const normalized = normalizeStatefulWalletPolicyObservations(toStandardInput(input));
    const { schemaVersion: _schemaVersion, ...productInput } = normalized;
    return Object.freeze(productInput);
  } catch (error) {
    if (error instanceof StatefulWalletPolicyConformanceError) throw error;
    fail(String(error?.message || error));
  }
}

export function statefulWalletPolicyConformance(input) {
  const normalized = normalizeStatefulWalletPolicyConformanceInput(input);
  const standard = evaluateStatefulWalletPolicyObservations({
    schemaVersion: STANDARD_INPUT_SCHEMA,
    ...normalized,
  });
  const { schemaVersion: standardSchemaVersion, ...result } = standard;
  return Object.freeze({
    schemaVersion: PRODUCT_SCHEMA,
    standardSchemaVersion,
    product: "samedaydesk-stateful-wallet-policy-conformance",
    ...result,
  });
}

export function statefulWalletPolicyConformanceInputSchema() {
  const schema = structuredClone(statefulWalletPolicyObservationInputSchema());
  schema.title = "SameDayDesk stateful wallet policy conformance input";
  schema.required = schema.required.filter((field) => field !== "schemaVersion");
  return schema;
}

export function statefulWalletPolicyConformanceOutputSchema() {
  const schema = structuredClone(statefulWalletPolicyObservationOutputSchema());
  schema.title = "SameDayDesk stateful wallet policy conformance output";
  schema.properties.schemaVersion = { type: "string", const: PRODUCT_SCHEMA };
  schema.properties.standardSchemaVersion = { type: "string", const: STANDARD_OUTPUT_SCHEMA };
  schema.properties.product = { type: "string", const: "samedaydesk-stateful-wallet-policy-conformance" };
  schema.required = [
    "schemaVersion",
    "standardSchemaVersion",
    "product",
    ...schema.required.filter((field) => field !== "schemaVersion"),
  ];
  return schema;
}

export function statefulWalletPolicyConformanceContract({ endpoint, priceAtomicUsdc, paymentProtocols = ["x402", "mpp"] } = {}) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    fail("contract endpoint must be an absolute HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    fail("contract endpoint must be a credential-free absolute HTTPS URL");
  }
  const amount = String(priceAtomicUsdc || "");
  if (!/^[1-9][0-9]{0,20}$/.test(amount)) fail("contract priceAtomicUsdc must be a positive integer string");
  if (!Array.isArray(paymentProtocols) || paymentProtocols.length < 1 || paymentProtocols.some((value) => !["x402", "mpp"].includes(value))) {
    fail("contract paymentProtocols must contain x402 or mpp");
  }
  const requiredCases = Object.entries(STATEFUL_WALLET_POLICY_CASES)
    .filter(([, definition]) => definition.required)
    .map(([name]) => name);
  return Object.freeze({
    schemaVersion: "samedaydesk.stateful-wallet-policy-conformance-contract.v1",
    standard: Object.freeze({
      package: "agent-payment-policy",
      version: "0.6.0",
      inputSchemaVersion: STANDARD_INPUT_SCHEMA,
      outputSchemaVersion: STANDARD_OUTPUT_SCHEMA,
      repository: "https://github.com/epistemedeus/agent-payment-policy",
    }),
    product: "samedaydesk-stateful-wallet-policy-conformance",
    endpoint: Object.freeze({
      method: "POST",
      url: url.href,
      priceAtomicUsdc: amount,
      paymentProtocols: Object.freeze([...new Set(paymentProtocols)]),
    }),
    cases: Object.freeze(Object.entries(STATEFUL_WALLET_POLICY_CASES).map(([name, definition]) => Object.freeze({ name, ...definition }))),
    requiredCases: Object.freeze(requiredCases),
    inputSchema: Object.freeze(statefulWalletPolicyConformanceInputSchema()),
    outputSchema: Object.freeze(statefulWalletPolicyConformanceOutputSchema()),
    enforcementClasses: Object.freeze({
      policy: "Explicit provider-policy denial; eligible for provider-native stateful control credit.",
      application: "Application queue, mutex, or rate limiter denial; useful but kept separate from provider-native credit.",
      validation: "Request or SDK validation stopped the case before stateful enforcement.",
      provider: "Generic provider rejection without proof that configured policy state caused it.",
      none: "No denial occurred; required for an allowed outcome.",
    }),
    boundary: "Free machine contract only. The paid evaluator accepts no credentials, counter values, wallet or resource IDs, signatures, transactions, or raw provider payloads and does not run provider tests or concurrent requests.",
  });
}
