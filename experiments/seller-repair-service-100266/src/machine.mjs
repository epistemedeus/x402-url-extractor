import { createHash } from "node:crypto";

import { fail } from "./errors.mjs";
import { hasDisallowedKey } from "./privacy.mjs";

const ALLOWED = new Set([
  "callerId",
  "origin",
  "operation",
  "sdk",
  "runtime",
  "expect",
  "observed",
  "task",
  "question",
  "paidIntent",
  "paidReport",
  "patch",
  "requestId",
  "probe",
  "maxEffort",
  "settlement",
  "transport",
]);

const DEFAULT_EFFORT = Object.freeze({
  probes: 4,
  bodyBytes: 16384,
  deadlineMs: 2000,
  totalBodyBytes: 65536,
  totalResponseMs: 4000,
  redirects: 0,
});

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function operationParts(operation) {
  if (typeof operation === "string") {
    const match = /^(GET)\s+(\/\S+)$/.exec(operation);
    if (!match) fail("operation must be GET and one exact path");
    return { method: "GET", resource: match[2] };
  }
  if (!plain(operation) || operation.method !== "GET" || typeof operation.resource !== "string") {
    fail("operation must be GET and one exact path");
  }
  return { method: "GET", resource: operation.resource };
}

export function normalizeMachineRequest(input = {}) {
  if (!plain(input)) fail("intake must be an object");
  const unknown = Object.keys(input).filter((key) => !ALLOWED.has(key));
  if (unknown.length) fail(`unsupported intake field: ${unknown.sort()[0]}`);
  if (hasDisallowedKey(input)) fail("intake contains a private field");
  if (input.transport !== undefined && input.transport !== "public-https") {
    return {
      unsupported: true,
      reason: "unsupported_transport",
      charged: false,
      paymentSent: false,
    };
  }
  const operation = operationParts(input.operation);
  const expect = input.expect;
  if (!plain(expect)) fail("expect must name a path and a value");
  const paths = Array.isArray(expect.paths) ? expect.paths : (typeof expect.path === "string" ? [expect.path] : null);
  if (!paths || paths.length < 1) fail("expect must name a path and a value");
  const equals = expect.value !== undefined || expect.equals
    ? (expect.equals || { path: expect.path || paths[0], value: expect.value })
    : undefined;
  const sdk = input.sdk;
  if (typeof sdk !== "string") fail("sdk is required");
  const callerId = input.callerId;
  if (typeof callerId !== "string") fail("callerId is required");
  const task = typeof input.task === "string" && input.task.trim()
    ? input.task
    : `Caller asks whether ${operation.method} ${operation.resource} on ${input.origin} returns ${paths[0]} for ${sdk}.`;
  const effort = { ...DEFAULT_EFFORT, ...(plain(input.maxEffort) ? input.maxEffort : {}) };
  const intake = {
    callerId,
    task,
    origin: input.origin,
    method: operation.method,
    resource: operation.resource,
    operation: {
      method: operation.method,
      resource: operation.resource,
      operationId: `${operation.method} ${operation.resource}`,
    },
    expectedUsefulOutput: equals ? { paths, equals } : { paths },
    declaredSdk: sdk,
    declaredRuntime: typeof input.runtime === "string" ? input.runtime : `node/${process.versions.node}`,
    maxEffort: effort,
    probeConsent: { class: "public-https", confirmed: true },
    question: input.question || "useful_output",
    paidIntent: input.paidIntent === true,
  };
  if (input.observed !== undefined) intake.callerEvidence = { observed: input.observed };
  if (input.patch !== undefined) intake.patch = input.patch;
  const comparable = { ...input };
  delete comparable.requestId;
  return {
    unsupported: false,
    intake,
    paidReport: input.paidReport || null,
    settlement: input.settlement || null,
    requestId: typeof input.requestId === "string" ? input.requestId : null,
    probe: input.probe !== false,
    digest: sha256(JSON.stringify(comparable)),
    charged: false,
  };
}
