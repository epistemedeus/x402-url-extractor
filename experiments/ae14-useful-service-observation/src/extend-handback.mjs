// Wraps the existing caller-result feedback service. Canonical journals stay
// on that writer. Extension rows are this package's observation of declared
// retained-use, next-task, and operator-supplied continuation controls.

import {
  CALLER_RESULT_DISPOSITIONS,
  CALLER_RESULT_REASON_CATEGORIES,
  CALLER_RESULT_TOKEN_RE,
} from "../../../caller-result-client/src/contract.mjs";
import { createCallerResultFeedbackService, readCallerResultFeedbackToken } from "../../../caller-result-feedback.mjs";
import { isHistoricalV1PaidSuccess } from "../../../http-delivery-evidence/historical.mjs";
import { USEFULNESS_UNKNOWN as PORT_UNKNOWN } from "../../../http-delivery-evidence/classify.mjs";
import { openStore } from "../../../http-delivery-evidence/store.mjs";
import {
  COVERAGE_GAP,
  COVERAGE_RESULT,
  COVERAGE_WINDOW,
  CONTINUATION_ACCESS,
  MAX_EXTENSION_BYTES,
  NEXT_TASK_RELATIONS,
  OBSERVATION_SCHEMA,
  ORIGIN_LABELS,
  RETAINED_USE,
  SERVING_SOURCE_SHA,
  SHA256_HEX,
  SHA40,
  TASK_REF,
  TENANT_ID,
  TX,
  USEFULNESS_UNKNOWN,
} from "./contract.mjs";
import { admitObservation, appendObservation, readObservationFile, sha256 } from "./journal.mjs";
import { loadObservationInputs, observeLoaded, reportLoaded } from "./observe.mjs";

const DISPOSITIONS = new Set(CALLER_RESULT_DISPOSITIONS);
const REASONS = new Set(CALLER_RESULT_REASON_CATEGORIES);
const RETAINED = new Set(RETAINED_USE);
const RELATIONS = new Set(NEXT_TASK_RELATIONS);
const LABELS = new Set(ORIGIN_LABELS);
const ACCESS = new Set(CONTINUATION_ACCESS);
const CANONICAL_KEYS = new Set(["disposition", "reasonCategory"]);
const EXTENSION_KEYS = new Set([
  "disposition",
  "reasonCategory",
  "retainedUse",
  "nextTask",
  "originLabel",
  "tenant",
  "sourceSha",
  "priorBinding",
  "decline",
]);

