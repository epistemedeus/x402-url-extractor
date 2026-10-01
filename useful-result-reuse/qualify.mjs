import { createHash } from "node:crypto";

import {
  authorizeOutcomeBinding,
  buildTaskRefRecord,
  stableForwardEventId,
} from "../commerce-outcome-binding.mjs";
import { digestOf } from "../task-linked-delivery/experiments/delivery-outcome-100173/src/canonical.mjs";
import { SNAPSHOT_SCHEMA } from "../task-linked-delivery/experiments/delivery-outcome-100173/src/constants.mjs";
import { joinSnapshot } from "../task-linked-delivery/experiments/delivery-outcome-100173/src/join.mjs";
import { hasDisallowedKey } from "../task-linked-delivery/experiments/delivery-outcome-100173/src/privacy.mjs";
import {
  ACTOR_FOR_CLASS,
  CLASSIFICATIONS,
  COHORT_FOR_CLASS,
  DISPOSITIONS,
  OUTCOME_CODES,
  OUTCOME_SCHEMA,
  SOURCE_ID,
} from "./constants.mjs";

const HEX64 = /^[0-9a-f]{64}$/;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const SCHEMA_NAME = /^[a-z0-9][a-z0-9.-]{0,80}$/;
const ROUTE = /^\/[A-Za-z0-9._~/-]{0,180}$/;
const VALUE_LEAK = /(@|\/\/|bearer\s|payment-signature|x-payment)/i;
const WALLET_VALUE = /^0x[0-9a-fA-F]{40}$/;

export class QualifyError extends Error {
  constructor(code) {
    super(code);
    this.name = "QualifyError";
    this.code = code;
  }
}

function fail(code) {
  throw new QualifyError(code);
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function leakyString(value) {
  return typeof value === "string" && (VALUE_LEAK.test(value) || WALLET_VALUE.test(value) || value.length > 80);
}

export function bindingDigest(parts) {
  return digestOf({
    method: parts.method,
    operationId: parts.operationId,
    outcomeSchema: parts.outcomeSchema,
    outcomeSchemaVersion: parts.outcomeSchemaVersion,
    route: parts.route,
  });
}

export function claimFor({ token, suppliedToken, taskLabel, operationId, classification }) {
  if (!CLASSIFICATIONS.includes(classification)) fail("classification_rejected");
  const cohort = COHORT_FOR_CLASS[classification];
  const claim = authorizeOutcomeBinding({
    "x-samedaydesk-internal": suppliedToken ?? token,
    "x-samedaydesk-outcome-operation": operationId,
    "x-samedaydesk-outcome-cohort": cohort,
    "x-samedaydesk-outcome-task": taskLabel,
  }, token);
  if (!claim) fail("unauthorized");
  if (!claim.taskRef) fail("task_label_rejected");
  return { claim, cohort, actorLabel: ACTOR_FOR_CLASS[classification] };
}

function assertSafeTree(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) fail("restricted_field");
  seen.add(value);
  if (hasDisallowedKey(value)) fail("restricted_field");
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [, child] of entries) {
    if (typeof child === "string" && leakyString(child)) fail("restricted_value");
    if (child && typeof child === "object") assertSafeTree(child, seen);
  }
}

