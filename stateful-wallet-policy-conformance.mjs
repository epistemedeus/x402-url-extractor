import { z } from "zod";
import {
  SCHEMAS,
  STATEFUL_WALLET_POLICY_OBSERVATION_CASES,
  STATEFUL_WALLET_POLICY_OBSERVATION_CASE_NAMES,
  evaluateStatefulWalletPolicyObservations,
  normalizeStatefulWalletPolicyObservations,
  statefulWalletPolicyObservationInputSchema,
  statefulWalletPolicyObservationOutputSchema,
} from "agent-payment-policy";

const STATEFUL_CASE_VALUES = /** @type {[string, ...string[]]} */ ([...STATEFUL_WALLET_POLICY_OBSERVATION_CASE_NAMES]);
const STATEFUL_RESULT_FINDINGS = /** @type {[string, ...string[]]} */ ([
  "expected_behavior",
  "unsafe_allowed",
  "expected_behavior_not_proven",
  "denied_outside_policy_or_application_guard",
]);

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
        case: { type: "string", enum: STATEFUL_CASE_VALUES },
        actual: { type: "string", enum: ["allowed", "denied", "error"] },
        enforcementClass: { type: "string", enum: ["none", "policy", "application", "validation", "provider"] },
        code: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$" },
        expected: { type: "string", enum: ["allow", "deny"] },
        control: { type: ["string", "null"] },
        required: { type: "boolean" },
        expectationMet: { type: "boolean" },
        providerNativeVerified: { type: "boolean" },
        applicationVerified: { type: "boolean" },
        finding: { type: "string", enum: STATEFUL_RESULT_FINDINGS },
      },
      required: [
        "case",
        "actual",
        "enforcementClass",
        "expected",
        "control",
        "required",
        "expectationMet",
        "providerNativeVerified",
        "applicationVerified",
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
      signaturesVerified: { type: "boolean", const: false },
      transactionBroadcast: { type: "boolean", const: false },
      statement: { type: "string" },
    },
    required: ["credentialsAccepted", "walletAccessed", "signaturesVerified", "transactionBroadcast", "statement"],
  };
  schema.required = [
    "schemaVersion",
    "standardSchemaVersion",
    "product",
    ...schema.required.filter((field) => field !== "schemaVersion"),
  ];
  return schema;
}

const statefulResultMcpSchema = z.object({
  case: z.enum(STATEFUL_CASE_VALUES),
  actual: z.enum(["allowed", "denied", "error"]),
  enforcementClass: z.enum(["none", "policy", "application", "validation", "provider"]),
  code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/).optional(),
  expected: z.enum(["allow", "deny"]),
  control: z.string().nullable(),
  required: z.boolean(),
  expectationMet: z.boolean(),
  providerNativeVerified: z.boolean(),
  applicationVerified: z.boolean(),
  finding: z.enum(STATEFUL_RESULT_FINDINGS),
}).strict();

export const statefulWalletPolicyConformanceMcpOutputSchema = z.object({
  schemaVersion: z.literal(PRODUCT_SCHEMA),
  standardSchemaVersion: z.literal(STANDARD_OUTPUT_SCHEMA),
  product: z.literal("samedaydesk-stateful-wallet-policy-conformance"),
  evaluatedAt: z.string().datetime(),
  profile: z.object({
    profileId: z.string(),
    provider: z.string(),
    network: z.string(),
    protocol: z.string(),
  }).strict(),
  decision: z.enum(["conformant", "partial", "unsafe"]),
  complete: z.boolean(),
  strictBudgetPassed: z.boolean(),
  results: z.array(statefulResultMcpSchema),
  providerNativeVerified: z.array(z.string()),
  providerNativeUnverified: z.array(z.string()),
  applicationVerified: z.array(z.string()),
  missingRequiredCases: z.array(z.string()),
  unsafeCases: z.array(z.string()),
  inconclusiveCases: z.array(z.string()),
  boundary: z.object({
    credentialsAccepted: z.literal(false),
    walletAccessed: z.literal(false),
    signaturesVerified: z.literal(false),
    transactionBroadcast: z.literal(false),
    statement: z.string(),
  }).strict(),
}).strict();

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
