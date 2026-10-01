import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PaymentOfferPreflightError,
  createPinnedLookup,
  normalizePaymentTarget,
  resolvePublicAddress,
} from "./payment-offer-preflight.mjs";

export const ARTIFACT = "client-compatibility-diagnostic";
export const PRODUCT = "samedaydesk-client-compatibility-diagnostic";
export const VERSION = "1.0.0";
export const SCHEMA = "samedaydesk.client-compatibility-diagnostic.v1";
export const RECEIPT_SCHEMA = "samedaydesk.client-compatibility-receipt.v1";
export const LATER_TASK_ID = "recheck-hermes-well-known-after-client-or-edge-change";
export const EXECUTOR = "client-compatibility-diagnostic";
export const PUBLIC_SKILL_URL = "https://neomorphic.io/.well-known/skills/route-lock-receipt/SKILL.md";
export const PUBLIC_INDEX_URL = "https://neomorphic.io/.well-known/skills/index.json";
export const HOSTINGER_BLOCKED_REQUESTS = "https://www.hostinger.com/support/hostinger-cdn-how-to-fix-blocked-legitimate-requests/";
export const HOSTINGER_TROUBLESHOOTING = "https://www.hostinger.com/support/hostinger-cdn-troubleshooting-website-errors/";
export const HOSTINGER_SUPPORT_STATEMENT = "Contact Hostinger support with the failing URL and method, the x-hcdn-request-id value, the timestamp, and the calling client's published addresses if that provider publishes them. The Hostinger dashboard cannot allowlist one service or endpoint. This diagnostic does not send the message.";

export const DIAGNOSTIC_CLASSES = Object.freeze([
  "malformed_payment_contract",
  "wrong_method_or_path",
  "incomplete_public_support_files",
  "client_or_edge_refusal",
  "stale_observation",
  "unknown_runtime",
  "compatible",
  "inconclusive",
]);

const ENROLLED = new Set(["hermes-agent", "node-https", "curl", "python-requests"]);
const REFUSAL = new Set([401, 403, 406, 429]);
const METHODS = new Set(["GET", "HEAD", "POST"]);
const HEADER_ALLOW = new Set([
  "date", "server", "content-type", "cache-control", "allow",
  "x-hcdn-request-id", "x-hcdn-cache-status", "x-request-id", "cf-ray", "via",
]);
const REQUEST_ALLOW = new Set(["accept", "accept-encoding", "connection", "user-agent"]);
const MALFORMED_FINDINGS = new Set([
  "x402_payment_required_schema_invalid",
  "x402_resource_schema_invalid",
  "seller_response_contract_invalid",
]);
const FREE_DOOR_CLASSES = new Set([
  "payable", "false_routing", "402_sans_accepts", "free_or_open", "missing_route",
  "method_mismatch", "transport_failure", "redirect_unfollowed", "catalog_method_disagreement",
  "terms_changed", "terms_ambiguous", "delivery_failed",
]);
const MAX_ACTIVE = 2;
const MAX_BODY = 65_536;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const SAFE_FILE = /^[A-Za-z0-9._/-]{1,128}$/;
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

let activeReplays = 0;

export class ClientCompatibilityError extends Error {
  constructor(message, code = "invalid_observation") {
    super(message);
    this.name = "ClientCompatibilityError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new ClientCompatibilityError(message, code);
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  if (plain(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function taskDigest(taskText) {
  if (typeof taskText !== "string" || taskText.trim().length < 40 || taskText.length > 4_000) {
    fail("task text must be 40-4000 characters");
  }
  return sha256(taskText);
}

function clean(value, limit = 128) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, limit) : null;
}

function iso(value, label) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(`${label} must be an ISO-8601 timestamp`);
  return new Date(ms).toISOString();
}

function stamp(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) fail("receiving clock is invalid");
  return date.toISOString();
}

export function redactHeaders(headers, allow = HEADER_ALLOW) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [name, value] of Object.entries(headers)) {
    const key = String(name).toLowerCase();
    if (!allow.has(key) || out[key] != null) continue;
    const text = clean(String(value), 128);
    if (text) out[key] = text;
    if (Object.keys(out).length >= 8) break;
  }
  return out;
}

function requestIdFrom(headers) {
  if (headers["x-hcdn-request-id"]) return { requestId: headers["x-hcdn-request-id"], requestIdSource: "x-hcdn-request-id" };
  if (headers["x-request-id"]) return { requestId: headers["x-request-id"], requestIdSource: "x-request-id" };
  if (headers["cf-ray"]) return { requestId: headers["cf-ray"], requestIdSource: "cf-ray" };
  return { requestId: null, requestIdSource: null };
}

function cdnDeliveryFrom(headers, captured) {
  if (!captured) return "not_captured";
  if (headers["x-hcdn-request-id"]) return "hostinger_header_present";
  return "hostinger_header_absent";
}

function nodePinSatisfied(version, pin, pinSource) {
  if (pinSource !== "fetched_bytes") return { enginePinSatisfied: null, pinVerified: false };
  const bound = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(pin || "");
  const have = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version || "");
  if (!bound || !have) return { enginePinSatisfied: null, pinVerified: false };
  const left = have.slice(1).map(Number);
  const right = bound.slice(1).map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return { enginePinSatisfied: true, pinVerified: true };
    if (left[i] < right[i]) return { enginePinSatisfied: false, pinVerified: true };
  }
  return { enginePinSatisfied: true, pinVerified: true };
}

