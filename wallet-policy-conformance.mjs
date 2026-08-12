import {
  SCHEMAS,
  WALLET_POLICY_OBSERVATION_CASES,
  WALLET_POLICY_OBSERVATION_CASE_NAMES,
  evaluateWalletPolicyObservations,
  normalizeWalletPolicyObservations,
  walletPolicyObservationInputSchema,
  walletPolicyObservationOutputSchema,
} from "agent-payment-policy";

const PRODUCT_SCHEMA = "samedaydesk.wallet-policy-conformance.v1";
const STANDARD_INPUT_SCHEMA = SCHEMAS.walletPolicyObservation;
const STANDARD_OUTPUT_SCHEMA = SCHEMAS.walletPolicyObservationReport;

export const WALLET_POLICY_CASES = WALLET_POLICY_OBSERVATION_CASES;
export const WALLET_POLICY_CASE_NAMES = WALLET_POLICY_OBSERVATION_CASE_NAMES;

export class WalletPolicyConformanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "WalletPolicyConformanceError";
  }
}

function fail(message) {
  throw new WalletPolicyConformanceError(message);
}

function toStandardInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("request must be an object");
  return {
    ...input,
    schemaVersion: input.schemaVersion || STANDARD_INPUT_SCHEMA,
  };
}

export function normalizeWalletPolicyConformanceInput(input) {
  try {
    const normalized = normalizeWalletPolicyObservations(toStandardInput(input));
    const { schemaVersion: _schemaVersion, ...productInput } = normalized;
    return Object.freeze(productInput);
  } catch (error) {
    if (error instanceof WalletPolicyConformanceError) throw error;
    fail(String(error?.message || error));
  }
}

export function walletPolicyConformance(input) {
  const normalized = normalizeWalletPolicyConformanceInput(input);
  const standard = evaluateWalletPolicyObservations({
    schemaVersion: STANDARD_INPUT_SCHEMA,
    ...normalized,
  });
  const { schemaVersion: standardSchemaVersion, ...result } = standard;
  return Object.freeze({
    schemaVersion: PRODUCT_SCHEMA,
    standardSchemaVersion,
    product: "samedaydesk-wallet-policy-conformance",
    ...result,
  });
}
export function walletPolicyConformanceInputSchema() {
  const schema = structuredClone(walletPolicyObservationInputSchema());
  schema.title = "SameDayDesk wallet policy conformance input";
  schema.required = schema.required.filter((field) => field !== "schemaVersion");
  return schema;
}

export function walletPolicyConformanceOutputSchema() {
  const schema = structuredClone(walletPolicyObservationOutputSchema());
  schema.title = "SameDayDesk wallet policy conformance output";
  schema.properties.schemaVersion = { type: "string", const: PRODUCT_SCHEMA };
  schema.properties.standardSchemaVersion = { type: "string", const: STANDARD_OUTPUT_SCHEMA };
  schema.properties.product = { type: "string", const: "samedaydesk-wallet-policy-conformance" };
  schema.required = [
    "schemaVersion",
    "standardSchemaVersion",
    "product",
    ...schema.required.filter((field) => field !== "schemaVersion"),
  ];
  return schema;
}

export function walletPolicyConformanceContract({ endpoint, priceAtomicUsdc, paymentProtocols = ["x402", "mpp"] } = {}) {
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
  const requiredCases = Object.entries(WALLET_POLICY_CASES)
    .filter(([, definition]) => definition.required)
    .map(([name]) => name);
  return Object.freeze({
    schemaVersion: "samedaydesk.wallet-policy-conformance-contract.v1",
    standard: Object.freeze({
      package: "agent-payment-policy",
      version: "0.5.1",
      inputSchemaVersion: STANDARD_INPUT_SCHEMA,
      outputSchemaVersion: STANDARD_OUTPUT_SCHEMA,
      repository: "https://github.com/epistemedeus/agent-payment-policy",
    }),
    product: "samedaydesk-wallet-policy-conformance",
    endpoint: Object.freeze({ method: "POST", url: url.href, priceAtomicUsdc: amount, paymentProtocols: Object.freeze([...new Set(paymentProtocols)]) }),
    cases: Object.freeze(Object.entries(WALLET_POLICY_CASES).map(([name, definition]) => Object.freeze({ name, ...definition }))),
    requiredCases: Object.freeze(requiredCases),
    inputSchema: Object.freeze(walletPolicyConformanceInputSchema()),
    outputSchema: Object.freeze(walletPolicyConformanceOutputSchema()),
    evidenceClasses: Object.freeze({
      policy: "Explicit provider-policy denial; eligible for provider-native control credit.",
      validation: "Request or SDK validation stopped the case before provider-policy enforcement.",
      provider: "Generic provider rejection without proof that the configured policy caused it.",
      none: "No denial occurred; required for an allowed outcome.",
    }),
    boundary: "Free machine contract only. The paid evaluator accepts no credential fields or raw provider payloads and does not access a wallet, sign, broadcast, or independently run provider tests.",
  });
}
