import { createHash } from "node:crypto";

import { probeOnce } from "../src/probe.mjs";
import { hasDisallowedKey } from "../src/privacy.mjs";

export const X402_PIN = "6b6ee91fee027b540faabcb25774e73851006c3b";
export const BINDING_SCHEMA = "samedaydesk.method-compatibility.v1";

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const BINDING_KEYS = new Set([
  "discoveringMethod",
  "intendedInvocationMethod",
  "declaredMethods",
  "acceptedMethods",
  "declaration",
  "bodyShape",
  "client",
  "freshness",
  "observations",
  "reportedRepair",
  "priorOperation",
  "localContract",
  "challengeAmount",
]);
const BODY_KEYS = new Set(["bodyType", "hasBody", "invokeWithBody", "originAgreement", "headerOnly"]);
const CLIENT_KEYS = new Set(["profile", "retry"]);
const RETRIES = new Set(["prepared_request", "declared_method", "intended_method"]);
const DECLARATION_KEYS = new Set(["source", "observedAt", "url"]);
const FRESH_KEYS = new Set(["observedAt", "expiresAt", "evaluatedAt"]);
const OBS_KEYS = new Set(["discoveringMethod", "declaredMethods", "bodyShape"]);
const PRIOR_KEYS = new Set(["resource", "method"]);
const REPAIR_KEYS = new Set([
  "provenance",
  "verifiedByUs",
  "methodDiscriminationChanged",
  "getPaymentSettled",
  "discriminator",
  "endpoints",
  "headRestrictionIsReporterPolicy",
]);
const SPEND_KEYS = new Set([
  "safetopay",
  "paymentauthorized",
  "signingauthorized",
  "spendauthorized",
  "custodyauthorized",
]);

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (plain(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function normKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function spendClaim(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => spendClaim(item, seen));
  for (const [key, child] of Object.entries(value)) {
    const name = normKey(key);
    if (SPEND_KEYS.has(name) && child === true) return true;
    if (name === "order" && child === true) return true;
    if (spendClaim(child, seen)) return true;
  }
  return false;
}

function methodToken(value, errors, label) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    errors.push(`${label} must be a string`);
    return null;
  }
  const method = value.trim().toUpperCase();
  if (!METHODS.has(method)) {
    errors.push(`${label} is not a recognized HTTP method`);
    return null;
  }
  return method;
}

function methodList(value, errors, label) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    errors.push(`${label} must be 1-8 methods when supplied`);
    return null;
  }
  const methods = [];
  for (const item of value) {
    const method = methodToken(item, errors, label);
    if (method && !methods.includes(method)) methods.push(method);
  }
  methods.sort();
  return methods;
}

function instant(value, errors, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    errors.push(`${label} must be a UTC timestamp`);
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    errors.push(`${label} must be a UTC timestamp`);
    return null;
  }
  return ms;
}

function shortText(value, errors, label, max) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    errors.push(`${label} must be a short string`);
    return null;
  }
  return value;
}

function unknownKey(value, allowed, errors, label) {
  if (!plain(value)) return;
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length) errors.push(`${label} field is not accepted: ${extra[0]}`);
}

function bodyShape(value, errors) {
  if (value == null) return null;
  if (!plain(value)) {
    errors.push("bodyShape must be an object");
    return null;
  }
  unknownKey(value, BODY_KEYS, errors, "bodyShape");
  const shape = {
    bodyType: null,
    hasBody: null,
    invokeWithBody: null,
    originAgreement: null,
    headerOnly: null,
  };
  if (value.bodyType !== undefined) {
    if (value.bodyType === null) shape.bodyType = null;
    else shape.bodyType = shortText(value.bodyType, errors, "bodyShape.bodyType", 32);
  }
  for (const key of ["hasBody", "invokeWithBody", "originAgreement", "headerOnly"]) {
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== "boolean") {
      errors.push(`bodyShape.${key} must be boolean`);
    } else if (value[key] !== undefined) shape[key] = value[key];
  }
  return shape;
}