function paidOperation(reason) {
  return Object.freeze({
    method: "GET",
    path: "/commerce/seller-integrity-audit",
    product: "samedaydesk-seller-integrity-audit",
    reused: false,
    executed: false,
    presentedAsFreshPaidExecution: false,
    paidAuditRequired: false,
    freeSufficient: true,
    priceChanged: false,
    skuAdded: false,
    reason,
  });
}

function boundary() {
  return Object.freeze({
    authority: false,
    credentialsUsed: false,
    paymentSent: false,
    revenueRecognized: false,
    independentDemandConfirmed: false,
    customerClaim: false,
    queryValuesRetained: false,
    bodyRetained: false,
    secretsRetained: false,
    redirectsFollowed: false,
    tlsWeakened: false,
    presentedAsFreshPaidExecution: false,
    cdnPolicyConfirmed: false,
  });
}

function bindingOf(input) {
  if (!plain(input)) fail("binding must be an object");
  const clientId = clean(input.clientId, 64);
  if (!clientId || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(clientId)) fail("binding clientId is invalid");
  const clientVersion = input.clientVersion == null || input.clientVersion === ""
    ? null
    : clean(String(input.clientVersion), 64);
  if (input.clientVersion != null && input.clientVersion !== "" && !clientVersion) fail("binding clientVersion is invalid");
  const method = String(input.method || "").toUpperCase();
  if (!METHODS.has(method)) fail("binding method must be GET, HEAD, or POST");
  let origin;
  let route;
  try {
    const target = normalizePaymentTarget(`${String(input.origin || "").replace(/\/$/, "")}${input.route || "/"}`);
    if (target.search) fail("binding route must not include a query", "query_rejected");
    origin = target.origin;
    route = target.pathname;
  } catch (error) {
    if (error instanceof ClientCompatibilityError) throw error;
    if (error instanceof PaymentOfferPreflightError) fail(error.message, error.code);
    fail("binding origin and route must be one public HTTPS URL");
  }
  if (route !== input.route) fail("binding route must be the exact pathname");
  return Object.freeze({ clientId, clientVersion, method, origin, route });
}

export function bindingDigest(parts) {
  return sha256(stable({
    taskDigest: parts.taskDigest,
    clientId: parts.clientId,
    clientVersion: parts.clientVersion,
    method: parts.method,
    origin: parts.origin,
    route: parts.route,
  }));
}

function observation(value, label) {
  if (value == null) return null;
  if (!plain(value)) fail(`${label} must be an object`);
  const status = value.status == null ? null : Number(value.status);
  if (status != null && (!Number.isInteger(status) || status < 100 || status > 599)) fail(`${label} status is invalid`);
  const headersCaptured = value.headersCaptured === true;
  const headers = redactHeaders(value.headers);
  const id = requestIdFrom(headers);
  return Object.freeze({
    clientId: clean(value.clientId, 64),
    version: clean(value.version == null ? "" : String(value.version), 64),
    status,
    observedAt: value.observedAt ? iso(value.observedAt, `${label}.observedAt`) : null,
    headers,
    headersCaptured,
    ...id,
    cdnDelivery: cdnDeliveryFrom(headers, headersCaptured),
    contentType: headers["content-type"] || null,
    method: value.method ? String(value.method).toUpperCase() : null,
    route: value.route ? clean(value.route, 256) : null,
    nativeExecutionClaim: value.nativeExecution === true,
    headerProfileInjected: value.headerProfileInjected === true,
    installed: value.installed == null ? null : value.installed === true,
    exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null,
    supportMissing: Array.isArray(value.supportMissing)
      ? value.supportMissing.filter((item) => typeof item === "string" && SAFE_FILE.test(item) && !item.includes("..")).slice(0, 16)
      : [],
    error: clean(value.error || "", 180),
  });
}

function heldIntegrity(value) {
  if (value == null) return null;
  if (!plain(value) || value.product !== "samedaydesk-seller-integrity-audit") return null;
  const findings = Array.isArray(value.report?.findings)
    ? value.report.findings.filter((item) => typeof item === "string").slice(0, 16)
    : [];
  return {
    decision: ["machine_buyable", "contract_ready", "repair_required"].includes(value.decision) ? value.decision : null,
    auditCompleted: value.report?.auditCompleted === true,
    failureCode: clean(value.report?.failureCode || "", 80),
    findings,
    valid: value.report?.valid === true,
  };
}

function finish(base, fields) {
  const pin = nodePinSatisfied(base.nodeVersion, base.suppliedEnginesNodePin, base.pinSource);
  const provider = fields.providerReceivingAction || null;
  return Object.freeze({
    ok: true,
    authority: false,
    artifact: ARTIFACT,
    product: PRODUCT,
    version: VERSION,
    schema: SCHEMA,
    laterTask: LATER_TASK_ID,
    class: fields.class,
    reason: fields.reason,
    abstain: fields.abstain === true,
    nativeExecution: fields.nativeExecution === true,
    nativeCompatible: fields.class === "compatible" && fields.nativeExecution === true,
    headerProfile: base.headerProfile === true,
    falseSuccessCli: fields.falseSuccessCli === true,
    cdnPolicyConfirmed: false,
    callerCdnPolicyClaim: base.callerCdnPolicyClaim,
    cdnDelivery: fields.cdnDelivery || "not_captured",
    requestId: fields.requestId || null,
    requestIdSource: fields.requestIdSource || null,
    evidenceKind: base.evidenceKind,
    sourceClaimsNativeExecution: base.sourceClaimsNativeExecution === true,
    receivedAt: base.receivedAt,
    observedAt: fields.observedAt || null,
    binding: base.binding,
    bindingDigest: base.bindingDigest,
    taskDigest: base.taskDigest,
    enginePinSatisfied: pin.enginePinSatisfied,
    pinVerified: pin.pinVerified,
    suppliedEnginesNodePin: base.pinSource === "supplied" ? base.suppliedEnginesNodePin : null,
    runtime: Object.freeze({ node: base.nodeVersion }),
    paidOperation: paidOperation(fields.paidReason),
    readiness: Object.freeze({
      establishesClientCompatibility: false,
      heldDecision: base.integrity?.decision || null,
    }),
    evidenceBoundary: boundary(),
    consumedHeldReport: fields.consumedHeldReport === true,
    consumedUnpaidDoorClass: base.unpaidDoorClass,
    incompleteAuditUseful: false,
    official: fields.official || null,
    control: fields.control || null,
    nextAction: Object.freeze({
      id: fields.actionId,
      callerAuthorized: base.authorizedActionId === fields.actionId && base.authorizeNextAction === true,
      executed: false,
      sent: false,
      statement: fields.actionStatement,
    }),
    providerReceivingAction: provider,
  });
}