if (PORT_UNKNOWN !== USEFULNESS_UNKNOWN) {
  throw new Error("usefulness_unknown_diverged");
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function refusal(code, statusCode) {
  return {
    statusCode,
    body: {
      ok: false,
      accepted: false,
      bound: false,
      charged: false,
      payerIdentity: false,
      usefulness: USEFULNESS_UNKNOWN,
      code,
      coverage: COVERAGE_RESULT,
      e08UsefulWork: "unknown",
    },
  };
}

function leaky(value) {
  return typeof value === "string" && (
    value.length > 80
    || /[@]|:\/\/|payment-signature|bearer\s|wallet|BEGIN /i.test(value)
    || /^0x[a-fA-F0-9]{40}$/.test(value)
  );
}

function canonicalBody(body) {
  if (body.reasonCategory === undefined || body.reasonCategory === null) return { disposition: body.disposition };
  return { disposition: body.disposition, reasonCategory: body.reasonCategory };
}

function usesExtension(body, priorCapability) {
  if (typeof priorCapability === "string" && priorCapability.length > 0) return true;
  if (!plain(body)) return false;
  return Object.keys(body).some((key) => !CANONICAL_KEYS.has(key));
}

function sameHandback(left, right) {
  return left.disposition === right.disposition
    && left.reasonCategory === right.reasonCategory
    && left.retainedUse === right.retainedUse
    && left.originLabel === right.originLabel
    && JSON.stringify(left.nextTask) === JSON.stringify(right.nextTask)
    && JSON.stringify(left.priorBinding) === JSON.stringify(right.priorBinding);
}

function recordIdFor(kind, paidEvidenceId, extra = "") {
  return `uso_${sha256(`${kind}\0${paidEvidenceId}\0${extra}`).slice(0, 32)}`;
}

async function capturesFor(dataDir, claims) {
  const store = openStore(dataDir);
  const historical = await store.readHistorical();
  const paidRows = historical
    .filter((item) => item.kind === "historical_v1_not_checked" && item.row?.id === claims.eventId)
    .map((item) => item.row)
    .filter((row) => isHistoricalV1PaidSuccess(row));
  if (paidRows.length === 0) return { ok: false, code: "missing_capture" };
  if (paidRows.length > 1) return { ok: false, code: "duplicate_capture" };
  const paid = paidRows[0];
  if (paid.route !== claims.route || paid.method !== claims.method) return { ok: false, code: "route_mismatch" };
  if (paid.requestDigest !== claims.requestDigest) return { ok: false, code: "request_mismatch" };
  if (paid.responseDigest !== claims.responseDigest) return { ok: false, code: "response_mismatch" };
  if (typeof paid.settlementReference !== "string" || !TX.test(paid.settlementReference.toLowerCase())) {
    return { ok: false, code: "settlement_unbound" };
  }
  const validations = await store.readValidations();
  const exact = validations.filter((row) => (
    row.paidEvidenceId === paid.id
    && row.method === paid.method
    && row.resource === paid.route
    && row.requestDigest === paid.requestDigest
    && row.responseDigest === paid.responseDigest
    && typeof row.settlementReference === "string"
    && row.settlementReference.toLowerCase() === paid.settlementReference.toLowerCase()
    && row.usefulness === USEFULNESS_UNKNOWN
  ));
  if (exact.length === 0) return { ok: false, code: "missing_capture" };
  return { ok: true, paid, settlementReference: paid.settlementReference.toLowerCase(), validation: exact[0] };
}

function parseNextTask(value) {
  if (value === undefined) return { ok: true, nextTask: null };
  if (!plain(value)) return { ok: false, code: "malformed_extension" };
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "relation,taskRef") return { ok: false, code: "unbounded_field" };
  if (!RELATIONS.has(value.relation) || !TASK_REF.test(value.taskRef || "") || leaky(value.taskRef)) {
    return { ok: false, code: "malformed_extension" };
  }
  if (value.relation === "none" && value.taskRef !== "none") return { ok: false, code: "malformed_extension" };
  return { ok: true, nextTask: { relation: value.relation, taskRef: value.taskRef } };
}

function parsePriorBinding(value) {
  if (value === undefined) return { ok: true, priorBinding: null };
  if (!plain(value)) return { ok: false, code: "malformed_extension" };
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "paidEvidenceId,taskRef") return { ok: false, code: "unbounded_field" };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.paidEvidenceId || "")) {
    return { ok: false, code: "malformed_extension" };
  }
  if (!TASK_REF.test(value.taskRef || "") || leaky(value.taskRef)) return { ok: false, code: "malformed_extension" };
  return { ok: true, priorBinding: { paidEvidenceId: value.paidEvidenceId, taskRef: value.taskRef } };
}

function parseExtension(body, rawBody, { tenant, sourceSha }) {
  if (Buffer.isBuffer(rawBody) && rawBody.length > MAX_EXTENSION_BYTES) return { ok: false, code: "body_too_large" };
  if (typeof rawBody === "string" && Buffer.byteLength(rawBody) > MAX_EXTENSION_BYTES) return { ok: false, code: "body_too_large" };
  if (!plain(body)) return { ok: false, code: "malformed_body" };
  const keys = Object.keys(body);
  if (keys.some((key) => !EXTENSION_KEYS.has(key) || leaky(key))) return { ok: false, code: "unbounded_field" };
  if (body.decline === true) {
    if (keys.length !== 1) return { ok: false, code: "unbounded_field" };
    return { ok: true, decline: true };
  }
  if (body.decline !== undefined) return { ok: false, code: "malformed_extension" };
  if (!DISPOSITIONS.has(body.disposition)) return { ok: false, code: "disposition_rejected" };
  if (body.reasonCategory !== undefined && !REASONS.has(body.reasonCategory)) return { ok: false, code: "reason_rejected" };
  if (body.retainedUse !== undefined && !RETAINED.has(body.retainedUse)) return { ok: false, code: "malformed_extension" };
  if (body.originLabel !== undefined && !LABELS.has(body.originLabel)) return { ok: false, code: "malformed_extension" };
  if (body.tenant !== undefined && body.tenant !== tenant) return { ok: false, code: "tenant_refused" };
  if (body.tenant !== undefined && !TENANT_ID.test(body.tenant)) return { ok: false, code: "tenant_refused" };
  if (body.sourceSha !== undefined && body.sourceSha !== sourceSha) return { ok: false, code: "source_refused" };
  if (body.sourceSha !== undefined && !SHA40.test(body.sourceSha)) return { ok: false, code: "source_refused" };
  const nextTask = parseNextTask(body.nextTask);
  if (!nextTask.ok) return nextTask;
  const prior = parsePriorBinding(body.priorBinding);
  if (!prior.ok) return prior;
  if (nextTask.nextTask?.relation === "distinct_later_task" && prior.priorBinding && nextTask.nextTask.taskRef === prior.priorBinding.taskRef) {
    return { ok: false, code: "malformed_extension" };
  }
  return {
    ok: true,
    decline: false,
    disposition: body.disposition,
    reasonCategory: body.reasonCategory === undefined ? null : body.reasonCategory,
    retainedUse: body.retainedUse === undefined ? null : body.retainedUse,
    nextTask: nextTask.nextTask,
    priorBinding: prior.priorBinding,
    originLabel: body.originLabel === undefined ? "unknown" : body.originLabel,
    assertedTenant: body.tenant !== undefined,
    assertedSource: body.sourceSha !== undefined,
  };
}