export function validateMethodBinding(input, errors) {
  if (input == null) return null;
  if (!plain(input)) {
    errors.push("methodBinding must be an object");
    return null;
  }
  if (hasDisallowedKey(input)) {
    errors.push("methodBinding contains a restricted field");
    return null;
  }
  unknownKey(input, BINDING_KEYS, errors, "methodBinding");
  const discoveringMethod = methodToken(input.discoveringMethod, errors, "discoveringMethod");
  const intendedInvocationMethod = methodToken(input.intendedInvocationMethod, errors, "intendedInvocationMethod");
  const declaredMethods = methodList(input.declaredMethods, errors, "declaredMethods");
  const acceptedMethods = methodList(input.acceptedMethods, errors, "acceptedMethods");
  let declaration = null;
  if (input.declaration !== undefined) {
    if (!plain(input.declaration)) errors.push("declaration must be an object");
    else {
      unknownKey(input.declaration, DECLARATION_KEYS, errors, "declaration");
      declaration = {
        source: input.declaration.source === undefined ? null : shortText(input.declaration.source, errors, "declaration.source", 120),
        observedAt: input.declaration.observedAt === undefined ? null : input.declaration.observedAt,
        url: input.declaration.url === undefined ? null : shortText(input.declaration.url, errors, "declaration.url", 300),
      };
      if (input.declaration.observedAt !== undefined) instant(input.declaration.observedAt, errors, "declaration.observedAt");
    }
  }
  const shape = bodyShape(input.bodyShape, errors);
  let client = null;
  if (input.client !== undefined) {
    if (!plain(input.client)) errors.push("client must be an object");
    else {
      unknownKey(input.client, CLIENT_KEYS, errors, "client");
      const profile = input.client.profile === undefined || input.client.profile === null
        ? null
        : shortText(String(input.client.profile).toLowerCase(), errors, "client.profile", 64);
      const retry = input.client.retry === undefined || input.client.retry === null ? null : input.client.retry;
      if (retry != null && !RETRIES.has(retry)) errors.push("client.retry is not a recognized profile");
      client = { profile, retry };
    }
  }
  let freshness = null;
  if (input.freshness !== undefined) {
    if (!plain(input.freshness)) errors.push("freshness must be an object");
    else {
      unknownKey(input.freshness, FRESH_KEYS, errors, "freshness");
      freshness = {
        observedAt: input.freshness.observedAt,
        expiresAt: input.freshness.expiresAt,
        evaluatedAt: input.freshness.evaluatedAt,
      };
      const observed = instant(input.freshness.observedAt, errors, "freshness.observedAt");
      const expires = instant(input.freshness.expiresAt, errors, "freshness.expiresAt");
      const evaluated = instant(input.freshness.evaluatedAt, errors, "freshness.evaluatedAt");
      if (observed != null && expires != null && expires <= observed) errors.push("freshness window is inverted");
      freshness.observedMs = observed;
      freshness.expiresMs = expires;
      freshness.evaluatedMs = evaluated;
    }
  }
  const observations = [];
  if (input.observations !== undefined) {
    if (!Array.isArray(input.observations) || input.observations.length > 4) errors.push("observations must be a short list");
    else {
      for (const item of input.observations) {
        if (!plain(item)) {
          errors.push("observation must be an object");
          continue;
        }
        unknownKey(item, OBS_KEYS, errors, "observation");
        observations.push({
          discoveringMethod: methodToken(item.discoveringMethod, errors, "observation.discoveringMethod"),
          declaredMethods: methodList(item.declaredMethods, errors, "observation.declaredMethods"),
          bodyShape: bodyShape(item.bodyShape, errors),
        });
      }
    }
  }
  let reportedRepair = null;
  if (input.reportedRepair !== undefined) {
    if (!plain(input.reportedRepair)) errors.push("reportedRepair must be an object");
    else {
      unknownKey(input.reportedRepair, REPAIR_KEYS, errors, "reportedRepair");
      const endpoints = [];
      if (input.reportedRepair.endpoints !== undefined) {
        if (!Array.isArray(input.reportedRepair.endpoints) || input.reportedRepair.endpoints.length > 4) {
          errors.push("reportedRepair.endpoints must be a short list");
        } else {
          for (const endpoint of input.reportedRepair.endpoints) {
            const text = shortText(endpoint, errors, "reportedRepair.endpoints", 300);
            if (text) endpoints.push(text);
          }
        }
      }
      reportedRepair = {
        provenance: shortText(input.reportedRepair.provenance || "reporter", errors, "reportedRepair.provenance", 80),
        verifiedByUs: false,
        callerSaidVerified: input.reportedRepair.verifiedByUs === true,
        methodDiscriminationChanged: input.reportedRepair.methodDiscriminationChanged === true,
        getPaymentSettled: input.reportedRepair.getPaymentSettled === true,
        discriminator: input.reportedRepair.discriminator === undefined
          ? null
          : shortText(input.reportedRepair.discriminator, errors, "reportedRepair.discriminator", 80),
        endpoints,
        headRestrictionIsReporterPolicy: input.reportedRepair.headRestrictionIsReporterPolicy === true,
      };
    }
  }
  let priorOperation = null;
  if (input.priorOperation !== undefined) {
    if (!plain(input.priorOperation)) errors.push("priorOperation must be an object");
    else {
      unknownKey(input.priorOperation, PRIOR_KEYS, errors, "priorOperation");
      priorOperation = {
        resource: shortText(input.priorOperation.resource, errors, "priorOperation.resource", 200),
        method: input.priorOperation.method === undefined ? null : methodToken(input.priorOperation.method, errors, "priorOperation.method"),
      };
    }
  }
  if (input.localContract !== undefined && typeof input.localContract !== "boolean") {
    errors.push("localContract must be boolean");
  }
  let challengeAmount = null;
  if (input.challengeAmount !== undefined && input.challengeAmount !== null) {
    challengeAmount = shortText(String(input.challengeAmount), errors, "challengeAmount", 32);
  }
  if (errors.length) return null;
  return {
    discoveringMethod,
    intendedInvocationMethod,
    declaredMethods,
    acceptedMethods,
    declaration,
    bodyShape: shape,
    client,
    freshness,
    observations,
    reportedRepair,
    priorOperation,
    localContract: input.localContract === true,
    challengeAmount,
  };
}

