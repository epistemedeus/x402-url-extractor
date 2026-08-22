import { createHash } from "node:crypto";

const INPUT_SCHEMA = "samedaydesk.mcp-typed-telemetry-input.v1";
const OUTPUT_SCHEMA = "samedaydesk.mcp-typed-telemetry-decision.v1";
const OFFER_SCHEMA = "samedaydesk.mcp-issued-offer.v1";
const OFFER_DOMAIN = "samedaydesk.mcp-issued-offer.v1\0";
const HEX_256 = /^[0-9a-f]{64}$/u;
const SAFE_TOKEN = /^[a-z][a-z0-9_]{0,63}$/u;
const SAFE_SKU = /^[a-z][a-z0-9-]{0,95}$/u;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]{0,77})$/u;
const ASCII_CONTROL = /[\u0000-\u001f\u007f]/u;
const OUTPUT_KEYS = Object.freeze([
  "action",
  "applicationOutcome",
  "binding",
  "handlerInvoked",
  "paymentCredentialParsed",
  "paymentPresent",
  "reason",
  "result",
  "schemaVersion",
  "settlementState",
]);
const NULL_BINDING = Object.freeze({
  issuedOfferDigest: null,
  productSku: null,
  resource: null,
  tool: null,
});
const CREDENTIAL_STATES = new Set(["absent", "rejected", "verified"]);
const EXECUTION_STATES = new Set([
  "handler_error",
  "handler_success",
  "not_invoked",
  "replay_success",
]);
const SETTLEMENT_STATES = new Set(["failed", "not_attempted", "succeeded", "unknown"]);
const RESPONSE_KINDS = new Set(["no_response", "payment_required", "tool_result", "transport_error"]);
const SETTLEMENT_ATTEMPTED = new Set(["succeeded", "failed"]);
const ACTIONS = new Set(["drop", "emit"]);
const RESULTS = new Set([
  "application_failure",
  "challenge",
  "invalid",
  "paid_success",
  "protocol_discovery",
  "replay_success",
  "settlement_failure",
  "telemetry_incomplete",
]);
const REASONS = new Set([
  "invalid_catalog_binding",
  "invalid_notification_state",
  "invalid_typed_outcome",
  "issued_offer_binding_mismatch",
  "jsonrpc_notification",
  "request_response_id_mismatch",
  "settlement_outcome_unknown",
  "typed_application_failure",
  "typed_paid_success",
  "typed_payment_required",
  "typed_replay_success",
  "typed_settlement_failure",
  "verified_without_execution",
]);
const APPLICATION_OUTCOMES = new Set(["error", "not_run", "replay", "success"]);
const DROP_REASONS = new Set([
  "invalid_catalog_binding",
  "invalid_notification_state",
  "invalid_typed_outcome",
  "issued_offer_binding_mismatch",
  "request_response_id_mismatch",
]);
const EMIT_COMBINATIONS = Object.freeze({
  application_failure: Object.freeze({
    reason: "typed_application_failure",
    applicationOutcome: "error",
    handlerInvoked: true,
    paymentPresent: true,
    paymentCredentialParsed: true,
  }),
  challenge: Object.freeze({
    reason: "typed_payment_required",
    applicationOutcome: "not_run",
    handlerInvoked: false,
    paymentPresent: true,
    paymentCredentialParsed: false,
    settlementState: "not_attempted",
  }),
  paid_success: Object.freeze({
    reason: "typed_paid_success",
    applicationOutcome: "success",
    handlerInvoked: true,
    paymentPresent: true,
    paymentCredentialParsed: true,
    settlementState: "succeeded",
  }),
  protocol_discovery: Object.freeze({
    reason: "jsonrpc_notification",
    applicationOutcome: "not_run",
    handlerInvoked: false,
    paymentPresent: false,
    paymentCredentialParsed: false,
    settlementState: "not_attempted",
  }),
  replay_success: Object.freeze({
    reason: "typed_replay_success",
    applicationOutcome: "replay",
    handlerInvoked: false,
    paymentPresent: true,
    paymentCredentialParsed: true,
    settlementState: "succeeded",
  }),
  settlement_failure: Object.freeze({
    reason: "typed_settlement_failure",
    applicationOutcome: "success",
    handlerInvoked: true,
    paymentPresent: true,
    paymentCredentialParsed: true,
    settlementState: "failed",
  }),
  telemetry_incomplete: null,
});