function statusFor(code) {
  if (code === "body_too_large") return 413;
  if (code === "tenant_refused" || code === "source_refused") return 403;
  if (code === "tampered_capability" || code === "malformed_capability" || code === "expired_capability" || code === "wrong_caller" || code === "key_absent") {
    return code === "key_absent" ? 503 : 401;
  }
  if (code === "missing_capture" || code === "duplicate_capture" || code === "request_mismatch" || code === "response_mismatch" || code === "route_mismatch" || code === "settlement_unbound" || code === "conflicting_extension" || code === "result_mismatch") {
    return 409;
  }
  if (code === "observation_full" || code === "journal_write_failed") return 503;
  return 400;
}

export function createUsefulServiceObservation({
  dataDir,
  key = "",
  tenant = "serving",
  sourceSha = SERVING_SOURCE_SHA,
  feedback = null,
  now = () => Date.now(),
} = {}) {
  if (typeof dataDir !== "string" || dataDir.length === 0) throw new Error("data directory is required");
  if (!TENANT_ID.test(tenant)) throw new Error("tenant id rejected");
  if (!SHA40.test(sourceSha)) throw new Error("source sha rejected");
  const service = feedback || createCallerResultFeedbackService({ dataDir, key, now });

  async function verifyPrior(header, expectedId) {
    if (typeof header !== "string" || !CALLER_RESULT_TOKEN_RE.test(header)) return { ok: false, code: "wrong_caller" };
    const verified = readCallerResultFeedbackToken(header, key, now());
    if (!verified.ok) return { ok: false, code: verified.code === "tampered_capability" ? "tampered_capability" : "wrong_caller" };
    if (verified.claims.eventId !== expectedId) return { ok: false, code: "wrong_caller" };
    const bound = await capturesFor(dataDir, verified.claims);
    if (!bound.ok) return bound;
    return { ok: true, capabilityHash: sha256(header), claims: verified.claims };
  }

  function publicSuccess(canonical, record, idempotentReplay) {
    return {
      statusCode: canonical.statusCode,
      body: {
        ...canonical.body,
        idempotentReplay,
        retainedUse: record.retainedUse,
        nextTaskBound: Boolean(record.nextTask),
        declaredNextTaskRelation: record.nextTask?.relation || null,
        observedRepeat: "unknown",
        originLabel: record.originLabel,
        usefulness: USEFULNESS_UNKNOWN,
        charged: false,
        payerIdentity: false,
        coverage: COVERAGE_RESULT,
        e08UsefulWork: "unknown",
      },
    };
  }

  async function submitExtension({ token, body, rawBody, query, priorCapability } = {}) {
    if (!usesExtension(body, priorCapability)) {
      return service.submit({ token, body, rawBody, query });
    }
    if (query && typeof query === "object" && Object.keys(query).length > 0) return refusal("query_rejected", 400);
    const parsed = parseExtension(body, rawBody, { tenant, sourceSha });
    if (!parsed.ok) return refusal(parsed.code, statusFor(parsed.code));
    if (typeof token !== "string" || !CALLER_RESULT_TOKEN_RE.test(token)) return refusal("malformed_capability", 401);
    const verified = readCallerResultFeedbackToken(token, key, now());
    if (!verified.ok) return refusal(verified.code, statusFor(verified.code));
    try {
      return await admitObservation(dataDir, async () => {
        if (parsed.decline) {
          const bound = await capturesFor(dataDir, verified.claims);
          if (!bound.ok) return refusal(bound.code, statusFor(bound.code));
          const existing = await readObservationFile(dataDir);
          const prior = existing.rows.filter((row) => row.paidEvidenceId === verified.claims.eventId);
          if (prior.some((row) => row.tenant !== tenant)) return refusal("tenant_refused", 403);
          if (prior.some((row) => row.kind === "decline")) {
            return {
              statusCode: 200,
              body: {
                ok: true,
                accepted: false,
                declined: true,
                bound: true,
                idempotentReplay: true,
                charged: false,
                payerIdentity: false,
                usefulness: USEFULNESS_UNKNOWN,
                code: null,
                coverage: COVERAGE_RESULT,
                e08UsefulWork: "unknown",
              },
            };
          }
          if (prior.length > 0) return refusal("conflicting_extension", 409);
          const record = {
            schemaVersion: OBSERVATION_SCHEMA,
            kind: "decline",
            recordId: recordIdFor("decline", verified.claims.eventId),
            paidEvidenceId: verified.claims.eventId,
            requestDigest: verified.claims.requestDigest,
            responseDigest: verified.claims.responseDigest,
            route: verified.claims.route,
            method: verified.claims.method,
            settlementReference: bound.settlementReference,
            capabilityHash: sha256(token),
            disposition: null,
            reasonCategory: null,
            retainedUse: null,
            nextTask: null,
            priorBinding: null,
            originLabel: "unknown",
            tenant,
            sourceSha,
            evidence: "caller_declared",
            usefulness: USEFULNESS_UNKNOWN,
            declined: true,
            receivedAt: new Date(now()).toISOString(),
            channel: "http",
          };
          if (JSON.stringify(record).includes(token)) return refusal("bearer_retained", 500);
          await appendObservation(dataDir, record);
          return {
            statusCode: 200,
            body: {
              ok: true,
              accepted: false,
              declined: true,
              bound: true,
              idempotentReplay: false,
              charged: false,
              payerIdentity: false,
              usefulness: USEFULNESS_UNKNOWN,
              disposition: null,
              code: null,
              coverage: COVERAGE_RESULT,
              e08UsefulWork: "unknown",
            },
          };
        }
        let priorBinding = null;
        if (parsed.priorBinding) {
          if (parsed.priorBinding.paidEvidenceId === verified.claims.eventId) return refusal("result_mismatch", 409);
          const prior = await verifyPrior(priorCapability, parsed.priorBinding.paidEvidenceId);
          if (!prior.ok) return refusal(prior.code, statusFor(prior.code));
          priorBinding = {
            paidEvidenceId: parsed.priorBinding.paidEvidenceId,
            taskRef: parsed.priorBinding.taskRef,
            capabilityHash: prior.capabilityHash,
          };
        } else if (typeof priorCapability === "string" && priorCapability.length > 0) {
          return refusal("unbounded_field", 400);
        }
        const existing = await readObservationFile(dataDir);
        const forEvent = existing.rows.filter((row) => row.paidEvidenceId === verified.claims.eventId);
        if (forEvent.some((row) => row.tenant !== tenant)) return refusal("tenant_refused", 403);
        const own = forEvent.filter((row) => row.tenant === tenant);
        const intended = {
          disposition: parsed.disposition,
          reasonCategory: parsed.reasonCategory,
          retainedUse: parsed.retainedUse,
          originLabel: parsed.originLabel,
          nextTask: parsed.nextTask,
          priorBinding,
        };
        const previous = own.find((row) => row.kind === "handback");
        if (own.some((row) => row.kind === "decline")) return refusal("conflicting_extension", 409);
        if (previous && !sameHandback(previous, intended)) {
          return {
            statusCode: 409,
            body: {
              ...refusal("conflicting_extension", 409).body,
              retainedDisposition: previous.disposition,
              retainedUse: previous.retainedUse,
            },
          };
        }
        const canonical = await service.submit({
          token,
          body: canonicalBody(parsed),
          rawBody: Buffer.from(JSON.stringify(canonicalBody(parsed))),
          query: {},
        });
        if (canonical.statusCode !== 200 || canonical.body?.accepted !== true) return canonical;
        if (previous) return publicSuccess(canonical, previous, true);
        const record = {
          schemaVersion: OBSERVATION_SCHEMA,
          kind: "handback",
          recordId: recordIdFor("handback", verified.claims.eventId),
          paidEvidenceId: verified.claims.eventId,
          requestDigest: verified.claims.requestDigest,
          responseDigest: verified.claims.responseDigest,
          route: verified.claims.route,
          method: verified.claims.method,
          settlementReference: null,
          capabilityHash: sha256(token),
          disposition: parsed.disposition,
          reasonCategory: parsed.reasonCategory,
          retainedUse: parsed.retainedUse,
          nextTask: parsed.nextTask,
          priorBinding,
          originLabel: parsed.originLabel,
          tenant,
          sourceSha,
          evidence: "caller_declared",
          usefulness: USEFULNESS_UNKNOWN,
          declined: false,
          receivedAt: new Date(now()).toISOString(),
          channel: "http",
        };
        const bound = await capturesFor(dataDir, verified.claims);
        if (!bound.ok) return refusal(bound.code, statusFor(bound.code));
        record.settlementReference = bound.settlementReference;
        const encoded = JSON.stringify(record);
        if (encoded.includes(token) || (priorCapability && encoded.includes(priorCapability))) return refusal("bearer_retained", 500);
        await appendObservation(dataDir, record);
        return publicSuccess(canonical, record, false);
      });
    } catch (error) {
      const code = error?.code === "observation_full" ? "observation_full" : "journal_write_failed";
      return refusal(code, 503);
    }
  }

  async function recordObservedContinuation(input = {}) {
    if (!plain(input)) return refusal("malformed_extension", 400);
    if (!ACCESS.has(input.access)) return refusal("malformed_extension", 400);
    if (input.tenant !== undefined && input.tenant !== tenant) return refusal("tenant_refused", 403);
    if (input.synthetic !== true && input.synthetic !== false) return refusal("malformed_extension", 400);
    const priorId = input.priorPaidEvidenceId;
    if (typeof priorId !== "string") return refusal("malformed_extension", 400);
    try {
      return await admitObservation(dataDir, async () => {
        const store = openStore(dataDir);
        const historical = await store.readHistorical();
        const paids = historical
          .filter((item) => item.kind === "historical_v1_not_checked")
          .map((item) => item.row)
          .filter((row) => isHistoricalV1PaidSuccess(row));
        const priorRows = paids.filter((row) => row.id === priorId);
        if (priorRows.length === 0) return refusal("missing_capture", 409);
        if (priorRows.length > 1) return refusal("duplicate_capture", 409);
        const prior = priorRows[0];
        const validations = await store.readValidations();
        const validation = validations.find((row) => row.paidEvidenceId === prior.id && row.usefulness === USEFULNESS_UNKNOWN);
        if (!validation) return refusal("missing_capture", 409);
        let later = null;
        if (input.access === "purchased" || input.access === "pseudonym_only") {
          later = paids.find((row) => row.id === input.laterPaidEvidenceId) || null;
          if (!later || later.id === prior.id) return refusal("missing_capture", 409);
        }
        if (input.access === "purchased") {
          if (!TX.test(String(later.settlementReference || "").toLowerCase())) return refusal("settlement_unbound", 409);
          if (!TASK_REF.test(input.taskRef || "") || !TASK_REF.test(input.priorTaskRef || "")) return refusal("malformed_extension", 400);
          if (leaky(input.taskRef) || leaky(input.priorTaskRef)) return refusal("malformed_extension", 400);
        }
        if (input.access === "free_entitled") {
          if (input.laterPaidEvidenceId) return refusal("inconsistent_access", 409);
          if (validation.validatorVerdict !== "pass") return refusal("missing_capture", 409);
        }
        if (input.access === "pseudonym_only") {
          if (input.taskRef || input.priorTaskRef) return refusal("inconsistent_access", 409);
          if (input.actorContinuity !== "pseudonym") return refusal("malformed_extension", 400);
        }
        if (input.capabilityHash !== undefined && !SHA256_HEX.test(input.capabilityHash || "")) {
          return refusal("wrong_caller", 401);
        }
        if (input.capabilityHash) {
          const existing = await readObservationFile(dataDir);
          const handback = existing.rows.find((row) => row.kind === "handback" && row.paidEvidenceId === priorId && row.tenant === tenant);
          if (!handback || handback.capabilityHash !== input.capabilityHash) return refusal("wrong_caller", 401);
        }
        const record = {
          schemaVersion: OBSERVATION_SCHEMA,
          kind: "continuation",
          recordId: recordIdFor("continuation", priorId, `${input.access}\0${input.laterPaidEvidenceId || ""}`),
          priorPaidEvidenceId: priorId,
          laterPaidEvidenceId: later?.id || null,
          access: input.access,
          taskRef: input.access === "purchased" ? input.taskRef : null,
          priorTaskRef: input.access === "purchased" ? input.priorTaskRef : null,
          actorContinuity: input.actorContinuity || "none",
          capabilityHash: input.capabilityHash || null,
          synthetic: input.synthetic === true,
          sameRequest: later ? later.requestDigest === prior.requestDigest : false,
          tenant,
          sourceSha,
          evidence: "observed",
          usefulness: USEFULNESS_UNKNOWN,
          observedAt: new Date(now()).toISOString(),
        };
        const existing = await readObservationFile(dataDir);
        const match = existing.rows.find((row) => row.recordId === record.recordId && row.tenant === tenant);
        if (match) {
          return { statusCode: 200, body: { ok: true, accepted: true, idempotentReplay: true, charged: false, usefulness: USEFULNESS_UNKNOWN, recordId: match.recordId } };
        }
        await appendObservation(dataDir, record);
        return { statusCode: 200, body: { ok: true, accepted: true, idempotentReplay: false, charged: false, usefulness: USEFULNESS_UNKNOWN, recordId: record.recordId } };
      });
    } catch (error) {
      const code = error?.code === "observation_full" ? "observation_full" : "journal_write_failed";
      return refusal(code, 503);
    }
  }

  async function snapshot(options = {}) {
    const loaded = await loadObservationInputs(dataDir);
    const extension = options.ignoreExtension ? { rows: [], rejected: 0 } : await readObservationFile(dataDir);
    const feedback = await service.readDeclarations();
    return {
      ...loaded,
      reads: loaded.reads + (options.ignoreExtension ? 0 : 1) + 1,
      feedbackDeclarations: feedback.declarations,
      extensionRows: extension.rows,
      rejectedExtensionRows: extension.rejected,
      tenant,
      windowCoverage: options.windowCoverage || COVERAGE_WINDOW,
    };
  }

  async function observe(paidEvidenceId, options = {}) {
    const input = await snapshot(options);
    return { ...observeLoaded({ ...input, paidEvidenceId }), reads: input.reads };
  }

  async function report(options = {}) {
    const input = await snapshot(options);
    return { ...reportLoaded(input), reads: input.reads };
  }

  async function compareEquippedRoutes(paidEvidenceId) {
    const directStarted = performance.now();
    const direct = await observe(paidEvidenceId, { ignoreExtension: true, windowCoverage: COVERAGE_WINDOW });
    const directMs = performance.now() - directStarted;
    const extendedStarted = performance.now();
    const extended = await observe(paidEvidenceId, { ignoreExtension: false, windowCoverage: COVERAGE_WINDOW });
    const extendedMs = performance.now() - extendedStarted;
    const review = (row) => {
      const fields = ["delivered.schemaValid", "declared.usefulnessDisposition", "declared.retainedUse", "observedRepeat.class"];
      return fields.filter((field) => {
        const value = field.split(".").reduce((item, key) => item?.[key], row);
        return value !== "unknown" && value !== null && value !== undefined;
      });
    };
    return {
      direct: {
        route: "existing_validation_and_feedback_journals",
        setupReads: direct.reads,
        latencyMs: Number(directMs.toFixed(3)),
        reviewFields: review(direct),
        retainedUse: direct.declared.retainedUse,
        observedRepeat: direct.observedRepeat.class,
      },
      extended: {
        route: "existing_journals_plus_optional_handback",
        setupReads: extended.reads,
        latencyMs: Number(extendedMs.toFixed(3)),
        reviewFields: review(extended),
        retainedUse: extended.declared.retainedUse,
        observedRepeat: extended.observedRepeat.class,
      },
      equallyEquipped: true,
      outsideUsefulAnswerArrived: extended.outsideUsefulAnswerArrived,
    };
  }

  return Object.freeze({
    dataDir,
    tenant,
    sourceSha,
    feedback: service,
    submitExtension,
    recordObservedContinuation,
    observe,
    report,
    compareEquippedRoutes,
    readExtension: () => readObservationFile(dataDir),
    windowCoverageDefault: COVERAGE_WINDOW,
    gapCoverage: COVERAGE_GAP,
  });
}
