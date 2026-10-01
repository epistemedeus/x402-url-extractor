import { createHash } from "node:crypto";

import { classifyInstant } from "./time.mjs";

export const READING_SCHEMA = "neomorphic.route-release-decision.receipt-reading.v1";
export const RELATION_SCHEMA = "neomorphic.route-release-decision.receipt-relation.v1";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function observationDigest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function requestParts(value) {
  try {
    const url = new URL(value);
    return { origin: url.origin, route: url.pathname };
  } catch {
    return null;
  }
}

function publicRouteParts(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(GET|POST) (https:\/\/\S+)$/);
  if (!match) return null;
  try {
    const url = new URL(match[2]);
    if (url.username || url.password || url.search || url.hash) return null;
    return { method: match[1], origin: url.origin, route: url.pathname, publicRoute: value };
  } catch {
    return null;
  }
}

function operationOf(decision, mapped, captured) {
  const identity = decision?.identity && typeof decision.identity === "object" ? decision.identity : null;
  const parsed = publicRouteParts(identity?.publicRoute);
  const subject = mapped?.request?.subject;
  const requested = requestParts(captured?.requestUrl);
  const method = identity?.method || parsed?.method || subject?.method || mapped?.terms?.method || (requested ? "GET" : null);
  const origin = identity?.origin || parsed?.origin || subject?.origin || requested?.origin || null;
  const route = identity?.route || parsed?.route || subject?.route || requested?.route || null;
  const queryKeys = Array.isArray(identity?.queryKeys) ? [...identity.queryKeys] : [];
  const queryful = identity?.queryful === true || queryKeys.length > 0;
  const bindingDigest = typeof identity?.bindingDigest === "string" ? identity.bindingDigest : null;
  const publicRoute = parsed?.publicRoute
    || (method && origin && route ? `${method} ${origin}${route}` : null);
  return {
    method: method || null,
    origin,
    route,
    publicRoute,
    queryful,
    queryKeys,
    bindingDigest,
  };
}

export function stampEvaluation(value) {
  if (value === undefined || value === null) {
    return { evaluatedAt: new Date().toISOString(), evaluatedAtState: "known" };
  }
  const classified = classifyInstant(value);
  if (classified.state === "known") return { evaluatedAt: classified.iso, evaluatedAtState: "known" };
  return { evaluatedAt: null, evaluatedAtState: "malformed" };
}

export function attachObservation(receipt, facts) {
  const stamp = stampEvaluation(facts.evaluatedAt);
  const observedAt = facts.observedAtState === "known" ? facts.observedAt : null;
  const observedAtState = facts.observedAtState || "unknown";
  const expiry = facts.expiry || "unknown";
  const expiresAt = expiry === "known" ? facts.expiresAt : null;
  const operation = operationOf(facts.decision, facts.mapped, facts.captured);
  const requested = requestParts(facts.captured?.requestUrl);
  const source = {
    policy: "route-lock",
    policyVersion: facts.pin?.version || null,
    policyArchiveSha256: facts.pin?.archiveSha256 || null,
    skill: "route-release-decision",
    skillVersion: "0.1.0",
    requestOrigin: requested?.origin || operation.origin,
    requestRoute: requested?.route || operation.route,
    describedByUrl: facts.mapped?.describedByUrl || null,
    codeCommit: facts.pin?.codeCommit || null,
  };
  const mutation = facts.mutation || "none";
  const fresh = facts.decision?.evidence?.fresh ?? null;
  const diagnosticReuse = {
    reusable: receipt.ok === true,
    paymentPermitted: false,
    id: observationDigest({
      kind: "diagnostic",
      operation,
      policy: source.policy,
      policyVersion: source.policyVersion,
      policyArchiveSha256: source.policyArchiveSha256,
      mutation,
      decision: receipt.route?.decision || null,
      code: receipt.route?.code || null,
      absentEvidence: [...(facts.mapped?.absentEvidence || [])].sort(),
    }),
  };
  const currentObservation = {
    id: observationDigest({
      kind: "current",
      operation,
      policyArchiveSha256: source.policyArchiveSha256,
      observedAt,
      observedAtState,
      evaluatedAt: stamp.evaluatedAt,
      evaluatedAtState: stamp.evaluatedAtState,
      expiresAt,
      expiry,
      mutation,
      decision: receipt.route?.decision || null,
      code: receipt.route?.code || null,
    }),
  };
  return {
    ...receipt,
    observedAt,
    observedAtState,
    evaluatedAt: stamp.evaluatedAt,
    evaluatedAtState: stamp.evaluatedAtState,
    offer: {
      expiresAt,
      expiry,
      fresh,
    },
    operation,
    source,
    destination: facts.captured?.destination || {
      connectionPinned: false,
      confinementClaim: "none",
      dnsChecked: false,
      basis: null,
    },
    diagnosticReuse,
    currentObservation,
    currentAuthority: {
      granted: false,
      paymentPermitted: false,
      id: currentObservation.id,
    },
    routeEvidence: facts.decision ? {
      observedAt: facts.decision.evidence?.observedAt ?? null,
      evaluatedAt: facts.decision.evaluatedAt ?? null,
      fresh,
    } : null,
    fundsReserved: false,
    ownerPayment: false,
    paidServiceLaunch: false,
  };
}