export function validateProtocol(input, errors) {
  if (input == null) return null;
  if (!plain(input)) {
    errors.push("protocol must be an object");
    return null;
  }
  const allowed = new Set(["name", "scheme", "x402Version", "network"]);
  unknownKey(input, allowed, errors, "protocol");
  if (input.name !== undefined && input.name !== "x402") errors.push("protocol.name must be x402");
  const scheme = shortText(input.scheme, errors, "protocol.scheme", 32);
  const network = shortText(input.network, errors, "protocol.network", 64);
  if (!Number.isInteger(input.x402Version) || input.x402Version < 1 || input.x402Version > 9) {
    errors.push("protocol.x402Version must be a small integer");
  }
  if (errors.length) return null;
  return { name: "x402", scheme, x402Version: input.x402Version, network };
}

function authority() {
  return {
    safeToPay: false,
    paymentAuthorized: false,
    signingAuthorized: false,
    spendAuthorized: false,
    custodyAuthorized: false,
    order: false,
    challengeIsOrder: false,
    ourPrice: null,
    priceAuthorized: false,
    protocolForbidsMethodBody: false,
    inferredMethod: null,
    networkIsMethodResult: false,
    proposedCounterpartyRepair: false,
    paymentSent: false,
    paymentHeadersSent: [],
  };
}

function bodyWillBeSent(shape) {
  if (!shape) return false;
  return shape.invokeWithBody === true || (shape.hasBody === true && shape.invokeWithBody !== false && shape.headerOnly !== true);
}

function fetchBlocks(client, method, shape) {
  return client?.profile === "fetch" && (method === "GET" || method === "HEAD") && bodyWillBeSent(shape);
}

