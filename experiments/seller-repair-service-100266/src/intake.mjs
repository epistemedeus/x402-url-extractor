import { createHash } from "node:crypto";

import { QUESTIONS } from "./constants.mjs";
import { fail } from "./errors.mjs";
import { normalizeOperation, operationIdFor } from "./operation.mjs";
import { hasDisallowedKey } from "./privacy.mjs";

const TASK_MIN = 40;
const TASK_MAX = 4000;
const SDK = /^[A-Za-z0-9][A-Za-z0-9.+_@/-]{1,63}$/;
const ALLOWED = new Set([
  "schema",
  "id",
  "callerId",
  "task",
  "origin",
  "method",
  "resource",
  "operation",
  "expectedUsefulOutput",
  "declaredSdk",
  "declaredRuntime",
  "maxEffort",
  "probeConsent",
  "question",
  "paidIntent",
  "callerEvidence",
  "patch",
]);
const CALLER = /^[a-z0-9][a-z0-9-]{0,63}$/;

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function taskDigest(task) {
  return sha256(task);
}

export function normalizeIntake(input = {}) {
  if (!plain(input)) fail("intake must be an object");
  const unknown = Object.keys(input).filter((key) => !ALLOWED.has(key));
  if (unknown.length) fail(`unsupported intake field: ${unknown.sort()[0]}`);
  if (hasDisallowedKey(input)) fail("intake contains a private field");

  const task = typeof input.task === "string" ? input.task : "";
  if (task.trim().length < TASK_MIN || task.length > TASK_MAX || /[\u0000-\u001f\u007f]/.test(task)) {
    fail("task must be 40-4000 characters without control characters");
  }
  const expected = input.expectedUsefulOutput;
  if (!plain(expected) || !Array.isArray(expected.paths) || expected.paths.length < 1) {
    fail("expectedUsefulOutput.paths must name at least one dotted path");
  }
  const extraExpected = Object.keys(expected).filter((key) => !["paths", "equals"].includes(key));
  if (extraExpected.length) fail(`unsupported expectedUsefulOutput field: ${extraExpected[0]}`);
  if (expected.equals !== undefined) {
    if (!plain(expected.equals) || typeof expected.equals.path !== "string" || !("value" in expected.equals)) {
      fail("expectedUsefulOutput.equals must name a path and a value");
    }
    const value = expected.equals.value;
    const stringOk = typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
    if (typeof value !== "boolean" && !stringOk) fail("expectedUsefulOutput.equals.value must be a boolean or a short string");
  }

  let normalized;
  try {
    normalized = normalizeOperation({
      origin: input.origin,
      route: input.resource,
      method: input.method || "GET",
      requiredPaths: expected.paths,
    });
  } catch (error) {
    fail(error.message);
  }
  const identity = operationIdFor(normalized.method, normalized.route);
  if (input.operation !== undefined) {
    if (!plain(input.operation)) fail("operation must be an object");
    const extraOperation = Object.keys(input.operation).filter((key) => !["method", "resource", "operationId"].includes(key));
    if (extraOperation.length) fail(`unsupported operation field: ${extraOperation[0]}`);
    if (input.operation.method !== undefined && String(input.operation.method).toUpperCase() !== normalized.method) {
      fail("operation identity mismatch");
    }
    if (input.operation.resource !== undefined && input.operation.resource !== normalized.route) fail("operation identity mismatch");
    if (input.operation.operationId !== undefined && input.operation.operationId !== identity) fail("operation identity mismatch");
  }
  if (typeof input.callerId !== "string" || !CALLER.test(input.callerId)) fail("callerId is invalid");
  if (!plain(input.probeConsent) || input.probeConsent.confirmed !== true) fail("probeConsent must confirm the target");
  if (!["loopback", "public-read-only", "public-https"].includes(input.probeConsent.class)) fail("probeConsent class is not supported");
  const extraAuth = Object.keys(input.probeConsent).filter((key) => !["class", "confirmed"].includes(key));
  if (extraAuth.length) fail(`unsupported probeConsent field: ${extraAuth[0]}`);

  if (typeof input.declaredSdk !== "string" || !SDK.test(input.declaredSdk)) fail("declaredSdk is invalid");
  if (typeof input.declaredRuntime !== "string" || !SDK.test(input.declaredRuntime)) fail("declaredRuntime is invalid");
  if (!plain(input.maxEffort)) fail("maxEffort must be an object");
  const extraEffort = Object.keys(input.maxEffort).filter((key) => !["probes", "bodyBytes", "deadlineMs", "totalBodyBytes", "totalResponseMs", "redirects"].includes(key));
  if (extraEffort.length) fail(`unsupported maxEffort field: ${extraEffort[0]}`);
  const maxEffort = {
    probes: integer(input.maxEffort.probes, "maxEffort.probes", 1, 8),
    bodyBytes: integer(input.maxEffort.bodyBytes, "maxEffort.bodyBytes", 1, 65536),
    deadlineMs: integer(input.maxEffort.deadlineMs, "maxEffort.deadlineMs", 20, 5000),
    totalBodyBytes: integer(input.maxEffort.totalBodyBytes, "maxEffort.totalBodyBytes", 1, 524288),
    totalResponseMs: integer(input.maxEffort.totalResponseMs, "maxEffort.totalResponseMs", 20, 20000),
    redirects: integer(input.maxEffort.redirects, "maxEffort.redirects", 0, 0),
  };
  const question = input.question || "useful_output";
  if (!QUESTIONS.includes(question)) fail("question is not supported");
  if (input.paidIntent !== undefined && typeof input.paidIntent !== "boolean") fail("paidIntent must be boolean");
  if (input.callerEvidence !== undefined) {
    if (!plain(input.callerEvidence)) fail("callerEvidence must be an object");
    if (hasDisallowedKey(input.callerEvidence)) fail("callerEvidence contains a private field");
    if (input.callerEvidence.observed !== undefined) {
      const observed = input.callerEvidence.observed;
      if (!plain(observed)) fail("callerEvidence.observed must be an object");
      const extraObserved = Object.keys(observed).filter((key) => !["status", "json", "contentType"].includes(key));
      if (extraObserved.length) fail(`unsupported callerEvidence.observed field: ${extraObserved[0]}`);
      if (!Number.isInteger(observed.status) || observed.status < 100 || observed.status > 599) {
        fail("callerEvidence.observed.status is invalid");
      }
      if (observed.json !== undefined && !plain(observed.json)) fail("callerEvidence.observed.json must be an object");
      if (observed.contentType !== undefined && (typeof observed.contentType !== "string" || observed.contentType.length > 80 || /[\u0000-\u001f\u007f]/.test(observed.contentType))) {
        fail("callerEvidence.observed.contentType is invalid");
      }
    }
  }
  if (input.patch !== undefined && !plain(input.patch)) fail("patch must be an object");

  return Object.freeze({
    task,
    taskDigest: taskDigest(task),
    origin: normalized.origin,
    method: normalized.method,
    resource: normalized.route,
    expectedUsefulOutput: Object.freeze({
      paths: normalized.requiredPaths,
      equals: expected.equals ? Object.freeze({ path: expected.equals.path, value: expected.equals.value }) : null,
    }),
    callerId: input.callerId,
    operationId: identity,
    declaredSdk: input.declaredSdk,
    declaredRuntime: input.declaredRuntime,
    probeConsent: Object.freeze({ class: input.probeConsent.class, confirmed: true }),
    maxEffort: Object.freeze(maxEffort),
    question,
    paidIntent: input.paidIntent === true,
    callerEvidence: input.callerEvidence ? Object.freeze(structuredClone(input.callerEvidence)) : null,
    patch: input.patch ? Object.freeze(structuredClone(input.patch)) : null,
    charged: false,
  });
}
