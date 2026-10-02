import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PAID_PRICE_ATOMIC, PAID_PRICE_DISPLAY, PAID_PRODUCT, PAID_ROUTE } from "../src/constants.mjs";
import { normalizeIntake, taskDigest } from "../src/intake.mjs";
import { runJourney } from "../src/journey.mjs";
import { observationFromEvidence } from "../src/probe.mjs";
import { assessPublicOrigin, publicOriginShape } from "../src/public-target.mjs";
import {
  CALLER_REGRESSION_SCHEMA,
  consumeLaterArtifact,
  REGRESSION_SCHEMA,
} from "./later-consumer.mjs";
import { MAINTAINED_INSPECTION } from "./maintained.mjs";
import {
  decideMethodBinding,
  probeMethodContract,
  sealCompletedProbe,
  sealFailedProbe,
  sealSupplied,
  spendClaim,
  validateMethodBinding,
  validateProtocol,
} from "./method-binding.mjs";

const SOURCE_SHA = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
const COMMAND = "node experiments/seller-repair-service-100266/bin/commercial-path.mjs";

const CONTROL_KEYS = new Set([
  "socket",
  "lookup",
  "lookupImpl",
  "rejectUnauthorized",
  "fixtureMode",
  "retestSocket",
  "standIn",
  "tlsBypass",
  "x-fixture-mode",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DELIVER_HELP = [
  "deliver_request_required",
  "deliver reads one bounded caller request from --request <file> or --request - (stdin).",
  "Required: callerId, task (40-4000 characters), origin, operation (GET /exact-path), sdk, runtime,",
  "expect.path, expect.value, limits.probes, limits.bodyBytes, limits.deadlineMs, limits.totalBodyBytes,",
  "limits.totalResponseMs, limits.outputBytes, and either observed or probeConsent.",
  "probeConsent.class is loopback or public-https, and confirmed must be true.",
  "loopback requires probeConsent.baseUrl http://127.0.0.1:<port>. public-https probes the named origin.",
  "Optional retest.baseUrl or retest.observed is caller-owned and does not deploy a counterparty repair.",
  "A supplied observation is not an independent probe. Missing input does not fabricate a completed task.",
  "Optional methodBinding sits beside operation and protocol (scheme, x402Version, network).",
  "It records the discovering method, the intended method, declared and accepted methods, body shape, client retry, and freshness.",
  "Method agreement is compatibility evidence. It is not spend authority. There is no default capture.",
  `The disposable QA fixture is: ${COMMAND} self-test`,
].join("\n");

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function controlKey(value) {
  if (!plain(value)) return null;
  return Object.keys(value).find((key) => CONTROL_KEYS.has(key)) || null;
}

function integer(value, label, min, max, errors) {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${label} must be an integer from ${min} to ${max}`);
    return null;
  }
  return value;
}

function loopbackBase(value) {
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return url.origin;
}

function operationOf(value, errors) {
  if (typeof value !== "string" || !/^(GET)\s+(\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+)$/.test(value)) {
    errors.push("operation must be GET and one exact path");
    return null;
  }
  const resource = value.slice(4);
  if (resource.includes("{") || resource.includes("?") || resource.includes("#")) {
    errors.push("operation must be one exact path");
    return null;
  }
  return { method: "GET", resource, operationId: `GET ${resource}` };
}

export function validateCallerRequest(input) {
  const errors = [];
  if (!plain(input)) return { ok: false, reason: "request_malformed", errors: ["request must be a JSON object"] };
  if (spendClaim(input)) {
    return { ok: false, reason: "seeded_spend_claim", errors: ["a caller safeToPay, payment, signing, or order flag is not accepted"] };
  }
  const leak = controlKey(input) || controlKey(input.probeConsent) || controlKey(input.retest) || controlKey(input.limits);
  if (leak) return { ok: false, reason: "fixture_transport_refused", errors: [`${leak} is not accepted on a caller request`] };
  if (input.schema !== undefined && input.schema !== "samedaydesk.seller-repair-caller-request.v1") {
    errors.push("schema must be samedaydesk.seller-repair-caller-request.v1");
  }
  if (typeof input.callerId !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.callerId)) errors.push("callerId is invalid");
  if (typeof input.task !== "string" || input.task.trim().length < 40 || input.task.length > 4000 || /[\u0000-\u001f\u007f]/.test(input.task)) {
    errors.push("task must be 40-4000 characters without control characters");
  }
  if (typeof input.origin !== "string" || !input.origin) errors.push("origin is required");
  const operation = operationOf(input.operation, errors);
  if (typeof input.sdk !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.+_@/-]{1,63}$/.test(input.sdk)) errors.push("sdk is required");
  if (typeof input.runtime !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.+_@/-]{1,63}$/.test(input.runtime)) errors.push("runtime is required");
  if (!plain(input.expect) || typeof input.expect.path !== "string" || !("value" in input.expect)) {
    errors.push("expect must name a path and a value");
  } else if (typeof input.expect.value !== "boolean" && (typeof input.expect.value !== "string" || input.expect.value.length < 1 || input.expect.value.length > 128)) {
    errors.push("expect.value must be a boolean or a short string");
  }
  const limits = plain(input.limits) ? input.limits : null;
  if (!limits) errors.push("limits are required");
  const probes = limits ? integer(limits.probes, "limits.probes", 1, 8, errors) : null;
  const bodyBytes = limits ? integer(limits.bodyBytes, "limits.bodyBytes", 1, 65536, errors) : null;
  const deadlineMs = limits ? integer(limits.deadlineMs, "limits.deadlineMs", 20, 5000, errors) : null;
  const totalBodyBytes = limits ? integer(limits.totalBodyBytes, "limits.totalBodyBytes", 1, 524288, errors) : null;
  const totalResponseMs = limits ? integer(limits.totalResponseMs, "limits.totalResponseMs", 20, 20000, errors) : null;
  const outputBytes = limits ? integer(limits.outputBytes, "limits.outputBytes", 512, 262144, errors) : null;
  if (limits && limits.redirects !== undefined && limits.redirects !== 0) errors.push("limits.redirects must be 0");
  if (limits && probes !== null && totalBodyBytes !== null && bodyBytes !== null && totalBodyBytes < bodyBytes) {
    errors.push("limits.totalBodyBytes must cover limits.bodyBytes");
  }
  if (limits && deadlineMs !== null && totalResponseMs !== null && totalResponseMs < deadlineMs) {
    errors.push("limits.totalResponseMs must cover limits.deadlineMs");
  }
  const observed = input.observed === undefined ? null : input.observed;
  const consent = input.probeConsent === undefined ? null : input.probeConsent;
  if (observed && consent) errors.push("supply observed or probeConsent, not both");
  if (!observed && !consent) errors.push("observed or probeConsent is required");
  if (observed) {
    if (!plain(observed) || !Number.isInteger(observed.status)) errors.push("observed.status is required");
    else if (observed.json !== undefined && !plain(observed.json)) errors.push("observed.json must be an object");
  }
  let baseUrl = null;
  if (consent) {
    if (!plain(consent) || consent.confirmed !== true) errors.push("probeConsent.confirmed must be true");
    if (consent?.class !== "loopback" && consent?.class !== "public-https") errors.push("probeConsent.class must be loopback or public-https");
    if (consent?.class === "loopback") {
      baseUrl = loopbackBase(consent.baseUrl);
      if (!baseUrl) errors.push("loopback probeConsent.baseUrl must be http://127.0.0.1:<port>");
    }
    if (consent?.class === "public-https" && consent.baseUrl !== undefined) {
      errors.push("public-https probes the named origin and does not accept another baseUrl");
    }
  }
  let retest = null;
  if (input.retest !== undefined) {
    if (!plain(input.retest)) errors.push("retest must be an object");
    else {
      retest = {};
      if (input.retest.baseUrl !== undefined) {
        if (!consent) errors.push("a live retest requires probeConsent");
        if (consent?.class === "loopback") {
          retest.baseUrl = loopbackBase(input.retest.baseUrl);
          if (!retest.baseUrl) errors.push("retest.baseUrl must be http://127.0.0.1:<port>");
        } else if (consent?.class === "public-https") {
          if (input.retest.baseUrl !== input.origin) errors.push("a public retest must use the same origin");
          retest.baseUrl = input.origin;
        }
      }
      if (input.retest.observed !== undefined) {
        if (!plain(input.retest.observed) || !plain(input.retest.observed.json)) errors.push("retest.observed.json must be an object");
        else retest.observed = input.retest.observed;
      }
      if (!retest.baseUrl && !retest.observed) errors.push("retest needs a caller-owned baseUrl or observed body");
    }
  }
  if (input.producer !== undefined) {
    if (!plain(input.producer)) errors.push("producer must be an object");
    else if (input.producer.commerceEventId !== undefined && (typeof input.producer.commerceEventId !== "string" || !UUID.test(input.producer.commerceEventId))) {
      errors.push("producer.commerceEventId must be a uuid supplied by the producer");
    }
  }
  if (input.patch !== undefined && !plain(input.patch)) errors.push("patch must be an object");
  const methodBinding = input.methodBinding === undefined ? null : validateMethodBinding(input.methodBinding, errors);
  const protocol = input.protocol === undefined ? null : validateProtocol(input.protocol, errors);
  if (methodBinding?.localContract && consent?.class !== "loopback") {
    errors.push("a method contract probe requires loopback consent");
  }
  if (errors.length) return { ok: false, reason: "request_invalid", errors };
  return {
    ok: true,
    request: {
      callerId: input.callerId,
      task: input.task,
      origin: input.origin,
      operation,
      sdk: input.sdk,
      runtime: input.runtime,
      expect: { path: input.expect.path, value: input.expect.value },
      limits: {
        probes,
        bodyBytes,
        deadlineMs,
        totalBodyBytes,
        totalResponseMs,
        redirects: 0,
        outputBytes,
      },
      observed,
      probeConsent: consent ? { class: consent.class, confirmed: true, baseUrl } : null,
      retest,
      patch: input.patch || null,
      question: input.question || "useful_output",
      paidIntent: input.paidIntent === true,
      producerEventId: input.producer?.commerceEventId || null,
      methodBinding,
      protocol,
      inputsSha256: sha256(JSON.stringify(input)),
    },
  };
}

export function isBoundedCallerRequest(input) {
  return plain(input)
    && typeof input.operation === "string"
    && plain(input.expect)
    && plain(input.limits)
    && (input.observed !== undefined || input.probeConsent !== undefined);
}

function refused(reason, extra = {}) {
  return {
    ok: false,
    executed: false,
    exitCode: 2,
    help: reason === "deliver_request_required" || reason === "request_malformed" || reason === "request_invalid",
    reason,
    probed: false,
    executionClass: "none",
    receipt: {
      ok: false,
      executed: false,
      help: reason === "deliver_request_required" || reason === "request_malformed" || reason === "request_invalid",
      reason,
      errors: extra.errors || [],
      charged: false,
      paymentSent: false,
      order: false,
      safeToPay: false,
      paymentAuthorized: false,
      signingAuthorized: false,
      purchaseRecommended: false,
      recognizedRevenueAtomic: "0",
      mode: "caller",
      qa: false,
      visitorExecution: false,
      fixtureTransport: false,
    },
    artifact: null,
  };
}

function engineIntake(request, consent) {
  const intake = {
    callerId: request.callerId,
    task: request.task,
    origin: request.origin,
    method: "GET",
    resource: request.operation.resource,
    operation: {
      method: "GET",
      resource: request.operation.resource,
      operationId: request.operation.operationId,
    },
    expectedUsefulOutput: {
      paths: [request.expect.path],
      equals: { path: request.expect.path, value: request.expect.value },
    },
    declaredSdk: request.sdk,
    declaredRuntime: request.runtime,
    maxEffort: {
      probes: request.limits.probes,
      bodyBytes: request.limits.bodyBytes,
      deadlineMs: request.limits.deadlineMs,
      totalBodyBytes: request.limits.totalBodyBytes,
      totalResponseMs: request.limits.totalResponseMs,
      redirects: 0,
    },
    // Evidence mode still has to satisfy the journey intake, which requires a
    // consent object. The receipt records consentSupplied false and does not probe.
    probeConsent: consent || { class: "public-https", confirmed: true },
    question: request.question,
    paidIntent: false,
  };
  if (request.observed) {
    intake.callerEvidence = {
      observed: {
        status: request.observed.status,
        json: request.observed.json,
        contentType: request.observed.contentType || "application/json",
      },
    };
  }
  if (request.patch) intake.patch = request.patch;
  return intake;
}

function paidView(journey) {
  return {
    product: PAID_PRODUCT,
    route: PAID_ROUTE,
    priceDisplay: PAID_PRICE_DISPLAY,
    priceAtomic: PAID_PRICE_ATOMIC,
    separatedFromFreeComparison: true,
    usefulDelta: journey?.paidAudit?.usefulDelta === true,
    answersUsefulOutput: false,
    purchaseRecommended: false,
    purchasePerformed: false,
    order: false,
    connected: journey?.paidAudit?.connected === true,
    gap: journey?.paidAudit?.gap || "paid_report_not_supplied",
  };
}

function leaf(values, path) {
  const value = values?.[path];
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  return null;
}

function suppliedRetest(request, beforeValues) {
  if (!request.retest?.observed) return null;
  const observed = observationFromEvidence({
    resource: request.operation.resource,
    method: "GET",
    callerEvidence: { observed: request.retest.observed },
  });
  const path = request.expect.path;
  const before = leaf(beforeValues, path);
  const after = leaf(observed?.values, path);
  return {
    class: "caller_supplied",
    independentlyObserved: false,
    callerSupplied: true,
    deployedCounterpartyRepair: false,
    counterpartyMutated: false,
    useful: false,
    reason: "caller_supplied_comparison",
    suppliedAfterMatches: after === request.expect.value,
    changedOutput: { path, before, after, changed: before !== after },
  };
}

function liveRetest(journey, request) {
  const repair = journey?.repair;
  if (!repair && !request.retest?.baseUrl) return null;
  const path = request.expect.path;
  const before = repair?.changedOutput?.before ?? leaf(journey?.observed?.values, path);
  const after = repair?.changedOutput?.after ?? null;
  return {
    class: repair?.class || "caller_reviewed_retest",
    independentlyObserved: repair ? journey?.observation?.independentlyObserved === true : false,
    callerSupplied: false,
    deployedCounterpartyRepair: false,
    counterpartyMutated: false,
    useful: repair?.useful === true,
    reason: repair?.reason || "retest_not_observed",
    changedOutput: {
      path,
      before,
      after,
      changed: before !== after,
    },
  };
}

function envelope({ request, journey, retest, executionMs, probes, bodyBytes, executionClass, limitReason = null, methodCompatibility = null }) {
  const classification = journey?.classification || {
    useful: false,
    reason: limitReason,
    outcome: "unknown",
    http200IsSuccess: false,
  };
  const causalId = request.producerEventId || "unbound";
  const paid = paidView(journey);
  const target402 = classification.reason === "paid_body_not_read";
  const missingField = classification.reason === "missing_field_not_paid_demand";
  return {
    schema: "samedaydesk.seller-repair-caller-receipt.v1",
    ok: true,
    executed: true,
    help: false,
    charged: false,
    paymentSent: false,
    order: false,
    purchaseRecommended: false,
    priceChanged: false,
    skuAdded: false,
    recognizedRevenueAtomic: "0",
    mode: "caller",
    qa: false,
    visitorExecution: true,
    fixtureTransport: false,
    tlsBypass: false,
    standInResponse: false,
    callerId: request.callerId,
    taskDigest: journey?.taskDigest || taskDigest(request.task),
    operationId: request.operation.operationId,
    declaredSdk: request.sdk,
    declaredRuntime: request.runtime,
    target: journey?.target || { origin: request.origin, method: "GET", resource: request.operation.resource },
    expected: { path: request.expect.path, value: request.expect.value },
    inputsSha256: request.inputsSha256,
    consentSupplied: Boolean(request.probeConsent),
    observation: {
      source: executionClass === "live" ? "live" : "caller_supplied",
      independentlyObserved: executionClass === "live" && journey?.observation?.independentlyObserved === true,
      executionClass,
      http200IsSuccess: false,
    },
    classification: {
      useful: classification.useful === true,
      reason: classification.reason,
      outcome: classification.outcome,
      http200IsSuccess: false,
      limited: Boolean(limitReason) || classification.useful !== true,
    },
    retest,
    ...(methodCompatibility ? { methodCompatibility } : {}),
    paid,
    target402IsOrder: false,
    missingFieldIsPaidDelta: false,
    target402: target402 === true,
    missingField: missingField === true,
    causal: {
      commerceEventId: causalId,
      bound: request.producerEventId !== null,
      source: request.producerEventId ? "producer" : "unbound",
      authority: false,
      proofClass: "none",
    },
    resources: {
      latencyMs: executionMs,
      probes,
      bodyBytes,
      budgets: request.limits,
      cash: { atomic: "0", known: true, countsAsCash: true },
      modelCost: "unknown",
      reviewCost: "unknown",
      tokens: "unknown",
    },
    provenance: {
      package: "seller-repair-service-100266",
      source: "experiments/seller-repair-service-100266/commercial/caller-request.mjs",
      sourceSha256: SOURCE_SHA,
      license: "MIT",
      copyright: "Copyright (c) 2026 SameDayDesk",
      runtime: process.version,
      maintained: MAINTAINED_INSPECTION,
      command: `${COMMAND} deliver --request <caller-request.json>`,
    },
  };
}

function boundOutput(receipt, limit) {
  const encoded = Buffer.from(JSON.stringify(receipt));
  if (encoded.length <= limit) {
    return { receipt, outputBytes: encoded.length, limited: false };
  }
  const short = {
    ok: true,
    executed: true,
    reason: "output_ceiling",
    useful: false,
    operationId: receipt.operationId,
    outputBytes: encoded.length,
    limit,
    charged: false,
    paymentSent: false,
    order: false,
    purchaseRecommended: false,
    fixtureTransport: false,
    recognizedRevenueAtomic: "0",
    modelCost: "unknown",
    cashAtomic: "0",
  };
  return { receipt: short, outputBytes: encoded.length, limited: true };
}

function artifactFrom(receipt, retest) {
  return {
    schema: CALLER_REGRESSION_SCHEMA,
    trusted: false,
    hashIsExecution: false,
    usefulTransferred: false,
    paymentPermitted: false,
    deployedCounterpartyRepair: false,
    recognizedRevenueAtomic: "0",
    callerId: receipt.callerId,
    taskDigest: receipt.taskDigest,
    operationId: receipt.operationId,
    declaredSdk: receipt.declaredSdk,
    target: receipt.target,
    expected: receipt.expected,
    mode: "caller",
    qa: false,
    visitorExecution: true,
    fixtureTransport: false,
    inputsSha256: receipt.inputsSha256,
    provenance: receipt.provenance,
    execution: {
      command: receipt.provenance.command,
      outcome: receipt.classification?.outcome || receipt.reason || null,
      reason: receipt.classification?.reason || receipt.reason || null,
      useful: receipt.classification?.useful === true,
      executionClass: receipt.observation?.executionClass || "none",
      independentlyObserved: receipt.observation?.independentlyObserved === true,
      probes: receipt.resources?.probes ?? 0,
      bodyBytes: receipt.resources?.bodyBytes ?? 0,
      latencyMs: receipt.resources?.latencyMs ?? null,
      redirectsFollowed: 0,
    },
    retest: retest || { deployedCounterpartyRepair: false, counterpartyMutated: false, useful: false },
    ...(receipt.methodCompatibility ? { methodCompatibility: receipt.methodCompatibility } : {}),
    causal: receipt.causal,
    paid: receipt.paid,
    resources: receipt.resources,
    laterCommand: `${COMMAND} later --artifact <regression.json> --caller <caller.json>`,
  };
}

function limitResult(request, reason, executionMs) {
  const journey = { classification: { useful: false, reason, outcome: "unknown", http200IsSuccess: false }, taskDigest: taskDigest(request.task) };
  const receipt = envelope({
    request,
    journey,
    retest: null,
    executionMs,
    probes: 0,
    bodyBytes: 0,
    executionClass: "none",
    limitReason: reason,
  });
  const bounded = boundOutput(receipt, request.limits.outputBytes);
  return {
    ok: true,
    executed: true,
    exitCode: 0,
    help: false,
    reason,
    probed: false,
    executionClass: "none",
    receipt: bounded.receipt,
    artifact: bounded.limited ? null : artifactFrom(receipt, null),
  };
}

async function executeLocalMethodContract(request, started) {
  const discovering = request.methodBinding.discoveringMethod;
  const intended = request.methodBinding.intendedInvocationMethod;
  const methods = [];
  if (discovering && discovering !== intended) methods.push(discovering);
  if (intended) methods.push(intended);
  if (!methods.length) methods.push(request.operation.method);
  const probed = await probeMethodContract({
    baseUrl: request.probeConsent.baseUrl,
    resource: request.operation.resource,
    methods,
    limits: request.limits,
  });
  const supplied = decideMethodBinding(request.methodBinding, {
    origin: request.origin,
    resource: request.operation.resource,
    protocol: request.protocol,
    httpStatus: probed.seen.at(-1)?.status ?? null,
    evidenceClass: "loopback_probe",
  });
  const methodCompatibility = probed.partial ? sealFailedProbe(supplied, probed.reason) : sealCompletedProbe(supplied);
  const journey = {
    classification: {
      useful: false,
      reason: methodCompatibility.reason,
      outcome: "unknown",
      http200IsSuccess: false,
    },
    taskDigest: taskDigest(request.task),
    target: { origin: request.origin, method: request.operation.method, resource: request.operation.resource },
    observation: { independentlyObserved: methodCompatibility.independentlyObserved === true },
    metrics: { callerEffort: { probes: probed.probes, bodyBytes: probed.bodyBytes } },
  };
  const retest = {
    class: "loopback_method_contract",
    independentlyObserved: methodCompatibility.independentlyObserved === true,
    callerSupplied: false,
    deployedCounterpartyRepair: false,
    counterpartyMutated: false,
    useful: false,
    reason: probed.reason || methodCompatibility.reason,
    changedOutput: {
      path: request.expect.path,
      before: probed.seen[0]?.status ?? null,
      after: probed.seen.at(-1)?.status ?? null,
      changed: probed.seen.length > 1 && probed.seen[0]?.status !== probed.seen.at(-1)?.status,
    },
    probes: probed.seen,
    paymentHeadersSent: [],
  };
  const receipt = envelope({
    request,
    journey,
    retest,
    executionMs: Date.now() - started,
    probes: probed.probes,
    bodyBytes: probed.bodyBytes,
    executionClass: "live",
    methodCompatibility,
  });
  const bounded = boundOutput(receipt, request.limits.outputBytes);
  return {
    ok: true,
    executed: true,
    exitCode: 0,
    help: false,
    reason: bounded.limited ? "output_ceiling" : methodCompatibility.reason,
    probed: probed.probes > 0,
    executionClass: "live",
    receipt: bounded.receipt,
    artifact: bounded.limited ? null : artifactFrom(receipt, retest),
  };
}

export async function executeCallerRequest(input) {
  const parsed = validateCallerRequest(input);
  if (!parsed.ok) return refused(parsed.reason, { errors: parsed.errors });
  const request = parsed.request;
  const catalogOrigin = request.origin === "https://seller.example";
  const catalogPath = request.operation.resource === "/catalog/item";
  const catalogValue = request.expect.value === "WIDGET-1";
  if (catalogOrigin && catalogPath && catalogValue) {
    return refused("fixed_example_is_not_caller_task");
  }
  const started = Date.now();
  if (request.methodBinding?.localContract) {
    return executeLocalMethodContract(request, started);
  }
  if (request.probeConsent?.class === "public-https") {
    const shape = publicOriginShape(request.origin);
    if (!shape.ok) return limitResult(request, shape.reason, Date.now() - started);
    const decision = await assessPublicOrigin(request.origin);
    if (!decision.ok) return limitResult(request, decision.reason, Date.now() - started);
  }
  const consent = request.probeConsent
    ? { class: request.probeConsent.class, confirmed: true }
    : null;
  const intake = engineIntake(request, consent);
  try {
    normalizeIntake(intake);
  } catch (error) {
    return refused("request_invalid", { errors: [error.message] });
  }
  const live = Boolean(request.probeConsent);
  let journey;
  try {
    journey = await runJourney({
      intake,
      baseUrl: live && request.probeConsent.class === "loopback" ? request.probeConsent.baseUrl : request.origin,
      retestBaseUrl: live ? request.retest?.baseUrl || null : null,
      live: live ? "auto" : "evidence",
    });
  } catch (error) {
    return refused("request_invalid", { errors: [error.message] });
  }
  const executionClass = live ? "live" : "caller_supplied";
  const retest = live ? liveRetest(journey, request) : suppliedRetest(request, journey?.observed?.values);
  if (!live && request.retest?.observed && retest) {
    retest.independentlyObserved = false;
  }
  const probes = journey.metrics?.callerEffort?.probes || 0;
  const bodyBytes = journey.metrics?.callerEffort?.bodyBytes || 0;
  const methodCompatibility = request.methodBinding
    ? sealSupplied(decideMethodBinding(request.methodBinding, {
      origin: request.origin,
      resource: request.operation.resource,
      protocol: request.protocol,
      httpStatus: request.observed?.status || journey?.observed?.status || null,
      evidenceClass: "caller_supplied",
    }))
    : null;
  const receipt = envelope({
    request,
    journey,
    retest,
    executionMs: Date.now() - started,
    probes,
    bodyBytes,
    executionClass,
    methodCompatibility,
  });
  const bounded = boundOutput(receipt, request.limits.outputBytes);
  return {
    ok: true,
    executed: true,
    exitCode: 0,
    help: false,
    reason: bounded.limited ? "output_ceiling" : journey.classification?.reason || null,
    probed: live && probes > 0,
    executionClass: bounded.limited ? executionClass : executionClass,
    receipt: bounded.receipt,
    artifact: bounded.limited ? null : artifactFrom(receipt, retest),
  };
}

function predicateOf(artifact, caller, receipt) {
  const expectValue = caller.expectValue !== undefined ? caller.expectValue : caller.expect?.value;
  const resource = caller.resource || (typeof caller.operation === "string" ? caller.operation.split(" ")[1] : caller.operation?.resource);
  const method = caller.method || "GET";
  const origin = caller.origin;
  const sdk = caller.sdk || caller.declaredSdk;
  const digest = receipt?.taskDigest || (typeof caller.task === "string" ? taskDigest(caller.task) : caller.taskDigest);
  const same = digest === artifact.taskDigest
    && sdk === artifact.declaredSdk
    && origin === artifact.target?.origin
    && method === artifact.target?.method
    && resource === artifact.target?.resource
    && expectValue === artifact.expected?.value;
  if (!same) return { applies: false, reason: "stale_applicability" };
  const priorDigest = artifact.methodCompatibility?.bindingDigest || null;
  const nextDigest = receipt?.methodCompatibility?.bindingDigest || null;
  if (priorDigest !== nextDigest) return { applies: false, reason: "changed_method_binding" };
  const owner = caller.callerId;
  if (typeof owner === "string" && owner !== artifact.callerId) return { applies: false, reason: "wrong_owner" };
  return { applies: true, reason: "fresh_execution" };
}

async function retentionDecision(artifact, caller) {
  if (!artifact?.retention?.contribution) return null;
  let replayContribution;
  try {
    ({ replayContribution } = await import("../src/contribution.mjs"));
  } catch {
    return { available: false, reason: "retention_adapter_unavailable", usefulTransferred: false };
  }
  const replay = replayContribution({
    contribution: artifact.retention.contribution,
    corrections: artifact.retention.corrections || [],
    revocations: artifact.retention.revocations || [],
    now: Number.isFinite(caller.now) ? caller.now : Date.now(),
    taskDigest: caller.taskDigest || artifact.taskDigest,
    sdk: caller.sdk || caller.declaredSdk || artifact.declaredSdk,
    target: {
      origin: caller.origin || artifact.target?.origin,
      method: caller.method || artifact.target?.method,
      resource: caller.resource || artifact.target?.resource,
    },
    execution: null,
  });
  return {
    available: true,
    reason: replay.reason,
    blocks: replay.reason === "expired" || replay.reason === "corrected" || replay.reason === "revoked",
    usefulTransferred: false,
    paymentPermitted: false,
  };
}

function controlResult(row) {
  return {
    ...row,
    exitCode: row.refused === true ? 2 : 0,
    fresh: false,
    executed: row.executed === true,
    probed: row.probed === true,
    usefulTransferred: false,
    paymentPermitted: false,
    trusted: false,
    paymentSent: false,
    recognizedRevenueAtomic: "0",
  };
}

export async function resolveLater(artifact, caller) {
  if (!artifact || (artifact.schema !== REGRESSION_SCHEMA && artifact.schema !== CALLER_REGRESSION_SCHEMA)) {
    return controlResult({ refused: true, reason: "artifact_schema", probed: false, executed: false });
  }
  if (artifact.trusted === true || caller?.trustSubmitted === true) {
    return controlResult(consumeLaterArtifact(artifact, caller));
  }
  const retention = await retentionDecision(artifact, caller || {});
  if (isBoundedCallerRequest(caller)) {
    const executed = await executeCallerRequest(caller);
    if (!executed.executed) {
      return {
        refused: true,
        fresh: false,
        reason: executed.reason,
        errors: executed.receipt?.errors || [],
        probed: false,
        executed: false,
        usefulTransferred: false,
        paymentPermitted: false,
        trusted: false,
        paymentSent: false,
        recognizedRevenueAtomic: "0",
        exitCode: executed.exitCode,
      };
    }
    const predicate = predicateOf(artifact, caller, executed.receipt);
    return {
      refused: false,
      fresh: true,
      predicateApplies: predicate.applies,
      reason: predicate.applies ? "fresh_execution" : predicate.reason,
      predicateReason: predicate.reason,
      retentionReason: retention?.blocks ? retention.reason : null,
      probed: executed.probed === true,
      executed: true,
      executionClass: executed.executionClass,
      assertionIgnored: caller.independentRetest === true || caller.submittedReport === true,
      usefulTransferred: false,
      priorOwnerTransferred: false,
      paymentPermitted: false,
      trusted: false,
      deployedCounterpartyRepair: false,
      paymentSent: false,
      recognizedRevenueAtomic: "0",
      receipt: executed.receipt,
      exitCode: 0,
    };
  }
  if (retention?.blocks) {
    return controlResult({
      refused: true,
      reason: retention.reason,
      probed: false,
      executed: false,
      usefulTransferred: false,
    });
  }
  return controlResult(consumeLaterArtifact(artifact, caller));
}