function declarationRelation(binding) {
  const rows = [
    { discoveringMethod: binding.discoveringMethod, declaredMethods: binding.declaredMethods },
    ...binding.observations,
  ].filter((row) => row.discoveringMethod && row.declaredMethods?.length);
  const byDiscovery = new Map();
  for (const row of rows) {
    const declared = row.declaredMethods.slice().sort().join(",");
    const previous = byDiscovery.get(row.discoveringMethod);
    if (previous && previous !== declared) return "inconsistent";
    byDiscovery.set(row.discoveringMethod, declared);
  }
  const values = [...byDiscovery.values()];
  if (byDiscovery.size >= 2 && new Set(values).size >= 2) return "follows_probe";
  return null;
}

function limitationText(reason, binding) {
  if (reason === "method_disagrees") {
    return "On this operation the client retry and the accepted or intended method do not name the same method.";
  }
  if (reason === "fetch_unsupported_get_head_body") {
    return "This Fetch profile cannot send a body on GET or HEAD. That is a client transport limit, not a protocol ban on the method.";
  }
  if (reason === "declaration_follows_probe") {
    return "Declared methods on the same resource changed with the discovering method.";
  }
  if (reason === "body_semantics_undeclared") {
    return "A body shape is present without an explicit origin agreement. The method is not inferred from that shape.";
  }
  if (reason === "header_only_resource") {
    return "The resource is header-only. Method agreement is compatibility evidence, not spend authority.";
  }
  if (reason === "origin_body_agreement") {
    return "The origin agreement covers this method and body. Agreement is still not spend authority.";
  }
  if (reason === "historical_report_not_current") {
    return "The reporter describes an earlier method disagreement and a later change. The change is unverified here, and this is not a current outage.";
  }
  if (reason === "evidence_not_current") {
    return "The capture is outside the supplied freshness window.";
  }
  if (reason === "insufficient_input") {
    return "A discovering or intended method is missing. A JSON body does not fill it in.";
  }
  if (reason === "inconsistent_evidence") return "The supplied method evidence contradicts itself.";
  if (reason === "changed_operation") return "This operation is not the prior operation. The prior disagreement does not transfer.";
  if (binding?.reportedRepair) return "Historical report only.";
  return "Method agreement is compatibility evidence, not spend authority.";
}

function correctionFor(reason) {
  if (reason === "method_disagrees") {
    return {
      declaration: "Publish the methods the resource accepts, as a property of the resource rather than of the probe that happened to ask.",
      client: "A prepared-request retry repeats the discovering method. It does not switch to another method unless the client is explicitly doing that.",
    };
  }
  if (reason === "fetch_unsupported_get_head_body") {
    return {
      declaration: "If a body is required, declare a method this client can send with a body, or state that the body is not part of the invocation.",
      client: "Fetch cannot attach a body to GET or HEAD. Do not rewrite the method to POST only because the body type is JSON.",
    };
  }
  if (reason === "declaration_follows_probe") {
    return {
      declaration: "One resource needs one invocation declaration. Two probes that each echo their own method are not a stable contract.",
      client: "Do not pay from a declaration that changes with the probe. Replay both observations before choosing a method.",
    };
  }
  if (reason === "body_semantics_undeclared") {
    return {
      declaration: "State whether this method's body is agreed content or only an echoed probe field.",
      client: "Do not invent POST from bodyType.",
    };
  }
  if (reason === "historical_report_not_current") {
    return {
      declaration: "No further server repair is proposed from this historical report.",
      client: "Supply a fresh capture if a current replay is needed. The stored report is not a payment instruction.",
    };
  }
  if (reason === "header_only_resource" || reason === "origin_body_agreement" || reason === "methods_agree" || reason === "challenge_is_not_an_order") {
    return {
      declaration: "No declaration change is required by this comparison.",
      client: "Matching methods do not authorize a signature or a payment.",
    };
  }
  return {
    declaration: "Supply the missing method, body, client, or freshness evidence.",
    client: "Do not treat a partial capture as executable.",
  };
}