function action(id, statement) {
  return { actionId: id, actionStatement: statement };
}

function providerPacket(base, official) {
  if (official?.cdnDelivery !== "hostinger_header_present" || !official.requestId) return null;
  return Object.freeze({
    id: "hostinger_support_packet",
    executed: false,
    sent: false,
    requiresProviderAccess: true,
    owner: "Root",
    dashboardAllowlist: false,
    url: `${base.binding.origin}${base.binding.route}`,
    method: base.binding.method,
    requestId: official.requestId,
    requestIdSource: official.requestIdSource,
    observedAt: official.observedAt,
    receivedAt: base.receivedAt,
    server: official.headers.server || null,
    contentType: official.contentType,
    statement: HOSTINGER_SUPPORT_STATEMENT,
    documentation: HOSTINGER_BLOCKED_REQUESTS,
    troubleshooting: HOSTINGER_TROUBLESHOOTING,
  });
}

function success(status) {
  return status != null && status >= 200 && status < 300;
}

function sameRoute(obs, binding) {
  if (!obs) return true;
  if (obs.method && obs.method !== binding.method) return false;
  if (obs.route && obs.route !== binding.route) return false;
  return true;
}

export function classifyClientCompatibility(input, { now = new Date() } = {}) {
  if (!plain(input)) fail("observation must be an object");
  const receivedAt = stamp(now);
  const digest = taskDigest(input.taskText);
  const binding = bindingOf(input.binding);
  const execution = input.execution;
  if (!["supplied", "independent_replay", "header-profile"].includes(execution)) {
    fail("execution must be supplied, independent_replay, or header-profile");
  }
  const official = observation(input.official, "official");
  const control = observation(input.control, "control");
  const integrity = heldIntegrity(input.sellerIntegrity);
  const unpaidDoorClass = FREE_DOOR_CLASSES.has(input.unpaidDoor?.doorClass) ? input.unpaidDoor.doorClass : null;
  const headerProfile = execution === "header-profile" || official?.headerProfileInjected === true || control?.headerProfileInjected === true;
  const independent = execution === "independent_replay" && input.executor === EXECUTOR && !headerProfile;
  const evidenceKind = independent ? "independent_replay" : "supplied";
  const callerCdnPolicyClaim = input.cdnPolicyConfirmed === true ? "rejected" : "absent";
  const pinSource = input.pinSource === "fetched_bytes" || input.pinSource === "supplied" ? input.pinSource : null;
  const base = {
    receivedAt,
    taskDigest: digest,
    binding,
    bindingDigest: bindingDigest({ taskDigest: digest, ...binding }),
    evidenceKind,
    headerProfile,
    sourceClaimsNativeExecution: official?.nativeExecutionClaim === true || input.official?.nativeExecution === true,
    callerCdnPolicyClaim,
    nodeVersion: clean(input.runtime?.node || "", 32),
    suppliedEnginesNodePin: clean(input.enginesNodePin || "", 32),
    pinSource,
    integrity,
    unpaidDoorClass,
    authorizeNextAction: input.authorizeNextAction === true,
    authorizedActionId: clean(input.authorizedActionId || "", 80),
  };
  const nativeOfficial = independent && official?.nativeExecutionClaim === true && official.clientId === binding.clientId && !official.headerProfileInjected;
  const observedAt = official?.observedAt || control?.observedAt || null;

  const done = (fields) => finish(base, { observedAt, official: summary(official), control: summary(control), ...fields });

  if (headerProfile) {
    return done({
      class: "inconclusive",
      reason: "header_profile_is_not_native_execution",
      nativeExecution: false,
      cdnDelivery: "not_captured",
      paidReason: "paid_service_cannot_execute_client_profile",
      ...action("run_official_client", "Run the official client. A header profile is not native execution and is not compatibility."),
    });
  }

  if (!ENROLLED.has(binding.clientId)) {
    return done({
      class: "unknown_runtime",
      reason: "unenrolled_runtime",
      abstain: true,
      nativeExecution: false,
      paidReason: "paid_service_cannot_execute_client_profile",
      ...action("run_enrolled_client", "Abstain. Enrolled runtimes are hermes-agent, node-https, curl, and python-requests. This diagnostic does not guess an unknown client."),
    });
  }

  if (execution === "independent_replay" && !independent) {
    return done({
      class: "inconclusive",
      reason: "replay_claim_not_this_process",
      nativeExecution: false,
      paidReason: "paid_service_cannot_execute_client_profile",
      ...action("replay_with_this_consumer", "An independent replay has to be executed by this consumer. Supplied or private-runtime output stays supplied."),
    });
  }

  if ((official && !official.observedAt) || (control && !control.observedAt)) {
    return done({
      class: "inconclusive",
      reason: "clock_not_captured",
      nativeExecution: nativeOfficial,
      paidReason: "paid_service_cannot_execute_client_profile",
      ...action("record_receiving_clock", "Record the client clock and the response Date before classifying the observation."),
    });
  }

  if (official?.observedAt && control?.observedAt) {
    const skew = Math.abs(Date.parse(official.observedAt) - Date.parse(control.observedAt));
    if (skew > CLOCK_SKEW_MS) {
      return done({
        class: "inconclusive",
        reason: "observation_clocks_diverge",
        nativeExecution: nativeOfficial,
        paidReason: "paid_service_cannot_execute_client_profile",
        ...action("refresh_paired_observations", "Repeat the official client and the control within five minutes of each other."),
      });
    }
  }

  if (Number.isFinite(input.freshForMs) && observedAt) {
    const age = Date.parse(receivedAt) - Date.parse(observedAt);
    if (age > Number(input.freshForMs)) {
      return done({
        class: "stale_observation",
        reason: "expired",
        nativeExecution: false,
        paidReason: "free_sufficient",
        ...action("refresh_observation", "The observation is older than the freshness horizon. Refresh it. The previous class is not current."),
      });
    }
  }

  if (input.declaredMethod && String(input.declaredMethod).toUpperCase() !== binding.method) {
    return done({
      class: "wrong_method_or_path",
      reason: "method_mismatch",
      nativeExecution: nativeOfficial,
      paidReason: "free_sufficient",
      ...action("repeat_unpaid_with_declared_method", `Repeat the unpaid request with ${String(input.declaredMethod).toUpperCase()}. The free declaration already names the method.`),
    });
  }
  if (input.declaredRoute && input.declaredRoute !== binding.route) {
    return done({
      class: "wrong_method_or_path",
      reason: "wrong_path",
      nativeExecution: nativeOfficial,
      paidReason: "free_sufficient",
      ...action("repeat_unpaid_on_declared_route", "Repeat the unpaid request on the declared path. A different path is not a client-compatibility result."),
    });
  }

  if (official && !sameRoute(official, binding)) {
    return done({
      class: "inconclusive",
      reason: "official_target_mismatch",
      nativeExecution: false,
      paidReason: "free_sufficient",
      ...action("repeat_on_bound_route", "The official observation is for a different method or path than the bound task."),
    });
  }
  if (control && !sameRoute(control, binding)) {
    return done({
      class: "inconclusive",
      reason: "control_target_mismatch",
      nativeExecution: nativeOfficial,
      paidReason: "free_sufficient",
      ...action("repeat_control_on_bound_route", "The control observation is for a different method or path."),
    });
  }

  if (official && official.status != null && official.status >= 300 && official.status < 400) {
    return done({
      class: "inconclusive",
      reason: "redirect_not_followed",
      nativeExecution: nativeOfficial,
      cdnDelivery: official.cdnDelivery,
      requestId: official.requestId,
      requestIdSource: official.requestIdSource,
      paidReason: "free_sufficient",
      ...action("do_not_follow_redirect", "The redirect was not followed. Do not treat it as a successful client fetch."),
    });
  }

  if (integrity && !integrity.auditCompleted && !official && !control) {
    return done({
      class: "inconclusive",
      reason: "incomplete_audit_not_authority",
      consumedHeldReport: true,
      nativeExecution: false,
      paidReason: "free_sufficient",
      ...action("do_not_treat_incomplete_audit_as_delivery", "An incomplete seller-integrity audit is not useful delivery and does not decide client compatibility."),
    });
  }

  const malformedFinding = integrity?.auditCompleted && integrity.findings.some((item) => MALFORMED_FINDINGS.has(item) || item.startsWith("seller_response_contract_invalid"));
  const unpaidMalformed = plain(input.payment) && input.payment.parsed === false && Number(input.payment.status) === 402;
  if ((malformedFinding || unpaidMalformed) && !(official && control && REFUSAL.has(official.status) && success(control.status))) {
    return done({
      class: "malformed_payment_contract",
      reason: malformedFinding ? "held_seller_integrity_report" : "unpaid_challenge_has_no_accepts",
      consumedHeldReport: Boolean(malformedFinding),
      nativeExecution: false,
      paidReason: "free_sufficient",
      ...action("use_unpaid_or_held_contract", "The unpaid challenge or the held seller-integrity report already shows the contract problem. Do not buy another audit."),
    });
  }

  if (official && success(official.status) && official.supportMissing.length) {
    return done({
      class: "incomplete_public_support_files",
      reason: "declared_support_file_missing",
      nativeExecution: nativeOfficial,
      cdnDelivery: official.cdnDelivery,
      requestId: official.requestId,
      requestIdSource: official.requestIdSource,
      paidReason: "free_sufficient",
      ...action("do_not_install_incomplete_support", "The index was readable and a declared support file is missing. Do not install a partial skill and do not buy an audit to explain it."),
    });
  }

  const falseSuccess = official?.exitCode === 0 && official?.installed === false && (REFUSAL.has(official.status) || official.installed === false && official.error);
  const additional = observation(input.additionalControl, "additionalControl");
  if (additional && control && additional.status != null && control.status != null && additional.status !== control.status) {
    return done({
      class: "inconclusive",
      reason: "controls_disagree",
      nativeExecution: nativeOfficial,
      paidReason: "free_sufficient",
      ...action("repeat_controls", "The enrolled controls did not return the same status. Do not pick one of them as native success."),
    });
  }

  if (official && REFUSAL.has(official.status) && control && success(control.status)) {
    const packet = providerPacket(base, official);
    return done({
      class: "client_or_edge_refusal",
      reason: official.cdnDelivery === "hostinger_header_present"
        ? "official_client_refused_control_succeeded_cdn_header_present"
        : "official_client_refused_control_succeeded",
      nativeExecution: nativeOfficial,
      falseSuccessCli: official.exitCode === 0 && official.installed === false,
      cdnDelivery: official.cdnDelivery,
      requestId: official.requestId,
      requestIdSource: official.requestIdSource,
      providerReceivingAction: packet,
      paidReason: "paid_service_cannot_execute_client_profile",
      ...action(
        control.clientId === "node-https" ? "use_node_https_public_installer" : "use_successful_control_client",
        packet
          ? "The official client was refused and the control succeeded. The response carries x-hcdn-request-id, which Hostinger documents as delivery through its CDN. That is not a confirmed CDN policy. The caller can authorize the Node HTTPS installer. Root keeps the support packet and this process does not send it."
          : "The official client was refused and the control succeeded. A generic refusal is not a confirmed CDN policy. Capture x-hcdn-request-id before any provider action. The caller can authorize the successful control client.",
      ),
    });
  }

  if (official && success(official.status) && official.supportMissing.length === 0 && nativeOfficial && official.installed !== false) {
    return done({
      class: "compatible",
      reason: "official_client_succeeded",
      nativeExecution: true,
      cdnDelivery: official.cdnDelivery,
      requestId: official.requestId,
      requestIdSource: official.requestIdSource,
      paidReason: "free_sufficient",
      ...action("none", "The official client completed this bound fetch. The result is not authority for a different client, route, or task."),
    });
  }

  if (official && (official.status == null || official.status >= 500)) {
    return done({
      class: "inconclusive",
      reason: "transport_failure",
      nativeExecution: nativeOfficial,
      paidReason: "free_sufficient",
      ...action("retry_unpaid_later", "The unpaid request did not return a classifiable response. Do not buy an audit to explain a transport failure."),
    });
  }

  if (official && REFUSAL.has(official.status) && !control) {
    return done({
      class: "inconclusive",
      reason: "control_required",
      nativeExecution: nativeOfficial,
      falseSuccessCli: official.exitCode === 0 && official.installed === false,
      cdnDelivery: official.cdnDelivery,
      requestId: official.requestId,
      requestIdSource: official.requestIdSource,
      providerReceivingAction: null,
      paidReason: "paid_service_cannot_execute_client_profile",
      ...action("capture_control_and_request_id", "A single refusal does not establish a client or edge block, and a generic 403 is not a confirmed CDN policy. Pair it with a successful enrolled control and keep the response request id."),
    });
  }

  if (official && control && REFUSAL.has(official.status) && official.status === control.status) {
    return done({
      class: "inconclusive",
      reason: "same_status_not_client_specific",
      nativeExecution: nativeOfficial,
      cdnDelivery: official.cdnDelivery,
      requestId: official.requestId,
      requestIdSource: official.requestIdSource,
      paidReason: "free_sufficient",
      ...action("do_not_call_it_client_specific", "The official client and the control received the same refusal. That is not evidence the client alone was singled out."),
    });
  }

  if (official && (official.status === 404 || official.status === 405) && (!control || official.status === control.status)) {
    return done({
      class: official.status === 405 ? "wrong_method_or_path" : "incomplete_public_support_files",
      reason: official.status === 405 ? "method_not_allowed" : "path_not_served",
      nativeExecution: nativeOfficial,
      cdnDelivery: official.cdnDelivery,
      requestId: official.requestId,
      requestIdSource: official.requestIdSource,
      paidReason: "free_sufficient",
      ...action(
        official.status === 405 ? "repeat_unpaid_with_declared_method" : "do_not_install_missing_public_file",
        official.status === 405
          ? "The unpaid response is 405. Repeat with the allowed method."
          : "The bound public path was not served. Do not install from a missing file.",
      ),
    });
  }

  if (!official && unpaidDoorClass) {
    return done({
      class: "inconclusive",
      reason: "unpaid_door_already_answers",
      nativeExecution: false,
      paidReason: "free_sufficient",
      ...action("keep_unpaid_door_decision", "The held unpaid-door class already answers the payment question. Do not open a paid audit, and do not treat that door as a native-client result."),
    });
  }

  if (falseSuccess && !control) {
    return done({
      class: "inconclusive",
      reason: "false_success_cli_without_control",
      nativeExecution: nativeOfficial,
      falseSuccessCli: true,
      paidReason: "paid_service_cannot_execute_client_profile",
      ...action("inspect_installed_files", "A zero exit code is not an install. Inspect the skill file and pair the refusal with a control client."),
    });
  }

  return done({
    class: "inconclusive",
    reason: "insufficient_observation",
    nativeExecution: nativeOfficial,
    paidReason: "paid_service_cannot_execute_client_profile",
    ...action("capture_official_and_control", "Capture the official client status, an enrolled control, the response request id, and the receiving clock."),
  });
}

