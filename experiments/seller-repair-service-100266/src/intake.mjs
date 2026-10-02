import { createHash } from "node:crypto";

import { SellerIntegrityAuditError, normalizeSellerIntegrityAuditInput } from "../../../seller-integrity-audit.mjs";
import { hasDisallowedKey } from "../../../task-linked-delivery/experiments/delivery-outcome-100173/src/privacy.mjs";
import { QUESTIONS } from "./constants.mjs";
import { fail } from "./errors.mjs";

const TASK_MIN = 40;
const TASK_MAX = 4000;
const SDK = /^[A-Za-z0-9][A-Za-z0-9.+_@/-]{1,63}$/;
const ALLOWED = new Set([
  "schema",
  "id",
  "task",
  "origin",
  "method",
  "resource",
  "expectedUsefulOutput",
  "declaredSdk",
  "declaredRuntime",
  "maxEffort",
  "question",
  "paidIntent",
  "callerEvidence",
  "patch",
]);

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
    if (typeof expected.equals.value !== "string" || expected.equals.value.length > 64) {
      fail("expectedUsefulOutput.equals.value must be a short string");
    }
  }

  let normalized;
  try {
    normalized = normalizeSellerIntegrityAuditInput({
      origin: input.origin,
      route: input.resource,
      method: input.method || "GET",
      requiredPaths: expected.paths,
    });
  } catch (error) {
    if (error instanceof SellerIntegrityAuditError) fail(error.message);
    throw error;
  }

  if (typeof input.declaredSdk !== "string" || !SDK.test(input.declaredSdk)) fail("declaredSdk is invalid");
  if (typeof input.declaredRuntime !== "string" || !SDK.test(input.declaredRuntime)) fail("declaredRuntime is invalid");
  if (!plain(input.maxEffort)) fail("maxEffort must be an object");
  const maxEffort = {
    probes: integer(input.maxEffort.probes, "maxEffort.probes", 1, 8),
    bodyBytes: integer(input.maxEffort.bodyBytes, "maxEffort.bodyBytes", 1, 65536),
    deadlineMs: integer(input.maxEffort.deadlineMs, "maxEffort.deadlineMs", 20, 5000),
  };
  const question = input.question || "useful_output";
  if (!QUESTIONS.includes(question)) fail("question is not supported");
  if (input.paidIntent !== undefined && typeof input.paidIntent !== "boolean") fail("paidIntent must be boolean");
  if (input.callerEvidence !== undefined) {
    if (!plain(input.callerEvidence)) fail("callerEvidence must be an object");
    if (hasDisallowedKey(input.callerEvidence)) fail("callerEvidence contains a private field");
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
    declaredSdk: input.declaredSdk,
    declaredRuntime: input.declaredRuntime,
    maxEffort: Object.freeze(maxEffort),
    question,
    paidIntent: input.paidIntent === true,
    callerEvidence: input.callerEvidence ? Object.freeze(structuredClone(input.callerEvidence)) : null,
    patch: input.patch ? Object.freeze(structuredClone(input.patch)) : null,
    charged: false,
  });
}