function historicalComparison(binding) {
  const discovering = binding.discoveringMethod;
  const intended = binding.intendedInvocationMethod;
  const accepted = binding.acceptedMethods;
  const retry = binding.client?.retry === "prepared_request";
  const disagrees = Boolean(discovering && intended && accepted && retry && !accepted.includes(discovering));
  if (!disagrees && !(discovering && accepted && !accepted.includes(discovering))) return null;
  return {
    decision: "mismatch",
    reason: "method_disagrees",
    discoveringMethod: discovering,
    intendedInvocationMethod: intended,
    acceptedMethods: accepted,
    clientRetry: binding.client?.retry || null,
    label: binding.reportedRepair ? "reporter_claim" : "expired_capture",
    appliesNow: false,
    verifiedByUs: false,
  };
}

export function decideMethodBinding(binding, context = {}) {
  const shape = binding.bodyShape;
  const resource = context.resource || null;
  const prior = binding.priorOperation;
  const changedOperation = Boolean(prior?.resource && resource && prior.resource !== resource);
  const relation = declarationRelation(binding);
  const digestSource = {
    discoveringMethod: binding.discoveringMethod,
    intendedInvocationMethod: binding.intendedInvocationMethod,
    declaredMethods: binding.declaredMethods,
    acceptedMethods: binding.acceptedMethods,
    bodyShape: shape,
    client: binding.client,
    freshness: binding.freshness
      ? { observedAt: binding.freshness.observedAt, expiresAt: binding.freshness.expiresAt }
      : null,
    observations: binding.observations,
    priorOperation: prior,
    reportedRepair: binding.reportedRepair
      ? {
        provenance: binding.reportedRepair.provenance,
        methodDiscriminationChanged: binding.reportedRepair.methodDiscriminationChanged,
        getPaymentSettled: binding.reportedRepair.getPaymentSettled,
      }
      : null,
    resource,
  };
  const base = {
    schema: BINDING_SCHEMA,
    ...authority(),
    decision: "unknown",
    reason: "insufficient_input",
    evidenceQuality: "supplied",
    appliesNow: false,
    operationRelation: changedOperation ? "changed_operation" : "unbound",
    priorDisagreementApplies: false,
    retryOfSameOperation: false,
    discoveringMethod: binding.discoveringMethod,
    intendedInvocationMethod: binding.intendedInvocationMethod,
    declaredMethods: binding.declaredMethods,
    acceptedMethods: binding.acceptedMethods,
    limitations: [],
    historical: null,
    reportedRepair: binding.reportedRepair,
    ongoingOutage: binding.reportedRepair ? false : null,
    protocol: context.protocol || null,
    x402Pin: X402_PIN,
    challengeAmount: binding.challengeAmount,
    bindingDigest: digest(digestSource),
    exactRequest: {
      origin: context.origin || null,
      method: binding.intendedInvocationMethod,
      path: resource,
      paymentHeadersSent: [],
    },
    observedLimitation: null,
    correction: null,
    laterUse: {
      storedCaptureIsCurrent: false,
      storedDecisionIsSpendAuthority: false,
      freshDecisionWhen: [
        "discoveringMethod",
        "intendedInvocationMethod",
        "declaredMethods",
        "acceptedMethods",
        "bodyShape",
        "client",
        "operation",
        "freshness",
      ],
      failedEvidenceCannotAuthorize: true,
    },
    independentlyObserved: false,
    independentlyExecuted: false,
    retestPerformed: false,
    reproduction: {
      command: "node experiments/seller-repair-service-100266/bin/commercial-path.mjs deliver --request <caller-request.json>",
      coldCommand: "node package/bin/caller-deliver.mjs deliver --request request.json",
      hosted: false,
      evidenceClass: context.evidenceClass || "caller_supplied",
    },
  };

  const inconsistentBody = Boolean(shape && (
    (shape.headerOnly === true && shape.invokeWithBody === true)
    || (shape.headerOnly === true && shape.hasBody === true)
    || (shape.hasBody === false && shape.invokeWithBody === true)
  ));
  if (relation === "inconsistent" || inconsistentBody) {
    base.decision = "unknown";
    base.reason = "inconsistent_evidence";
    base.evidenceQuality = "inconsistent";
    base.observedLimitation = limitationText(base.reason, binding);
    base.correction = correctionFor(base.reason);
    return base;
  }

  const fresh = binding.freshness;
  if (fresh?.expiresMs != null && fresh.evaluatedMs != null && fresh.evaluatedMs > fresh.expiresMs) {
    base.decision = "unknown";
    base.reason = "evidence_not_current";
    base.evidenceQuality = "expired";
    base.historical = historicalComparison(binding);
    base.observedLimitation = limitationText(base.reason, binding);
    base.correction = correctionFor(base.reason);
    return base;
  }

  if (binding.reportedRepair) {
    base.decision = "unknown";
    base.reason = "historical_report_not_current";
    base.evidenceQuality = "historical";
    base.appliesNow = false;
    base.ongoingOutage = false;
    base.historical = historicalComparison(binding);
    base.observedLimitation = limitationText(base.reason, binding);
    base.correction = correctionFor(base.reason);
    if (binding.reportedRepair.callerSaidVerified) base.limitations.push("reporter_verification_not_accepted");
    if (binding.reportedRepair.headRestrictionIsReporterPolicy) {
      base.limitations.push("head_restriction_is_reporter_policy");
    }
    return base;
  }

  const discovering = binding.discoveringMethod;
  const intended = binding.intendedInvocationMethod;
  if (!discovering || !intended) {
    base.decision = "unknown";
    base.reason = "insufficient_input";
    base.evidenceQuality = "partial";
    base.observedLimitation = limitationText(base.reason, binding);
    base.correction = correctionFor(base.reason);
    return base;
  }

  if (changedOperation) {
    base.operationRelation = "changed_operation";
    base.priorDisagreementApplies = false;
  }

  const retry = binding.client?.retry === "prepared_request";
  const acceptedMiss = binding.acceptedMethods && !binding.acceptedMethods.includes(discovering);
  const intendedMiss = binding.acceptedMethods && !binding.acceptedMethods.includes(intended);
  const declaredMiss = binding.declaredMethods && !binding.declaredMethods.includes(intended);
  if (discovering !== intended || (retry && acceptedMiss) || intendedMiss || declaredMiss) {
    base.decision = "mismatch";
    base.reason = "method_disagrees";
    base.operationRelation = changedOperation ? "changed_operation" : "same_operation_retry";
    base.priorDisagreementApplies = false;
    base.retryOfSameOperation = !changedOperation && (retry || discovering !== intended);
    base.appliesNow = true;
    base.observedLimitation = limitationText(base.reason, binding);
    base.correction = correctionFor(base.reason);
    if (changedOperation) base.limitations.push("changed_operation");
    if (fetchBlocks(binding.client, discovering, shape)) base.limitations.push("fetch_unsupported_get_head_body");
    return base;
  }

  if (relation === "follows_probe") {
    base.decision = "mismatch";
    base.reason = "declaration_follows_probe";
    base.operationRelation = changedOperation ? "changed_operation" : "same_resource";
    base.appliesNow = true;
    if (fetchBlocks(binding.client, intended, shape)) base.limitations.push("fetch_unsupported_get_head_body");
    base.observedLimitation = limitationText(base.reason, binding);
    base.correction = correctionFor(base.reason);
    return base;
  }

  if (fetchBlocks(binding.client, intended, shape)) {
    base.decision = "mismatch";
    base.reason = "fetch_unsupported_get_head_body";
    base.appliesNow = true;
    base.limitations.push("fetch_unsupported_get_head_body");
    base.observedLimitation = limitationText(base.reason, binding);
    base.correction = correctionFor(base.reason);
    return base;
  }

  if (shape?.headerOnly === true) {
    base.decision = "compatible";
    base.reason = "header_only_resource";
    base.appliesNow = fresh ? true : false;
    base.evidenceQuality = fresh ? "supplied" : "freshness_unspecified";
    base.observedLimitation = limitationText(base.reason, binding);
    base.correction = correctionFor(base.reason);
    if (context.httpStatus === 402) base.limitations.push("challenge_is_not_an_order");
    return base;
  }

  const bodyDeclared = Boolean(shape && (shape.hasBody === true || shape.bodyType));
  if (bodyDeclared && shape.originAgreement !== true) {
    base.decision = "unknown";
    base.reason = "body_semantics_undeclared";
    base.evidenceQuality = "partial";
    base.observedLimitation = limitationText(base.reason, binding);
    base.correction = correctionFor(base.reason);
    return base;
  }

  if (bodyDeclared && shape.originAgreement === true) {
    base.decision = "compatible";
    base.reason = "origin_body_agreement";
    base.appliesNow = Boolean(fresh);
    base.evidenceQuality = fresh ? "supplied" : "freshness_unspecified";
    base.observedLimitation = limitationText(base.reason, binding);
    base.correction = correctionFor(base.reason);
    if (context.httpStatus === 402) base.limitations.push("challenge_is_not_an_order");
    return base;
  }

  base.decision = "compatible";
  base.reason = context.httpStatus === 402 ? "challenge_is_not_an_order" : "methods_agree";
  base.appliesNow = Boolean(fresh);
  base.evidenceQuality = fresh ? "supplied" : "freshness_unspecified";
  if (changedOperation) base.limitations.push("changed_operation");
  if (context.httpStatus === 402) base.limitations.push("challenge_is_not_an_order");
  base.observedLimitation = limitationText(base.reason, binding);
  base.correction = correctionFor(base.reason);
  return base;
}