function summary(obs) {
  if (!obs) return null;
  return Object.freeze({
    clientId: obs.clientId,
    version: obs.version,
    status: obs.status,
    contentType: obs.contentType,
    requestId: obs.requestId,
    cdnDelivery: obs.cdnDelivery,
    installed: obs.installed,
    exitCode: obs.exitCode,
  });
}

export function buildReceipt(diagnosis, { evidenceBytes, taskText }) {
  if (!plain(diagnosis) || diagnosis.schema !== SCHEMA) fail("diagnosis does not match this consumer");
  const evidenceDigest = sha256(evidenceBytes);
  const digest = taskDigest(taskText);
  if (digest !== diagnosis.taskDigest) fail("task text does not match the diagnosis");
  return Object.freeze({
    schema: RECEIPT_SCHEMA,
    artifact: ARTIFACT,
    laterTask: LATER_TASK_ID,
    product: PRODUCT,
    version: VERSION,
    class: diagnosis.class,
    reason: diagnosis.reason,
    nativeExecution: diagnosis.nativeExecution,
    nativeCompatible: diagnosis.nativeCompatible,
    falseSuccessCli: diagnosis.falseSuccessCli,
    evidenceKind: diagnosis.evidenceKind,
    cdnPolicyConfirmed: false,
    cdnDelivery: diagnosis.cdnDelivery,
    requestId: diagnosis.requestId,
    paidAuditRequired: false,
    paymentSent: false,
    revenueRecognized: false,
    independentDemandConfirmed: false,
    presentedAsFreshPaidExecution: false,
    authority: false,
    incompleteAuditUseful: false,
    receivedAt: diagnosis.receivedAt,
    binding: diagnosis.binding,
    bindingDigest: diagnosis.bindingDigest,
    taskDigest: digest,
    evidenceDigest,
    enginePinSatisfied: diagnosis.enginePinSatisfied ?? null,
    pinVerified: diagnosis.pinVerified === true,
    runtime: diagnosis.runtime,
    nextAction: diagnosis.nextAction,
    providerReceivingAction: diagnosis.providerReceivingAction,
  });
}

