import { z } from "zod";
import {
  SCHEMAS,
  WALLET_POLICY_OBSERVATION_CASES,
  WALLET_POLICY_OBSERVATION_CASE_NAMES,
  evaluateWalletPolicyObservations,
  normalizeWalletPolicyObservations,
  walletPolicyObservationInputSchema,
  walletPolicyObservationOutputSchema,
} from "agent-payment-policy";

const WALLET_CASE_VALUES = /** @type {[string, ...string[]]} */ ([...WALLET_POLICY_OBSERVATION_CASE_NAMES]);
const WALLET_RESULT_FINDINGS = /** @type {[string, ...string[]]} */ ([
  "expected_behavior",
  "unsafe_allowed",
  "expected_behavior_not_proven",
  "denied_outside_provider_policy",
]);

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
  schema.properties.profile = {
    type: "object",
    additionalProperties: false,
    properties: {
      profileId: { type: "string" },
      provider: { type: "string" },
      network: { type: "string" },
      protocol: { type: "string" },
    },
    required: ["profileId", "provider", "network", "protocol"],
  };
  schema.properties.results = {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        case: { type: "string", enum: WALLET_CASE_VALUES },
        actual: { type: "string", enum: ["allowed", "denied", "error"] },
        denialClass: { type: "string", enum: ["none", "policy", "validation", "provider"] },
        code: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$" },
        expected: { type: "string", enum: ["allow", "deny"] },
        control: { type: ["string", "null"] },
        required: { type: "boolean" },
        expectationMet: { type: "boolean" },
        providerNativeVerified: { type: "boolean" },
        finding: { type: "string", enum: WALLET_RESULT_FINDINGS },
      },
      required: [
        "case",
        "actual",
        "denialClass",
        "expected",
        "control",
        "required",
        "expectationMet",
        "providerNativeVerified",
        "finding",
      ],
    },
  };
  schema.properties.boundary = {
    type: "object",
    additionalProperties: false,
    properties: {
      credentialsAccepted: { type: "boolean", const: false },
      walletAccessed: { type: "boolean", const: false },
      signatureVerified: { type: "boolean", const: false },
      transactionBroadcast: { type: "boolean", const: false },
      statement: { type: "string" },
    },
    required: ["credentialsAccepted", "walletAccessed", "signatureVerified", "transactionBroadcast", "statement"],
  };
  schema.required = [
    "schemaVersion",
    "standardSchemaVersion",
    "product",
    ...schema.required.filter((field) => field !== "schemaVersion"),
  ];
  return schema;
}

const walletResultMcpSchema = z.object({
  case: z.enum(WALLET_CASE_VALUES),
  actual: z.enum(["allowed", "denied", "error"]),
  denialClass: z.enum(["none", "policy", "validation", "provider"]),
  code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/).optional(),
  expected: z.enum(["allow", "deny"]),
  control: z.string().nullable(),
  required: z.boolean(),
  expectationMet: z.boolean(),
  providerNativeVerified: z.boolean(),
  finding: z.enum(WALLET_RESULT_FINDINGS),
}).strict();

export const walletPolicyConformanceMcpOutputSchema = z.object({
  schemaVersion: z.literal(PRODUCT_SCHEMA),
  standardSchemaVersion: z.literal(STANDARD_OUTPUT_SCHEMA),
  product: z.literal("samedaydesk-wallet-policy-conformance"),
  evaluatedAt: z.string().datetime(),
  profile: z.object({
    profileId: z.string(),
    provider: z.string(),
    network: z.string(),
    protocol: z.string(),
  }).strict(),
  decision: z.enum(["conformant", "partial", "unsafe"]),
  complete: z.boolean(),
  exactShapePassed: z.boolean(),
  results: z.array(walletResultMcpSchema),
  providerNativeVerified: z.array(z.string()),
  providerNativeUnverified: z.array(z.string()),
  notEvaluatedByWalletPolicy: z.array(z.string()),
  missingRequiredCases: z.array(z.string()),
  unsafeCases: z.array(z.string()),
  inconclusiveCases: z.array(z.string()),
  boundary: z.object({
    credentialsAccepted: z.literal(false),
    walletAccessed: z.literal(false),
    signatureVerified: z.literal(false),
    transactionBroadcast: z.literal(false),
    statement: z.string(),
  }).strict(),
}).strict();

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
      version: "0.6.0",
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