export function sealSupplied(decision) {
  return {
    ...decision,
    ...authority(),
    independentlyObserved: false,
    independentlyExecuted: false,
    retestPerformed: false,
    challengeAmount: decision.challengeAmount,
    protocol: decision.protocol,
  };
}

export function sealFailedProbe(decision, reason) {
  const quality = reason === "probe_budget" ? "partial" : "failed";
  return {
    ...decision,
    ...authority(),
    decision: "unknown",
    reason,
    evidenceQuality: quality,
    appliesNow: false,
    independentlyObserved: false,
    independentlyExecuted: false,
    retestPerformed: false,
    suppliedDecision: {
      decision: decision.decision,
      reason: decision.reason,
      appliesNow: false,
    },
    observedLimitation: "The live retest did not finish, so the supplied comparison is not executed evidence.",
    challengeAmount: decision.challengeAmount,
    protocol: decision.protocol,
    bindingDigest: decision.bindingDigest,
    exactRequest: decision.exactRequest,
    laterUse: decision.laterUse,
    reproduction: decision.reproduction,
    correction: decision.correction,
    limitations: decision.limitations,
    historical: decision.historical,
    reportedRepair: decision.reportedRepair,
  };
}

export function sealCompletedProbe(decision) {
  const executed = decision.decision === "compatible" || decision.decision === "mismatch";
  return {
    ...decision,
    ...authority(),
    evidenceQuality: "loopback",
    retestPerformed: true,
    independentlyObserved: true,
    independentlyExecuted: executed,
    challengeAmount: decision.challengeAmount,
    protocol: decision.protocol,
  };
}