function claimFailures(receipt) {
  const failures = [];
  if (receipt.cdnPolicyConfirmed !== false) failures.push("cdn_policy_claim");
  if (receipt.paidAuditRequired !== false) failures.push("paid_audit_required");
  if (receipt.paymentSent !== false) failures.push("payment_sent");
  if (receipt.revenueRecognized !== false) failures.push("revenue_claim");
  if (receipt.independentDemandConfirmed !== false) failures.push("independent_demand_claim");
  if (receipt.presentedAsFreshPaidExecution !== false) failures.push("fresh_paid_execution_claim");
  if (receipt.authority !== false) failures.push("authority_claim");
  if (receipt.incompleteAuditUseful !== false) failures.push("incomplete_audit_counted_useful");
  if (receipt.nativeCompatible === true && (receipt.class !== "compatible" || receipt.nativeExecution !== true)) failures.push("false_native_compatible");
  if (receipt.evidenceKind !== "independent_replay" && receipt.nativeExecution === true) failures.push("supplied_called_native_execution");
  if (receipt.falseSuccessCli === true && receipt.class === "compatible") failures.push("false_success_called_compatible");
  if (receipt.evidenceKind === "header-profile" && receipt.nativeCompatible === true) failures.push("header_profile_called_native");
  if (receipt.enginePinSatisfied === true && receipt.pinVerified !== true) failures.push("unverified_engine_pin");
  if (receipt.nextAction?.executed === true || receipt.nextAction?.sent === true) failures.push("next_action_executed");
  if (receipt.providerReceivingAction?.executed === true || receipt.providerReceivingAction?.sent === true) failures.push("provider_message_sent");
  if (receipt.providerReceivingAction?.dashboardAllowlist === true) failures.push("dashboard_allowlist_claim");
  return failures;
}

