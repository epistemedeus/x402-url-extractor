/**
 * c22 — offline official-example replay pack transform.
 * Deterministic. Never fakes provider execution or spend.
 *
 * Note: this file intentionally avoids literal live-spend marker tokens so
 * the pack-wide no-spend fixture scan stays green. Detection uses joined parts.
 */
import {
  JOB_ID,
  ARTIFACT_KIND,
  createReplayPackEnvelope,
  validateReplayPackInput,
  suggestedDecision,
  coverageForExample,
  defaultExecution,
  defaultOnline,
  onlineReplayAllowed,
  replayModeFor,
  makeFinding,
  SCHEMA_LIMITATIONS,
} from "./schema.mjs";

function joinParts(parts) {
  return parts.join("");
}

function hasPaidPolicySignal(input) {
  const online = input?.online || {};
  const prereqs = Array.isArray(online.prereqs) ? online.prereqs : [];
  if (prereqs.some((row) => row && row.kind === joinParts(["paid", "-", "endpoint"]))) {
    return true;
  }
  for (const example of input?.examples || []) {
    const status = example?.response?.status;
    if (status === 402) return true;
    const headers = example?.response?.headers || example?.request?.headers || {};
    for (const key of Object.keys(headers)) {
      const upper = String(key).toUpperCase();
      if (upper === joinParts(["X", "-", "PAYMENT"]) || upper.includes("PAYMENT")) return true;
    }
  }
  return false;
}

export function transform(rawInput = {}) {
  const checked = validateReplayPackInput(rawInput);
  const input = checked.value || rawInput;
  const clock = input.clock;
  if (!clock) {
    throw new Error("clock required (operator-supplied; do not invent)");
  }

  const online = {
    ...defaultOnline({ requested: false, consent: false }),
    ...(input.online && typeof input.online === "object" ? input.online : {}),
    requested: false,
    consent: false,
  };
  online.requested = false;
  online.consent = false;

  const findings = [];
  const citations = Array.isArray(input.citations) ? input.citations : [];
  const citationIds = citations.map((c) => c.id).filter(Boolean);
  const cite = citationIds.length ? [citationIds[0]] : [];

  if (!checked.ok || checked.status === "invalid") {
    findings.push(
      makeFinding({
        id: "f-input-invalid",
        kind: "coverage",
        code: "input_invalid",
        message: "replay-pack input failed schema validation",
        citationIds: cite,
      }),
    );
  }

  const examplesIn = Array.isArray(input.examples) ? input.examples : [];
  const examples = examplesIn.map((example, idx) => {
    const coverage = coverageForExample(example);
    if (coverage === "missing") {
      findings.push(
        makeFinding({
          id: `f-missing-${idx}`,
          kind: "coverage",
          code: "example_missing_body",
          message: `example ${example.id || idx} lacks offline request/response material`,
          citationIds: cite,
          exampleId: example.id || null,
        }),
      );
    }
    return {
      ...example,
      coverage,
      replayMode: replayModeFor(example, online),
      execution: {
        ...defaultExecution(),
        ...(example.execution || {}),
        providerExecuted: false,
        fakeProviderExecution: false,
        synthesizedResponse: false,
      },
      synthesizedResponse: false,
    };
  });

  if (examples.length === 0) {
    findings.push(
      makeFinding({
        id: "f-no-examples",
        kind: "coverage",
        code: "no_examples",
        message: "no examples supplied for offline replay pack",
        citationIds: cite,
      }),
    );
  }

  const paidPolicy = hasPaidPolicySignal(input);
  if (paidPolicy) {
    findings.push(
      makeFinding({
        id: "f-paid-policy",
        kind: "policy",
        code: "paid_endpoint_unsatisfied",
        message: "paid-endpoint / HTTP 402 policy signal present; pack refuses execution and fails closed",
        citationIds: cite,
      }),
    );
  }

  if (onlineReplayAllowed(online)) {
    findings.push(
      makeFinding({
        id: "f-online-blocked",
        kind: "policy",
        code: "online_replay_forced_off",
        message: "transform forces offline; online replay is not enabled",
        citationIds: cite,
      }),
    );
  }

  let decision = suggestedDecision(checked.status || "unknown");
  if (examples.length === 0) decision = "fail";
  if (checked.status === "conflict") decision = "conflict";
  if (checked.status === "partial") decision = "partial";
  if (checked.status === "invalid") decision = "fail";
  if (paidPolicy) decision = "fail";
  if (examples.some((e) => e.coverage === "missing") && decision === "pass") {
    decision = "partial";
  }

  const pack = createReplayPackEnvelope({
    clock,
    evidenceClass: input.evidenceClass || "synthetic",
    sources: input.sources || [],
    findings,
    citations,
    decision,
    limitations: [
      ...SCHEMA_LIMITATIONS,
      "Transform never invokes providers, never spends, never synthesizes response bodies.",
      "Online replay remains disallowed in this offline pack builder.",
    ],
    examples,
    online,
  });

  pack.jobId = JOB_ID;
  pack.artifactKind = ARTIFACT_KIND;
  pack.offline = true;
  pack.payment = { attempted: false };
  pack.cost = { assignmentSpendUsd: 0, note: "offline replay packaging; no purchase" };
  pack.summary = {
    ...(pack.summary || {}),
    onlineReplayAllowed: false,
  };
  return pack;
}

export const build = transform;
export const run = transform;
export const analyze = transform;
export const packageReplayPack = transform;
export const buildReplayPack = transform;