const CLOSED_MCP_PRODUCTS = Object.freeze({
  extract: Object.freeze({
    tool: "extract",
    productSku: "samedaydesk-extract",
    resource: "mcp://tool/extract",
    httpRoute: "/extract",
  }),
  read: Object.freeze({
    tool: "read",
    productSku: "samedaydesk-read",
    resource: "mcp://tool/read",
    httpRoute: "/read",
  }),
  scan: Object.freeze({
    tool: "scan",
    productSku: "samedaydesk-scan",
    resource: "mcp://tool/scan",
    httpRoute: "/scan",
  }),
  schemaforge: Object.freeze({
    tool: "schemaforge",
    productSku: "samedaydesk-schemaforge",
    resource: "mcp://tool/schemaforge",
    httpRoute: "/schemaforge",
  }),
  enrich: Object.freeze({
    tool: "enrich",
    productSku: "samedaydesk-enrich",
    resource: "mcp://tool/enrich",
    httpRoute: "/enrich",
  }),
  wallet_enrich: Object.freeze({
    tool: "wallet_enrich",
    productSku: "samedaydesk-wallet-enrich",
    resource: "mcp://tool/wallet_enrich",
    httpRoute: "/wallet-enrich",
  }),
  deep_audit: Object.freeze({
    tool: "deep_audit",
    productSku: "samedaydesk-deep-audit",
    resource: "mcp://tool/deep_audit",
    httpRoute: "/deep-audit",
  }),
  morpho_position: Object.freeze({
    tool: "morpho_position",
    productSku: "samedaydesk-morpho-position",
    resource: "mcp://tool/morpho_position",
    httpRoute: "/defi/morpho-position",
  }),
  morpho_protection: Object.freeze({
    tool: "morpho_protection",
    productSku: "samedaydesk-morpho-protection",
    resource: "mcp://tool/morpho_protection",
    httpRoute: "/defi/morpho-protection",
  }),
  morpho_market_underwrite: Object.freeze({
    tool: "morpho_market_underwrite",
    productSku: "samedaydesk-morpho-market-underwrite",
    resource: "mcp://tool/morpho_market_underwrite",
    httpRoute: "/defi/morpho-market-underwrite",
  }),
  morpho_preliquidation_replay: Object.freeze({
    tool: "morpho_preliquidation_replay",
    productSku: "samedaydesk-morpho-preliquidation-replay",
    resource: "mcp://tool/morpho_preliquidation_replay",
    httpRoute: "/defi/morpho-preliquidation-replay",
  }),
  opportunity_preflight: Object.freeze({
    tool: "opportunity_preflight",
    productSku: "samedaydesk-opportunity-preflight",
    resource: "mcp://tool/opportunity_preflight",
    httpRoute: "/work/opportunity-preflight",
  }),
  agent_discoverability_audit: Object.freeze({
    tool: "agent_discoverability_audit",
    productSku: "samedaydesk-agent-discoverability-audit",
    resource: "mcp://tool/agent_discoverability_audit",
    httpRoute: "/distribution/agent-discoverability-audit",
  }),
  payment_offer_preflight: Object.freeze({
    tool: "payment_offer_preflight",
    productSku: "samedaydesk-payment-offer-preflight",
    resource: "mcp://tool/payment_offer_preflight",
    httpRoute: "/commerce/payment-offer-preflight",
  }),
  seller_integrity_audit: Object.freeze({
    tool: "seller_integrity_audit",
    productSku: "samedaydesk-seller-integrity-audit",
    resource: "mcp://tool/seller_integrity_audit",
    httpRoute: "/commerce/seller-integrity-audit",
  }),
  contract_qualified_search: Object.freeze({
    tool: "contract_qualified_search",
    productSku: "samedaydesk-contract-qualified-search",
    resource: "mcp://tool/contract_qualified_search",
    httpRoute: "/commerce/contract-qualified-search",
  }),
  agent_surface_budget_audit: Object.freeze({
    tool: "agent_surface_budget_audit",
    productSku: "samedaydesk-agent-surface-budget-audit",
    resource: "mcp://tool/agent_surface_budget_audit",
    httpRoute: "/distribution/agent-surface-budget-audit",
  }),
  settlement_proof: Object.freeze({
    tool: "settlement_proof",
    productSku: "samedaydesk-settlement-proof",
    resource: "mcp://tool/settlement_proof",
    httpRoute: "/commerce/settlement-proof",
  }),
  transaction_receipt: Object.freeze({
    tool: "transaction_receipt",
    productSku: "samedaydesk-transaction-receipt",
    resource: "mcp://tool/transaction_receipt",
    httpRoute: "/chain/transaction-receipt",
  }),
  solana_transaction_receipt: Object.freeze({
    tool: "solana_transaction_receipt",
    productSku: "samedaydesk-solana-transaction-receipt",
    resource: "mcp://tool/solana_transaction_receipt",
    httpRoute: "/chain/solana-transaction-receipt",
  }),
  wallet_policy_conformance: Object.freeze({
    tool: "wallet_policy_conformance",
    productSku: "samedaydesk-wallet-policy-conformance",
    resource: "mcp://tool/wallet_policy_conformance",
    httpRoute: "/security/wallet-policy-conformance",
  }),
  stateful_wallet_policy_conformance: Object.freeze({
    tool: "stateful_wallet_policy_conformance",
    productSku: "samedaydesk-stateful-wallet-policy-conformance",
    resource: "mcp://tool/stateful_wallet_policy_conformance",
    httpRoute: "/security/stateful-wallet-policy-conformance",
  }),
});