export function checkDecisionReceipt(receipt, { taskText, evidence, evidenceBytes, now = new Date(), binding } = {}) {
  if (!plain(receipt) || receipt.schema !== RECEIPT_SCHEMA || receipt.artifact !== ARTIFACT) {
    return { ok: false, class: "invalid", exitCode: 2, reason: "receipt_invalid" };
  }
  const claims = claimFailures(receipt);
  if (claims.length) return { ok: false, class: claims[0], exitCode: 3, reason: claims[0], claims };
  let digest;
  try {
    digest = taskDigest(taskText);
  } catch {
    return { ok: false, class: "invalid", exitCode: 2, reason: "task_text_invalid" };
  }
  if (digest !== receipt.taskDigest) {
    return { ok: false, class: "stale_observation", exitCode: 4, reason: "changed_task", reusable: true, laterTask: LATER_TASK_ID };
  }
  if (binding) {
    const next = bindingOf(binding);
    const fields = [
      ["clientId", "changed_client"],
      ["clientVersion", "changed_client"],
      ["method", "changed_route"],
      ["origin", "changed_route"],
      ["route", "changed_route"],
    ];
    for (const [field, reason] of fields) {
      if (next[field] !== receipt.binding?.[field]) {
        return { ok: false, class: "stale_observation", exitCode: 4, reason, field, reusable: true, laterTask: LATER_TASK_ID };
      }
    }
  }
  if (!evidenceBytes) return { ok: false, class: "invalid", exitCode: 2, reason: "evidence_required" };
  if (sha256(evidenceBytes) !== receipt.evidenceDigest) {
    return { ok: false, class: "evidence_mismatch", exitCode: 3, reason: "evidence_digest_mismatch" };
  }
  if (receipt.receivedAt !== evidence?.receivedAt) {
    return { ok: false, class: "clock_mismatch", exitCode: 3, reason: "receiving_clock_mismatch" };
  }
  const receivedMs = Date.parse(receipt.receivedAt);
  if (!Number.isFinite(receivedMs)) return { ok: false, class: "invalid", exitCode: 2, reason: "clock_invalid" };
  if (receivedMs - (now instanceof Date ? now.getTime() : Date.parse(now)) > 24 * 60 * 60 * 1000) {
    return { ok: false, class: "invalid", exitCode: 2, reason: "clock_in_the_future" };
  }
  let again;
  try {
    again = classifyClientCompatibility(evidence, { now: new Date(receipt.receivedAt) });
  } catch (error) {
    return { ok: false, class: "invalid", exitCode: 2, reason: error.code || "evidence_invalid" };
  }
  if (again.class !== receipt.class || again.reason !== receipt.reason || again.nativeExecution !== receipt.nativeExecution
    || again.evidenceKind !== receipt.evidenceKind || again.cdnDelivery !== receipt.cdnDelivery
    || again.requestId !== receipt.requestId || again.falseSuccessCli !== receipt.falseSuccessCli
    || again.nativeCompatible !== receipt.nativeCompatible) {
    return { ok: false, class: "reclassify_mismatch", exitCode: 3, reason: "stored_class_does_not_match_evidence" };
  }
  const bindingFields = ["clientId", "clientVersion", "method", "origin", "route"];
  const bindingMismatch = !again.binding || bindingFields.some((field) => again.binding[field] !== receipt.binding?.[field]);
  if (bindingMismatch || again.bindingDigest !== receipt.bindingDigest) {
    return { ok: false, class: "reclassify_mismatch", exitCode: 3, reason: "stored_binding_does_not_match_evidence" };
  }
  if (again.cdnPolicyConfirmed !== false || again.paidOperation.paidAuditRequired !== false) {
    return { ok: false, class: "cdn_policy_claim", exitCode: 3, reason: "classifier_emitted_a_forbidden_claim" };
  }
  return {
    ok: true,
    class: "accept",
    exitCode: 0,
    reason: receipt.reason,
    diagnosticClass: receipt.class,
    reusable: true,
    laterTask: LATER_TASK_ID,
    nativeCompatible: false === receipt.nativeCompatible ? false : receipt.nativeCompatible,
    cdnPolicyConfirmed: false,
    paidAuditRequired: false,
  };
}