export async function probeMethodContract({ baseUrl, resource, methods, limits }) {
  const seen = [];
  let bodyBytes = 0;
  let probes = 0;
  for (const method of methods) {
    if (probes >= limits.probes) {
      return { partial: true, reason: "probe_budget", probes, bodyBytes, seen };
    }
    const result = await probeOnce({
      baseUrl,
      method,
      route: resource,
      deadlineMs: limits.deadlineMs,
      bodyBytes: limits.bodyBytes,
    });
    probes += 1;
    bodyBytes += result.bytesSeen || 0;
    seen.push({
      method,
      status: result.status,
      reason: result.reason || null,
      paymentSent: result.paymentSent === true,
    });
    if (result.bodyDeadline || result.reason === "body_deadline") {
      return { partial: true, reason: "body_deadline", probes, bodyBytes, seen };
    }
    if (result.bodyCeiling || result.reason === "body_ceiling") {
      return { partial: true, reason: "body_ceiling", probes, bodyBytes, seen };
    }
    if (result.privateSentinel) {
      return { partial: true, reason: "private_body", probes, bodyBytes, seen };
    }
    if (bodyBytes > limits.totalBodyBytes) {
      return { partial: true, reason: "body_ceiling", probes, bodyBytes, seen };
    }
  }
  return { partial: false, reason: null, probes, bodyBytes, seen };
}
