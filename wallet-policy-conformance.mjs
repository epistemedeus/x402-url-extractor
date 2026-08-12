const SCHEMA_VERSION = "samedaydesk.wallet-policy-conformance.v1";

export const WALLET_POLICY_CASES = Object.freeze({
  intended: Object.freeze({ expected: "allow", control: null, required: true }),
  missing_authorization: Object.freeze({ expected: "deny", control: "authorization", required: true }),
  wrong_operation: Object.freeze({ expected: "deny", control: "operation", required: true }),
  duplicate_approved_action: Object.freeze({ expected: "deny", control: "execution_shape", required: true }),
  wrong_chain: Object.freeze({ expected: "deny", control: "chain", required: true }),
  wrong_token_contract_or_program: Object.freeze({ expected: "deny", control: "token_contract", required: true }),
  wrong_recipient: Object.freeze({ expected: "deny", control: "recipient", required: true }),
  wrong_amount: Object.freeze({ expected: "deny", control: "amount", required: true }),
  wrong_function_or_instruction: Object.freeze({ expected: "deny", control: "function", required: true }),
  wrong_route_or_offer: Object.freeze({ expected: "deny", control: "route_lock", required: true }),
  changed_protocol_challenge: Object.freeze({ expected: "deny", control: "protocol_challenge", required: true }),
  replay_or_reuse: Object.freeze({ expected: "deny", control: "replay", required: true }),
  reordered_approved_actions: Object.freeze({ expected: "deny", control: "execution_shape", required: false }),
  mixed_unapproved_action: Object.freeze({ expected: "deny", control: "execution_shape", required: false }),
  wrong_fee_asset: Object.freeze({ expected: "deny", control: "execution_shape", required: false }),
  missing_validity: Object.freeze({ expected: "deny", control: "execution_shape", required: false }),
});

export const WALLET_POLICY_CONTROL_DIMENSIONS = Object.freeze([
  "authorization",
  "operation",
  "execution_shape",
  "chain",
  "token_contract",
  "recipient",
  "amount",
  "function",
  "route_lock",
  "protocol_challenge",
  "replay",
  "output_contract",
  "receipt",
  "balance_reconciliation",
]);

const REQUIRED_CASES = Object.freeze(
  Object.entries(WALLET_POLICY_CASES)
    .filter(([, value]) => value.required)
    .map(([name]) => name),
);
const PRE_SIGNATURE_CONTROLS = Object.freeze(WALLET_POLICY_CONTROL_DIMENSIONS.slice(0, 11));
const OUTCOMES = new Set(["allowed", "denied", "error"]);
const DENIAL_CLASSES = new Set(["none", "policy", "validation", "provider"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,127}$/;
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

export class WalletPolicyConformanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "WalletPolicyConformanceError";
  }
}

function fail(message) {
  throw new WalletPolicyConformanceError(message);
}

function strictRecord(value, label, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (extras.length) fail(`${label} contains unsupported fields: ${extras.join(", ")}`);
  return value;
}

function safeIdentifier(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!SAFE_ID.test(normalized)) fail(`${label} must be 1-128 safe printable characters`);
  return normalized;
}

function normalizeObservation(value, index) {
  const observation = strictRecord(
    value,
    `observations[${index}]`,
    new Set(["case", "actual", "denialClass", "code"]),
  );
  if (!Object.hasOwn(WALLET_POLICY_CASES, observation.case)) {
    fail(`observations[${index}].case is unsupported`);
  }
  if (!OUTCOMES.has(observation.actual)) fail(`observations[${index}].actual is unsupported`);
  const denialClass = observation.denialClass ?? "none";
  if (!DENIAL_CLASSES.has(denialClass)) fail(`observations[${index}].denialClass is unsupported`);
  if (observation.actual === "allowed" && denialClass !== "none") {
    fail(`observations[${index}] allowed outcomes require denialClass none`);
  }
  if (observation.actual === "denied" && denialClass === "none") {
    fail(`observations[${index}] denied outcomes require an explicit denialClass`);
  }
  if (observation.actual === "error" && !["validation", "provider"].includes(denialClass)) {
    fail(`observations[${index}] error outcomes require validation or provider denialClass`);
  }
  if (observation.code !== undefined && (typeof observation.code !== "string" || !SAFE_CODE.test(observation.code))) {
    fail(`observations[${index}].code must be 1-64 safe identifier characters`);
  }
  return Object.freeze({
    case: observation.case,
    actual: observation.actual,
    denialClass,
    ...(observation.code ? { code: observation.code } : {}),
  });
}