export function projectOutcome(raw) {
  if (raw == null) {
    return {
      derived: null,
      qualification: "unavailable",
      criterion: null,
      httpStatus: null,
    };
  }
  if (!plain(raw)) fail("outcome_rejected");
  assertSafeTree(raw);
  const schema = raw.schema ?? OUTCOME_SCHEMA;
  const schemaVersion = raw.schemaVersion ?? null;
  if (schema !== OUTCOME_SCHEMA) fail("outcome_schema_rejected");
  if (schemaVersion !== "1") fail("outcome_schema_rejected");
  if (!DISPOSITIONS.includes(raw.disposition)) fail("outcome_rejected");
  if (!OUTCOME_CODES.includes(raw.code)) fail("outcome_rejected");
  if (!["present", "partial", "unavailable"].includes(raw.availability)) fail("outcome_rejected");
  const httpStatus = raw.httpStatus == null ? null : raw.httpStatus;
  if (httpStatus !== null && (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) {
    fail("outcome_rejected");
  }
  const derived = {
    availability: raw.availability,
    code: raw.code,
    disposition: raw.disposition,
    httpStatus,
    schema: OUTCOME_SCHEMA,
    schemaVersion: "1",
  };
  // A caller success flag is not part of the retained projection.
  const assertedSuccess = raw.usefulDelivery === "true" || raw.useful === true || raw.ok === true;
  let qualification = raw.disposition;
  let criterion = null;
  if (
    raw.disposition === "useful"
    && raw.code === "unpaid_receipt_readable"
    && raw.availability === "present"
    && httpStatus !== null
    && httpStatus >= 200
    && httpStatus < 300
  ) {
    criterion = "unpaid_receipt_readable";
    qualification = "useful";
  } else if (raw.disposition === "useful") {
    qualification = "not_useful";
  }
  return { derived, qualification, criterion, httpStatus, assertedSuccess };
}

export function qualifyBinding({
  token,
  suppliedToken,
  taskLabel,
  operationId,
  method,
  route,
  outcomeSchema,
  outcomeSchemaVersion,
  classification,
  outcome,
  assertedDigest = null,
  correctionOf = null,
  now = Date.now(),
  expiresAt,
}) {
  if (!METHODS.has(method)) fail("method_rejected");
  if (typeof route !== "string" || !ROUTE.test(route) || route.includes("..")) fail("route_rejected");
  if (typeof outcomeSchema !== "string" || !SCHEMA_NAME.test(outcomeSchema)) fail("schema_rejected");
  if (typeof outcomeSchemaVersion !== "string" || !SCHEMA_NAME.test(outcomeSchemaVersion)) fail("schema_rejected");
  if (assertedDigest !== null && !HEX64.test(assertedDigest)) fail("digest_rejected");
  if (correctionOf !== null && typeof correctionOf !== "string") fail("correction_rejected");
  const { claim, cohort, actorLabel } = claimFor({
    token,
    suppliedToken,
    taskLabel,
    operationId,
    classification,
  });
  const projected = projectOutcome(outcome);
  const computedDigest = projected.derived ? digestOf(projected.derived) : null;
  const assertedDigestMatches = assertedDigest === null
    ? null
    : assertedDigest === computedDigest;
  // A caller digest is an assertion. It neither creates nor cancels the body criterion.
  const criterion = projected.criterion;
  const qualification = criterion === "unpaid_receipt_readable"
    ? "useful"
    : projected.derived
      ? (projected.qualification === "useful" ? "not_useful" : projected.qualification)
      : "unavailable";
  const taskDigest = bindingDigest({ method, operationId, outcomeSchema, outcomeSchemaVersion, route });
  const sourceSha = digestOf({
    computedDigest,
    qualification,
    taskDigest,
  });
  const recordId = createHash("sha256")
    .update(`${claim.taskRef}\0${operationId}\0${now}\0${computedDigest || ""}\0${correctionOf || ""}`)
    .digest("hex")
    .slice(0, 32);
  const eventId = `evt-${recordId.slice(0, 20)}`;
  const commerceEventId = stableForwardEventId(`${operationId}\0reuse\0${claim.taskRef}\0${recordId}`);
  const taskRefRecord = buildTaskRefRecord({ claim, commerceEventId });
  if (!taskRefRecord) fail("task_ref_rejected");
  const joinEvent = {
    actorLabel,
    cohort,
    criterion,
    eventId,
    experimentId: null,
    httpStatus: projected.httpStatus,
    operationId,
    paymentPresent: false,
    receiptDigest: criterion ? computedDigest : null,
    route,
    sourceId: SOURCE_ID,
    stage: "useful_result",
    taskDigest,
    taskRef: claim.taskRef,
    ...(correctionOf ? { correctionOf } : {}),
    ...(qualification === "failed" ? { usefulDelivery: "false", usefulReason: "delivery_failed" } : {}),
    ...(qualification === "partial" ? { usefulDelivery: "false", usefulReason: "audit_incomplete" } : {}),
    ...(qualification === "not_useful" ? { usefulDelivery: "false", usefulReason: "additional_work_missing" } : {}),
  };
  const snapshot = snapshotFor([joinEvent], {
    asOf: new Date(now).toISOString(),
    sourceSha,
    staleAfter: new Date(expiresAt).toISOString(),
    taskRef: claim.taskRef,
    taskDigest,
  });
  const readout = readJoin(snapshot);
  const task = readout.tasks.find((item) => item.taskRef === claim.taskRef) || null;
  const useful = task?.useful || "unknown";
  if (qualification === "useful" && useful !== "true") fail("joiner_disagreed");
  return {
    actorLabel,
    assertedDigest,
    assertedDigestMatches,
    assertedSuccessIgnored: projected.assertedSuccess === true,
    classification,
    cohort,
    computedDigest,
    correctionOf,
    derived: projected.derived,
    joinEvent,
    operationId,
    outcomeSchema,
    outcomeSchemaVersion,
    method,
    qualification,
    readout,
    recordId,
    route,
    sourceSha,
    taskDigest,
    taskRef: claim.taskRef,
    taskRefRecord,
    useful,
  };
}

export function snapshotFor(events, {
  asOf,
  sourceSha,
  boundSourceSha = null,
  staleAfter,
  taskRef,
  taskDigest,
  boundTaskDigest = null,
} = {}) {
  const source = {
    bytes: 0,
    id: SOURCE_ID,
    kind: "caller_outcome",
    locator: "scoped-reuse",
    sha256: sourceSha,
    stale: false,
    staleAfter,
  };
  if (boundSourceSha) source.boundSha256 = boundSourceSha;
  const declared = { taskDigest, taskRef };
  if (boundTaskDigest) declared.boundTaskDigest = boundTaskDigest;
  return {
    asOf,
    events,
    mode: "synthetic",
    schema: SNAPSHOT_SCHEMA,
    sources: [source],
    tasks: [declared],
  };
}

export function readJoin(snapshot) {
  try {
    return joinSnapshot(snapshot);
  } catch (error) {
    const code = error?.code || error?.message || "join_rejected";
    fail(code);
  }
}

export function recompute(joinEvent, context) {
  const snapshot = snapshotFor([joinEvent], context);
  return readJoin(snapshot);
}