function acquire() {
  if (activeReplays >= MAX_ACTIVE) fail("replay concurrency limit reached", "concurrency_rejected");
  activeReplays += 1;
}

function release() {
  activeReplays = Math.max(0, activeReplays - 1);
}

export async function withReplaySlot(fn) {
  acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

export function resetReplaySlotsForTests() {
  activeReplays = 0;
}

function supportFromBody(bytes, contentType) {
  if (!bytes || !String(contentType || "").includes("json")) return { indexParsed: false, skills: [], missing: [] };
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (!parsed || !Array.isArray(parsed.skills)) return { indexParsed: false, skills: [], missing: [] };
    const skills = [];
    for (const skill of parsed.skills.slice(0, 16)) {
      if (!skill || !SAFE_NAME.test(String(skill.name || ""))) continue;
      const files = Array.isArray(skill.files)
        ? skill.files.filter((item) => typeof item === "string" && SAFE_FILE.test(item) && !item.includes("..")).slice(0, 16)
        : [];
      skills.push({ name: skill.name, files });
    }
    return { indexParsed: true, skills, missing: [] };
  } catch {
    return { indexParsed: false, skills: [], missing: [] };
  }
}

function nodeRequest(target, resolved, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(target, {
      method: "GET",
      headers: { accept: "*/*", "user-agent": "node" },
      lookup: createPinnedLookup(resolved),
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      let size = 0;
      let truncated = false;
      response.on("data", (chunk) => {
        if (size >= MAX_BODY) {
          truncated = true;
          response.destroy();
          return;
        }
        const room = MAX_BODY - size;
        const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
        chunks.push(slice);
        size += slice.length;
        if (chunk.length > room) {
          truncated = true;
          response.destroy();
        }
      });
      const finish = () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: Number(response.statusCode || 0),
          headers: response.headers,
          body,
          truncated,
        });
      };
      response.on("end", finish);
      response.on("error", finish);
    });
    request.on("timeout", () => request.destroy(new Error("target request timed out")));
    request.on("error", reject);
    request.end();
  });
}

export async function replayNodeHttps(url, { requestImpl, lookupImpl, timeoutMs = 20_000 } = {}) {
  return withReplaySlot(async () => {
    let target;
    try {
      target = normalizePaymentTarget(url);
    } catch (error) {
      if (error instanceof PaymentOfferPreflightError) fail(error.message, error.code);
      throw error;
    }
    if (target.search) fail("query values are not retained", "query_rejected");
    const resolved = requestImpl ? null : await resolvePublicAddress(target.hostname.replace(/^\[|\]$/g, ""), { lookupImpl });
    const observedAt = new Date().toISOString();
    const result = requestImpl
      ? await requestImpl(target)
      : await nodeRequest(target, resolved, timeoutMs);
    const body = Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.body || "");
    const contentType = clean(String(result.headers?.["content-type"] || result.contentType || ""), 128);
    const support = supportFromBody(body, contentType);
    return {
      clientId: "node-https",
      version: process.version,
      nativeExecution: true,
      headerProfileInjected: false,
      executor: EXECUTOR,
      method: "GET",
      origin: target.origin,
      route: target.pathname,
      status: Number(result.status || 0),
      observedAt,
      headers: redactHeaders(result.headers),
      headersCaptured: true,
      redirectsFollowed: false,
      bodyRetained: false,
      bodyTruncated: result.truncated === true,
      bodyBytes: body.length,
      bodySha256: sha256(body),
      contentType,
      support,
      supportMissing: support.missing,
      error: null,
    };
  });
}