function readingShell(reason, reusable = false) {
  return {
    schema: READING_SCHEMA,
    completedTask: false,
    paymentPermitted: false,
    fundsReserved: false,
    ownerPayment: false,
    paidServiceLaunch: false,
    diagnosticReuse: { reusable, id: null, decision: null, code: null, paymentPermitted: false },
    currentAuthority: { granted: false, observationCurrent: false, reason, id: null, paymentPermitted: false },
    currentObservation: { id: null },
  };
}

export function readReceipt(receipt, { now } = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return readingShell("unreadable");
  const nowClass = now === undefined ? { state: "unknown", iso: null } : classifyInstant(now);
  const evaluated = classifyInstant(receipt.evaluatedAt);
  const observedState = receipt.observedAtState
    || (receipt.observedAt ? classifyInstant(receipt.observedAt).state : "unknown");
  const expiry = receipt.offer?.expiry || "unknown";
  const fresh = receipt.offer?.fresh ?? receipt.route?.evidenceFresh ?? null;
  const completedTask = receipt.ok === true && !receipt.refusal;
  let reason = "diagnostic-only";
  let observationCurrent = false;
  const datesMalformed = observedState === "malformed"
    || expiry === "malformed"
    || receipt.evaluatedAtState === "malformed"
    || (receipt.evaluatedAt != null && evaluated.state !== "known")
    || (now !== undefined && nowClass.state !== "known");
  if (datesMalformed) reason = "malformed-date";
  else if (receipt.mutation === "changed-recipient" || receipt.route?.code === "recipient_changed") reason = "changed-recipient";
  else if (receipt.mutation === "stale" || fresh === false || receipt.route?.code === "terms_stale") reason = "stale";
  else if (expiry !== "known") reason = "expiry-unknown";
  else {
    const expires = classifyInstant(receipt.offer?.expiresAt);
    const compare = nowClass.state === "known" ? nowClass.iso : evaluated.iso;
    if (expires.state !== "known" || !compare) reason = "malformed-date";
    else if (Date.parse(expires.iso) <= Date.parse(compare)) reason = "expired";
    else if (receipt.route?.decision !== "lockable") reason = "not-lockable";
    else {
      observationCurrent = true;
      reason = "current-observation";
    }
  }
  return {
    schema: READING_SCHEMA,
    completedTask,
    paymentPermitted: false,
    fundsReserved: false,
    ownerPayment: false,
    paidServiceLaunch: false,
    diagnosticReuse: {
      reusable: receipt.diagnosticReuse?.reusable === true && completedTask,
      id: receipt.diagnosticReuse?.id || null,
      decision: receipt.route?.decision || null,
      code: receipt.route?.code || null,
      paymentPermitted: false,
    },
    currentAuthority: {
      granted: false,
      observationCurrent,
      reason,
      id: receipt.currentObservation?.id || receipt.currentAuthority?.id || null,
      paymentPermitted: false,
    },
    currentObservation: {
      id: receipt.currentObservation?.id || null,
    },
  };
}

function sameOperation(left, right) {
  return Boolean(
    left?.operation?.method
    && left.operation.method === right?.operation?.method
    && left.operation.origin === right?.operation?.origin
    && left.operation.route === right?.operation?.route
    && left?.source?.policyArchiveSha256
    && left.source.policyArchiveSha256 === right?.source?.policyArchiveSha256,
  );
}

export function relateReceipts(earlier, later, options = {}) {
  const left = readReceipt(earlier, options);
  const right = readReceipt(later, options);
  const sameDiagnostic = Boolean(left.diagnosticReuse.id && left.diagnosticReuse.id === right.diagnosticReuse.id);
  const sameCurrentObservation = Boolean(
    left.currentObservation.id && left.currentObservation.id === right.currentObservation.id,
  );
  const earlierEval = classifyInstant(earlier?.evaluatedAt);
  const laterEval = classifyInstant(later?.evaluatedAt);
  const earlierMs = earlierEval.iso ? Date.parse(earlierEval.iso) : NaN;
  const laterMs = laterEval.iso ? Date.parse(laterEval.iso) : NaN;
  const materialChange = earlier?.route?.code !== later?.route?.code
    || earlier?.offer?.expiry !== later?.offer?.expiry
    || earlier?.offer?.expiresAt !== later?.offer?.expiresAt
    || earlier?.mutation !== later?.mutation
    || earlier?.observedAtState !== later?.observedAtState;
  const correction = Boolean(
    sameOperation(earlier, later)
    && !sameCurrentObservation
    && Number.isFinite(earlierMs)
    && Number.isFinite(laterMs)
    && laterMs > earlierMs
    && materialChange,
  );
  return {
    schema: RELATION_SCHEMA,
    sameDiagnostic,
    sameCurrentObservation,
    correction,
    paymentPermitted: false,
    earlier: left,
    later: right,
  };
}