export function normalizeWalletPolicyConformanceInput(input) {
  const value = strictRecord(
    input,
    "request",
    new Set(["profileId", "provider", "network", "protocol", "observations"]),
  );
  if (!Array.isArray(value.observations) || value.observations.length < 1 || value.observations.length > 16) {
    fail("observations must contain 1-16 standardized cases");
  }
  const observations = value.observations.map(normalizeObservation);
  const seen = new Set();
  for (const observation of observations) {
    if (seen.has(observation.case)) fail(`observations contains duplicate case: ${observation.case}`);
    seen.add(observation.case);
  }
  return Object.freeze({
    profileId: safeIdentifier(value.profileId, "profileId"),
    provider: safeIdentifier(value.provider, "provider"),
    network: safeIdentifier(value.network, "network"),
    protocol: safeIdentifier(value.protocol, "protocol"),
    observations: Object.freeze(observations),
  });
}

function caseDisposition(observation) {
  const definition = WALLET_POLICY_CASES[observation.case];
  const expectationMet = definition.expected === "allow"
    ? observation.actual === "allowed"
    : observation.actual === "denied";
  const providerNativeVerified = definition.control !== null
    && observation.actual === "denied"
    && observation.denialClass === "policy";
  let finding = "expected_behavior";
  if (!expectationMet) {
    finding = observation.actual === "allowed" ? "unsafe_allowed" : "expected_behavior_not_proven";
  } else if (definition.expected === "deny" && !providerNativeVerified) {
    finding = "denied_outside_provider_policy";
  }
  return Object.freeze({
    ...observation,
    expected: definition.expected,
    control: definition.control,
    required: definition.required,
    expectationMet,
    providerNativeVerified,
    finding,
  });
}

export function walletPolicyConformance(input) {
  const normalized = normalizeWalletPolicyConformanceInput(input);
  const results = normalized.observations.map(caseDisposition);
  const byCase = new Map(results.map((result) => [result.case, result]));
  const missingRequiredCases = REQUIRED_CASES.filter((name) => !byCase.has(name));
  const unsafeCases = results
    .filter((result) => result.finding === "unsafe_allowed" || (result.case === "intended" && !result.expectationMet))
    .map((result) => result.case);
  const inconclusiveCases = results
    .filter((result) => result.finding === "expected_behavior_not_proven" || result.finding === "denied_outside_provider_policy")
    .map((result) => result.case);
  const providerNativeVerified = PRE_SIGNATURE_CONTROLS.filter((control) =>
    results.some((result) => result.control === control && result.providerNativeVerified),
  );
  const providerNativeUnverified = PRE_SIGNATURE_CONTROLS.filter((control) =>
    !providerNativeVerified.includes(control),
  );
  const executionShapeCases = results.filter((result) => result.control === "execution_shape");
  const exactShapePassed = executionShapeCases.length > 0
    && executionShapeCases.every((result) => result.providerNativeVerified)
    && byCase.has("duplicate_approved_action");
  const complete = missingRequiredCases.length === 0;
  let decision = "partial";
  if (unsafeCases.length) decision = "unsafe";
  else if (complete && inconclusiveCases.length === 0 && exactShapePassed) decision = "conformant";

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    product: "samedaydesk-wallet-policy-conformance",
    evaluatedAt: new Date().toISOString(),
    profile: Object.freeze({
      profileId: normalized.profileId,
      provider: normalized.provider,
      network: normalized.network,
      protocol: normalized.protocol,
    }),
    decision,
    complete,
    exactShapePassed,
    results: Object.freeze(results),
    providerNativeVerified: Object.freeze(providerNativeVerified),
    providerNativeUnverified: Object.freeze(providerNativeUnverified),
    notEvaluatedByWalletPolicy: Object.freeze(["output_contract", "receipt", "balance_reconciliation"]),
    missingRequiredCases: Object.freeze(missingRequiredCases),
    unsafeCases: Object.freeze(unsafeCases),
    inconclusiveCases: Object.freeze(inconclusiveCases),
    boundary: Object.freeze({
      credentialsAccepted: false,
      walletAccessed: false,
      signatureVerified: false,
      transactionBroadcast: false,
      statement: "Evaluates caller-supplied standardized observations. It does not independently execute or verify the provider policy tests.",
    }),
  });
}