const utf8Encoder = new TextEncoder();

function clone(value) {
  return structuredClone(value);
}

function exactKeys(value, keys) {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function utf8ByteLength(value) {
  return utf8Encoder.encode(value).length;
}

function compareUtf8(left, right) {
  const a = utf8Encoder.encode(left);
  const b = utf8Encoder.encode(right);
  const n = Math.min(a.length, b.length);
  for (let index = 0; index < n; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function boundedPrintable(value, maxBytes) {
  return (
    typeof value === "string"
    && utf8ByteLength(value) >= 1
    && utf8ByteLength(value) <= maxBytes
    && !ASCII_CONTROL.test(value)
  );
}

function validId(hasId, id) {
  if (hasId === false) return id === null;
  if (hasId !== true) return false;
  if (typeof id === "number") return Number.isSafeInteger(id);
  return (
    typeof id === "string"
    && utf8ByteLength(id) >= 1
    && utf8ByteLength(id) <= 128
    && !ASCII_CONTROL.test(id)
  );
}

function strictIdEqual(left, right) {
  return typeof left === typeof right && Object.is(left, right);
}

function emptyDecision(reason) {
  return {
    schemaVersion: OUTPUT_SCHEMA,
    action: "drop",
    result: "invalid",
    paymentPresent: false,
    paymentCredentialParsed: false,
    handlerInvoked: false,
    applicationOutcome: "not_run",
    settlementState: "not_attempted",
    reason,
    binding: clone(NULL_BINDING),
  };
}

function emitDecision(input, fields) {
  return {
    schemaVersion: OUTPUT_SCHEMA,
    action: "emit",
    ...fields,
    binding: clone(input.binding),
  };
}

function validEnvelopeShape(input) {
  if (!exactKeys(input, [
    "binding",
    "credential",
    "execution",
    "request",
    "response",
    "schemaVersion",
    "settlement",
  ])) return false;
  if (input.schemaVersion !== INPUT_SCHEMA) return false;
  if (!exactKeys(input.binding, ["issuedOfferDigest", "productSku", "resource", "tool"])) return false;
  if (!exactKeys(input.request, ["hasId", "id", "jsonrpc", "method"])) return false;
  if (!exactKeys(input.response, ["hasId", "id", "kind"])) return false;
  if (!exactKeys(input.credential, ["offerDigest", "state"])) return false;
  if (!exactKeys(input.execution, ["handlerInvoked", "resultIsError", "state"])) return false;
  if (!exactKeys(input.settlement, ["offerDigest", "state"])) return false;
  return true;
}

export function productSkuForTool(tool) {
  return `samedaydesk-${String(tool).replaceAll("_", "-")}`;
}

export function resourceForTool(tool) {
  return `mcp://tool/${tool}`;
}

export function closedMcpProduct(tool) {
  return CLOSED_MCP_PRODUCTS[tool] ?? null;
}

export function validCatalogBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return false;
  if (!SAFE_TOKEN.test(binding.tool)) return false;
  if (!SAFE_SKU.test(binding.productSku)) return false;
  const closed = CLOSED_MCP_PRODUCTS[binding.tool];
  if (!closed) return false;
  if (binding.productSku !== closed.productSku) return false;
  if (binding.resource !== closed.resource) return false;
  return HEX_256.test(binding.issuedOfferDigest);
}

function validNullBinding(binding) {
  return exactKeys(binding, ["issuedOfferDigest", "productSku", "resource", "tool"])
    && binding.issuedOfferDigest === null
    && binding.productSku === null
    && binding.resource === null
    && binding.tool === null;
}

function validTypedStates(input) {
  if (!CREDENTIAL_STATES.has(input.credential.state)) return false;
  if (!EXECUTION_STATES.has(input.execution.state)) return false;
  if (!SETTLEMENT_STATES.has(input.settlement.state)) return false;
  if (!RESPONSE_KINDS.has(input.response.kind)) return false;
  if (input.credential.state === "verified") {
    if (!HEX_256.test(input.credential.offerDigest)) return false;
  } else if (input.credential.offerDigest !== null) return false;
  if (SETTLEMENT_ATTEMPTED.has(input.settlement.state)) {
    if (!HEX_256.test(input.settlement.offerDigest)) return false;
  } else if (input.settlement.offerDigest !== null) return false;
  const executionShapes = {
    handler_error: [true, true],
    handler_success: [true, false],
    not_invoked: [false, null],
    replay_success: [false, false],
  };
  return (
    input.execution.handlerInvoked === executionShapes[input.execution.state][0]
    && input.execution.resultIsError === executionShapes[input.execution.state][1]
  );
}

function canonicalOfferPayload(offer) {
  if (!exactKeys(offer, ["accepts", "binding", "schemaVersion"])) return null;
  if (offer.schemaVersion !== OFFER_SCHEMA) return null;
  if (!exactKeys(offer.binding, ["productSku", "resource", "tool"])) return null;
  if (!SAFE_TOKEN.test(offer.binding.tool)) return null;
  if (!SAFE_SKU.test(offer.binding.productSku)) return null;
  if (!boundedPrintable(offer.binding.resource, 256)) return null;
  if (!Array.isArray(offer.accepts) || offer.accepts.length < 1 || offer.accepts.length > 8) return null;
  const accepts = [];
  for (const term of offer.accepts) {
    if (!exactKeys(term, [
      "asset",
      "atomicAmount",
      "atomicUnits",
      "network",
      "protocol",
      "recipient",
      "resource",
    ])) return null;
    if (!boundedPrintable(term.protocol, 64)) return null;
    if (!boundedPrintable(term.network, 128)) return null;
    if (!boundedPrintable(term.asset, 128)) return null;
    if (!CANONICAL_UINT.test(term.atomicAmount)) return null;
    if (!CANONICAL_UINT.test(term.atomicUnits)) return null;
    if (!boundedPrintable(term.recipient, 256)) return null;
    if (!boundedPrintable(term.resource, 256)) return null;
    accepts.push({
      protocol: term.protocol,
      network: term.network,
      asset: term.asset,
      atomicAmount: term.atomicAmount,
      atomicUnits: term.atomicUnits,
      recipient: term.recipient,
      resource: term.resource,
    });
  }
  const keyed = accepts.map((term) => ({ key: JSON.stringify(term), term }));
  keyed.sort((left, right) => compareUtf8(left.key, right.key));
  if (keyed.some((entry, index) => index > 0 && entry.key === keyed[index - 1].key)) return null;
  return JSON.stringify({
    schemaVersion: OFFER_SCHEMA,
    binding: {
      tool: offer.binding.tool,
      productSku: offer.binding.productSku,
      resource: offer.binding.resource,
    },
    accepts: keyed.map(({ term }) => term),
  });
}

export function digestMcpIssuedOfferV1(offer) {
  const payload = canonicalOfferPayload(offer);
  if (payload === null) return null;
  return createHash("sha256").update(`${OFFER_DOMAIN}${payload}`, "utf8").digest("hex");
}

function canonicalUnits(term) {
  const decimals = term?.extra?.decimals;
  if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 77) return String(decimals);
  return "6";
}

export function issuedOfferFromX402Accepts(accepts, binding = {}) {
  if (!Array.isArray(accepts) || accepts.length < 1 || accepts.length > 8) return null;
  if (!binding || typeof binding !== "object") return null;
  const terms = [];
  for (const item of accepts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    terms.push({
      protocol: item.scheme,
      network: item.network,
      asset: item.asset,
      atomicAmount: item.amount,
      atomicUnits: canonicalUnits(item),
      recipient: item.payTo,
      resource: binding.resource,
    });
  }
  return {
    schemaVersion: OFFER_SCHEMA,
    binding: {
      tool: binding.tool,
      productSku: binding.productSku,
      resource: binding.resource,
    },
    accepts: terms,
  };
}

export function digestIssuedOffer(accepts, binding = {}) {
  return digestMcpIssuedOfferV1(issuedOfferFromX402Accepts(accepts, binding));
}

export function buildRegisteredCatalog(tools) {
  if (!Array.isArray(tools)) {
    throw new Error("typed MCP catalog requires a registered tool array");
  }
  const byName = new Map();
  const skus = new Set();
  const resources = new Set();
  const routes = new Set();
  for (const tool of tools) {
    const name = tool?.name;
    const closed = CLOSED_MCP_PRODUCTS[name];
    if (!closed) {
      throw new Error("registered MCP tool is not in the closed product map");
    }
    const productSku = productSkuForTool(name);
    const resource = resourceForTool(name);
    if (productSku !== closed.productSku || resource !== closed.resource) {
      throw new Error("registered MCP catalog mapping drifted from the closed product map");
    }
    if (tool.httpRoute && tool.httpRoute !== closed.httpRoute) {
      throw new Error("registered MCP HTTP route drifted from the closed product map");
    }
    if (byName.has(name) || skus.has(productSku) || resources.has(resource) || routes.has(closed.httpRoute)) {
      throw new Error("registered MCP catalog mapping is duplicate or inconsistent");
    }
    byName.set(name, Object.freeze({
      tool: closed.tool,
      productSku: closed.productSku,
      resource: closed.resource,
      httpRoute: closed.httpRoute,
    }));
    skus.add(productSku);
    resources.add(resource);
    routes.add(closed.httpRoute);
  }
  return byName;
}

export function evaluateMcpTypedTelemetryOutcome(input) {
  if (!validEnvelopeShape(input)) return emptyDecision("invalid_typed_outcome");
  if (!validCatalogBinding(input.binding)) return emptyDecision("invalid_catalog_binding");
  if (
    input.request.jsonrpc !== "2.0"
    || input.request.method !== "tools/call"
    || !validId(input.request.hasId, input.request.id)
    || !validId(input.response.hasId, input.response.id)
    || !validTypedStates(input)
  ) return emptyDecision("invalid_typed_outcome");

  if (!input.request.hasId) {
    const cleanNotification =
      input.response.hasId === false
      && input.response.kind === "no_response"
      && input.credential.state === "absent"
      && input.execution.state === "not_invoked"
      && input.settlement.state === "not_attempted";
    if (!cleanNotification) return emptyDecision("invalid_notification_state");
    return emitDecision(input, {
      result: "protocol_discovery",
      paymentPresent: false,
      paymentCredentialParsed: false,
      handlerInvoked: false,
      applicationOutcome: "not_run",
      settlementState: "not_attempted",
      reason: "jsonrpc_notification",
    });
  }

  if (
    !input.response.hasId
    || !strictIdEqual(input.request.id, input.response.id)
  ) return emptyDecision("request_response_id_mismatch");

  if (
    input.credential.state === "verified"
    && input.credential.offerDigest !== input.binding.issuedOfferDigest
  ) return emptyDecision("issued_offer_binding_mismatch");
  if (
    SETTLEMENT_ATTEMPTED.has(input.settlement.state)
    && input.settlement.offerDigest !== input.binding.issuedOfferDigest
  ) return emptyDecision("issued_offer_binding_mismatch");

  const paymentPresent = input.credential.state !== "absent";
  const paymentCredentialParsed = input.credential.state === "verified";
  const base = {
    paymentPresent,
    paymentCredentialParsed,
    handlerInvoked: input.execution.handlerInvoked,
    applicationOutcome:
      input.execution.state === "handler_success" ? "success"
        : input.execution.state === "handler_error" ? "error"
          : input.execution.state === "replay_success" ? "replay" : "not_run",
    settlementState: input.settlement.state,
  };

  if (
    input.response.kind === "payment_required"
    && ["absent", "rejected"].includes(input.credential.state)
    && input.execution.state === "not_invoked"
    && input.settlement.state === "not_attempted"
  ) {
    return emitDecision(input, { ...base, reason: "typed_payment_required", result: "challenge" });
  }

  if (input.credential.state !== "verified") return emptyDecision("invalid_typed_outcome");
  if (input.execution.state === "handler_error") {
    return emitDecision(input, { ...base, reason: "typed_application_failure", result: "application_failure" });
  }
  if (input.execution.state === "not_invoked") {
    return emitDecision(input, { ...base, reason: "verified_without_execution", result: "telemetry_incomplete" });
  }
  if (input.settlement.state === "failed") {
    return emitDecision(input, { ...base, reason: "typed_settlement_failure", result: "settlement_failure" });
  }
  if (input.settlement.state !== "succeeded") {
    return emitDecision(input, { ...base, reason: "settlement_outcome_unknown", result: "telemetry_incomplete" });
  }
  if (input.response.kind !== "tool_result") return emptyDecision("invalid_typed_outcome");
  if (input.execution.state === "replay_success") {
    return emitDecision(input, { ...base, reason: "typed_replay_success", result: "replay_success" });
  }
  if (input.execution.state === "handler_success") {
    return emitDecision(input, { ...base, reason: "typed_paid_success", result: "paid_success" });
  }
  return emptyDecision("invalid_typed_outcome");
}

function enqueueAppend(onAppend, decision) {
  if (typeof onAppend !== "function") return;
  const run = () => {
    try {
      const result = onAppend(decision);
      if (result && typeof result.then === "function") {
        result.then(() => undefined, () => undefined);
      }
    } catch {
      // Append is best effort and must not throw into the request path.
    }
  };
  void Promise.resolve().then(run, () => undefined);
}

export function createMcpTypedTelemetryAttempt({ binding, request, onAppend } = {}) {
  const ownedBinding = clone(binding);
  const ownedRequest = {
    jsonrpc: request?.jsonrpc === "2.0" ? "2.0" : request?.jsonrpc,
    hasId: request?.hasId === true,
    id: request?.hasId === true ? request.id : null,
    method: request?.method ?? "tools/call",
  };
  let credential = { state: "absent", offerDigest: null };
  let execution = { state: "not_invoked", handlerInvoked: false, resultIsError: null };
  let settlement = { state: "not_attempted", offerDigest: null };
  let credentialTerminal = false;
  let handlerStarted = false;
  let handlerTerminal = false;
  let settlementTerminal = false;
  let transportError = false;
  let wrapperEntered = false;
  let responseHasId = ownedRequest.hasId;
  let responseId = ownedRequest.hasId ? ownedRequest.id : null;
  let responseKind = null;
  let finalized = false;
  let invalidReason = null;
  let lastDecision = null;

  function markInvalid(reason = "invalid_typed_outcome") {
    if (!invalidReason) invalidReason = reason;
  }

  function markPaidWrapperEntered() {
    if (finalized) {
      markInvalid();
      return;
    }
    wrapperEntered = true;
  }

  function bindRequestId(id) {
    if (finalized) {
      markInvalid();
      return;
    }
    if (!ownedRequest.hasId) return;
    ownedRequest.id = id;
  }

  function credentialRejected() {
    if (finalized || credentialTerminal) {
      markInvalid();
      return;
    }
    credentialTerminal = true;
    credential = { state: "rejected", offerDigest: null };
  }

  function credentialVerified({ offerDigest } = {}) {
    if (finalized || credentialTerminal) {
      markInvalid();
      return;
    }
    credentialTerminal = true;
    credential = { state: "verified", offerDigest: offerDigest ?? null };
  }

  function handlerStartedTransition() {
    if (finalized || handlerStarted || handlerTerminal) {
      markInvalid();
      return;
    }
    if (credential.state !== "verified") {
      markInvalid();
      return;
    }
    handlerStarted = true;
  }

  function handlerFinished({ isError } = {}) {
    if (finalized || handlerTerminal || !handlerStarted) {
      markInvalid();
      return;
    }
    handlerTerminal = true;
    if (isError === true) {
      execution = { state: "handler_error", handlerInvoked: true, resultIsError: true };
      return;
    }
    execution = { state: "handler_success", handlerInvoked: true, resultIsError: false };
  }

  function handlerThrew() {
    if (!handlerStarted && !handlerTerminal && !finalized && credential.state === "verified") {
      handlerStarted = true;
    }
    handlerFinished({ isError: true });
  }

  function replayConfirmed() {
    if (finalized || handlerStarted || handlerTerminal) {
      markInvalid();
      return;
    }
    if (credential.state !== "verified") {
      markInvalid();
      return;
    }
    handlerTerminal = true;
    execution = { state: "replay_success", handlerInvoked: false, resultIsError: false };
  }

  function maybeReplayConfirmed() {
    if (finalized || handlerStarted || handlerTerminal) return;
    if (credential.state !== "verified") return;
    replayConfirmed();
  }

  function settlementFinished({ state, offerDigest } = {}) {
    if (finalized || settlementTerminal) {
      markInvalid();
      return;
    }
    if (!SETTLEMENT_STATES.has(state)) {
      markInvalid();
      return;
    }
    settlementTerminal = true;
    if (SETTLEMENT_ATTEMPTED.has(state)) {
      settlement = { state, offerDigest: offerDigest ?? null };
      return;
    }
    settlement = { state, offerDigest: null };
  }

  function observeVerifyOutcome({ isValid, skipHandler } = {}) {
    if (isValid === true) {
      credentialVerified({ offerDigest: ownedBinding.issuedOfferDigest });
      if (skipHandler) replayConfirmed();
      return;
    }
    credentialRejected();
  }

  function observeSettleOutcome({ success } = {}) {
    if (success === true) {
      settlementFinished({
        state: "succeeded",
        offerDigest: ownedBinding.issuedOfferDigest,
      });
      return;
    }
    if (success === false) {
      settlementFinished({
        state: "failed",
        offerDigest: ownedBinding.issuedOfferDigest,
      });
      return;
    }
    settlementFinished({ state: "unknown", offerDigest: null });
  }

  function observeVerifiedCancellation() {
    if (finalized || settlementTerminal) return;
    settlementFinished({ state: "not_attempted", offerDigest: null });
  }

  function overrideFinalApplicationError() {
    if (finalized) {
      markInvalid();
      return;
    }
    if (execution.state === "not_invoked") return;
    execution = { state: "handler_error", handlerInvoked: true, resultIsError: true };
    handlerTerminal = true;
  }

  function noteTransportError() {
    transportError = true;
  }

  function buildInput(overrides = {}) {
    const kind = overrides.kind
      ?? responseKind
      ?? (ownedRequest.hasId
        ? (transportError ? "transport_error" : "tool_result")
        : "no_response");
    const hasId = Object.hasOwn(overrides, "responseId")
      ? overrides.responseId !== null && overrides.responseId !== undefined
      : Boolean(responseHasId && ownedRequest.hasId);
    const id = Object.hasOwn(overrides, "responseId")
      ? (hasId ? overrides.responseId : null)
      : (hasId ? responseId : null);
    return {
      schemaVersion: INPUT_SCHEMA,
      binding: clone(ownedBinding),
      request: clone(ownedRequest),
      response: {
        hasId,
        id,
        kind,
      },
      credential: clone(credential),
      execution: clone(execution),
      settlement: clone(settlement),
    };
  }

  function finalize(overrides = {}) {
    if (finalized) return lastDecision;
    finalized = true;
    if (Object.hasOwn(overrides, "kind")) responseKind = overrides.kind;
    if (Object.hasOwn(overrides, "responseId")) {
      responseHasId = overrides.responseId !== null && overrides.responseId !== undefined;
      responseId = responseHasId ? overrides.responseId : null;
    }
    const input = buildInput(overrides);
    lastDecision = invalidReason
      ? emptyDecision(invalidReason)
      : evaluateMcpTypedTelemetryOutcome(input);
    enqueueAppend(onAppend, lastDecision);
    return lastDecision;
  }

  return {
    binding: ownedBinding,
    request: ownedRequest,
    markPaidWrapperEntered,
    bindRequestId,
    credentialRejected,
    credentialVerified,
    handlerStarted: handlerStartedTransition,
    handlerFinished,
    handlerThrew,
    replayConfirmed,
    maybeReplayConfirmed,
    settlementFinished,
    observeVerifyOutcome,
    observeSettleOutcome,
    observeVerifiedCancellation,
    overrideFinalApplicationError,
    noteTransportError,
    finalize,
  };
}

function emitCombinationHolds(value, expected) {
  if (value.result === "challenge") {
    return value.reason === "typed_payment_required"
      && value.applicationOutcome === "not_run"
      && value.handlerInvoked === false
      && value.paymentCredentialParsed === false
      && value.settlementState === "not_attempted"
      && (value.paymentPresent === true || value.paymentPresent === false);
  }
  if (!expected) {
    return value.result === "telemetry_incomplete"
      && (value.reason === "verified_without_execution" || value.reason === "settlement_outcome_unknown")
      && value.paymentPresent === true
      && value.paymentCredentialParsed === true
      && (
        (value.reason === "verified_without_execution"
          && value.handlerInvoked === false
          && value.applicationOutcome === "not_run"
          && value.settlementState === "not_attempted")
        || (value.reason === "settlement_outcome_unknown"
          && value.handlerInvoked === true
          && value.applicationOutcome === "success"
          && value.settlementState === "unknown")
      );
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) return false;
  }
  return true;
}