function runProcess(command, args, { env, timeoutMs, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on("data", (chunk) => {
      if (stdoutBytes < MAX_BODY) stdout.push(chunk);
      stdoutBytes += chunk.length;
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes < 4_096) stderr.push(chunk);
      stderrBytes += chunk.length;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ClientCompatibilityError("official client probe timed out", "probe_timeout"));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8").slice(0, 300),
      });
    });
  });
}

export async function replayOfficialHermes(url, {
  python = process.env.HERMES_PYTHON || "python3",
  pythonPath = process.env.HERMES_PYTHONPATH || "",
  probePath = join(dirname(fileURLToPath(import.meta.url)), "examples", "client-compatibility-diagnostic", "probe-official-client.py"),
  timeoutMs = 180_000,
  installer = false,
} = {}) {
  return withReplaySlot(async () => {
    let target;
    try {
      target = normalizePaymentTarget(url);
    } catch (error) {
      if (error instanceof PaymentOfferPreflightError) fail(error.message, error.code);
      throw error;
    }
    if (target.search) fail("query values are not retained", "query_rejected");
    if (!pythonPath) fail("HERMES_PYTHONPATH must point at an official hermes-agent install", "official_client_unavailable");
    const home = await mkdtemp(join(tmpdir(), "hermes-compat-"));
    try {
      const args = [probePath, "--url", target.toString()];
      if (installer) args.push("--installer");
      const result = await runProcess(python, args, {
        timeoutMs,
        cwd: dirname(fileURLToPath(import.meta.url)),
        env: {
          ...process.env,
          HERMES_HOME: home,
          PYTHONPATH: pythonPath,
          PYTHONDONTWRITEBYTECODE: "1",
        },
      });
      let payload;
      try {
        payload = JSON.parse(result.stdout);
      } catch {
        fail("official client probe did not return JSON", "official_client_unavailable");
      }
      if (payload.officialClient !== true || payload.nativeExecution !== true) {
        fail(payload.error || "official client was not executed", "official_client_unavailable");
      }
      const headers = redactHeaders(payload.responseHeaders);
      return {
        clientId: "hermes-agent",
        version: payload.version || null,
        httpxVersion: payload.httpxVersion || null,
        nativeExecution: true,
        headerProfileInjected: false,
        executor: EXECUTOR,
        method: "GET",
        origin: new URL(payload.indexUrl).origin,
        route: new URL(payload.indexUrl).pathname,
        status: payload.status,
        observedAt: payload.observedAt,
        headers,
        headersCaptured: true,
        requestHeaderNames: Array.isArray(payload.requestHeaderNames) ? payload.requestHeaderNames.slice(0, 8) : [],
        requestHeaders: redactHeaders(payload.requestHeaders, REQUEST_ALLOW),
        requestSemantics: clean(payload.requestSemantics || "", 180),
        redirectsFollowed: false,
        tlsWeakened: false,
        installed: payload.installed === true,
        exitCode: payload.installer?.exitCode ?? null,
        couldNotFetch: clean(payload.installer?.couldNotFetch || "", 240),
        wellKnownFetchReturnedBundle: payload.wellKnownFetchReturnedBundle === true,
        urlSourceClaims: payload.urlSourceClaims === true,
        supportMissing: [],
        error: clean(payload.error || "", 180),
        bodyRetained: false,
      };
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
}

export async function replayCurl(url, { timeoutMs = 20_000 } = {}) {
  return withReplaySlot(async () => {
    let target;
    try {
      target = normalizePaymentTarget(url);
    } catch (error) {
      if (error instanceof PaymentOfferPreflightError) fail(error.message, error.code);
      throw error;
    }
    if (target.search) fail("query values are not retained", "query_rejected");
    const dir = await mkdtemp(join(tmpdir(), "curl-compat-"));
    const bodyPath = join(dir, "body");
    const headerPath = join(dir, "headers");
    try {
      const result = await runProcess("curl", [
        "-sS", "-D", headerPath, "-o", bodyPath,
        "--max-redirs", "0",
        "--max-time", String(Math.ceil(timeoutMs / 1000)),
        "--proto", "=https",
        "--max-filesize", String(MAX_BODY),
        target.toString(),
      ], { timeoutMs: timeoutMs + 2_000, env: process.env });
      const headerText = await readFile(headerPath, "utf8").catch(() => "");
      const body = await readFile(bodyPath).catch(() => Buffer.alloc(0));
      const headers = {};
      let status = null;
      for (const line of headerText.split(/\r?\n/)) {
        if (line.startsWith("HTTP/")) {
          status = Number(line.split(" ")[1]);
          continue;
        }
        const split = line.indexOf(":");
        if (split > 0) headers[line.slice(0, split).toLowerCase()] = line.slice(split + 1).trim();
      }
      if (result.code !== 0 && status == null) fail(`curl exited ${result.code}`, "control_unavailable");
      const kept = body.subarray(0, MAX_BODY);
      return {
        clientId: "curl",
        version: "curl",
        nativeExecution: true,
        headerProfileInjected: false,
        executor: EXECUTOR,
        method: "GET",
        origin: target.origin,
        route: target.pathname,
        status,
        observedAt: new Date().toISOString(),
        headers: redactHeaders(headers),
        headersCaptured: true,
        redirectsFollowed: false,
        bodyRetained: false,
        bodyBytes: kept.length,
        bodySha256: sha256(kept),
        contentType: clean(headers["content-type"] || "", 128),
        supportMissing: [],
        error: null,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

export const HERE = dirname(fileURLToPath(import.meta.url));