export function isMcpTypedTelemetryDecision(value) {
  if (!exactKeys(value, OUTPUT_KEYS)) return false;
  if (value.schemaVersion !== OUTPUT_SCHEMA) return false;
  if (!ACTIONS.has(value.action)) return false;
  if (!RESULTS.has(value.result)) return false;
  if (!REASONS.has(value.reason)) return false;
  if (!APPLICATION_OUTCOMES.has(value.applicationOutcome)) return false;
  if (!SETTLEMENT_STATES.has(value.settlementState)) return false;
  if (typeof value.paymentPresent !== "boolean") return false;
  if (typeof value.paymentCredentialParsed !== "boolean") return false;
  if (typeof value.handlerInvoked !== "boolean") return false;
  if (!exactKeys(value.binding, ["issuedOfferDigest", "productSku", "resource", "tool"])) return false;

  if (value.action === "drop") {
    if (value.result !== "invalid") return false;
    if (!DROP_REASONS.has(value.reason)) return false;
    if (value.paymentPresent !== false) return false;
    if (value.paymentCredentialParsed !== false) return false;
    if (value.handlerInvoked !== false) return false;
    if (value.applicationOutcome !== "not_run") return false;
    if (value.settlementState !== "not_attempted") return false;
    return validNullBinding(value.binding);
  }

  if (value.action !== "emit") return false;
  if (value.result === "invalid") return false;
  if (!validCatalogBinding(value.binding)) return false;
  const expected = EMIT_COMBINATIONS[value.result];
  if (expected === undefined) return false;
  return emitCombinationHolds(value, expected);
}

export {
  INPUT_SCHEMA as MCP_TYPED_TELEMETRY_INPUT_SCHEMA,
  OUTPUT_SCHEMA as MCP_TYPED_TELEMETRY_DECISION_SCHEMA,
  OFFER_SCHEMA as MCP_TYPED_ISSUED_OFFER_SCHEMA,
  OFFER_DOMAIN as MCP_TYPED_ISSUED_OFFER_DOMAIN,
  CLOSED_MCP_PRODUCTS,
};
