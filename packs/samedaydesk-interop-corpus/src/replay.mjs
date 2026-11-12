/**
 * Replays of recorded earlier implementations, and evaluation of a corpus case
 * against observations a consumer makes with the changed implementation.
 *
 * The recorded mappers below are the author's own earlier code, reproduced so
 * the earlier negative can be shown on demand:
 *   b38dc14b experiments/n12-compatibility-knowledge/page-change-compatibility-mapping.mjs blob 25ea0e59
 *   24556fe2 same path, blob a89e41a3
 * This module has no runtime dependency. The consumer brings the changed
 * implementation (samedaydesk-capability-compat at c060afcd) and the live
 * observations.
 */

const FREE_TOOL = "compare_page_observations";
const UNKNOWN_TOOL_CODE = -32602;
const NEXT_METHOD = "tools/list";

function unknownToolMapper({ exactMessage }) {
  return function mapUnknownToolRecovery(error, { attemptedName } = {}) {
    const code = error?.code;
    const message = error?.message;
    const data = error?.data;
    if (code !== UNKNOWN_TOOL_CODE) throw new Error("unknown_tool_recovery_unmapped");
    if (exactMessage ? message !== "Unknown tool" : !/Unknown tool/.test(String(message ?? ""))) {
      throw new Error("unknown_tool_recovery_unmapped");
    }
    if (!data || data.nextMethod !== NEXT_METHOD) throw new Error("unknown_tool_recovery_unmapped");
    const tools = Array.isArray(data.availableTools) ? data.availableTools : [];
    if (tools.length !== 1 || tools[0] !== FREE_TOOL) throw new Error("unknown_tool_recovery_unmapped");
    const serialized = JSON.stringify(error);
    if (attemptedName && serialized.includes(attemptedName)) {
      throw new Error("unknown_tool_recovery_reflected_name");
    }
    return { nextMethod: data.nextMethod, tool: tools[0], paidFallback: false };
  };
}

export const RECORDED_UNKNOWN_TOOL_MAPPERS = Object.freeze({
  b38dc14b: unknownToolMapper({ exactMessage: true }),
  "24556fe2": unknownToolMapper({ exactMessage: false }),
});

export function recordedUnknownToolMapper(revision) {
  const mapper = RECORDED_UNKNOWN_TOOL_MAPPERS[revision];
  if (!mapper) throw new Error(`no recorded unknown-tool mapper at ${revision}`);
  return mapper;
}

function tryMap(mapper, error, options) {
  try {
    return { accepted: true, mapped: mapper(error, options), error: null };
  } catch (caught) {
    return { accepted: false, mapped: null, error: caught.message };
  }
}

/** Earlier pack behavior at 967ec6a2 (describe-capabilities.mjs line 207): sha comparison only. */
export function recordedShaOnlySourceCheck(expected, observed) {
  return {
    sourceChanged: Boolean(expected?.sha && observed?.sha && expected.sha !== observed.sha),
    sdkClassified: false,
    serviceClassified: false,
    classification: "sha-only",
  };
}

function subsetMatches(expected, actual) {
  return Object.entries(expected).every(([key, value]) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return actual && typeof actual[key] === "object" && subsetMatches(value, actual[key]);
    }
    if (Array.isArray(value)) return JSON.stringify(value) === JSON.stringify(actual?.[key]);
    return actual?.[key] === value;
  });
}

function evaluateUnknownTool(entry, observation) {
  const { error, changedAccepts, recovered, attemptedName } = observation;
  const recorded = tryMap(recordedUnknownToolMapper(entry.replay.recordedMapper), error, { attemptedName });
  const fixed = tryMap(recordedUnknownToolMapper(entry.replay.fixedMapper), error, { attemptedName });
  const signature = entry.earlierNegative.signature;
  const reproduced = !recorded.accepted && recorded.error === signature.recordedMapperError;
  const recoveryOk = Boolean(recovered) && subsetMatches(entry.recovery.expected, recovered);
  return {
    earlierNegative: {
      reproduced,
      outcomeClass: reproduced ? "known_failure" : "successful",
      recordedMapper: entry.replay.recordedMapper,
      recordedMapperError: recorded.error,
    },
    fixedMapper: { revision: entry.replay.fixedMapper, accepted: fixed.accepted, error: fixed.error },
    changedImplementation: {
      accepts: Boolean(changedAccepts),
      recovered: recoveryOk,
      outcomeClass: changedAccepts && recoveryOk ? "successful" : "known_failure",
    },
    observedMessage: typeof error?.message === "string" ? error.message : null,
  };
}

function evaluateEraPin(entry, observation) {
  const { probe, recovered } = observation;
  const signature = entry.earlierNegative.signature;
  const messageOk = new RegExp(signature.discoverMessagePattern).test(String(probe?.discover?.errorMessage ?? ""));
  const reproduced = Boolean(probe)
    && probe.connected === false
    && probe.code === signature.sdkErrorCode
    && probe.discover?.status === signature.discoverHttpStatus
    && probe.discover?.errorCode === signature.discoverJsonRpcCode
    && messageOk;
  const protocolOk = recovered?.protocol == null || recovered.protocol === entry.recovery.protocol;
  const recoveryOk = Boolean(recovered) && protocolOk && subsetMatches(entry.recovery.expected, recovered);
  return {
    earlierNegative: { reproduced, outcomeClass: reproduced ? "unsupported" : "successful" },
    changedImplementation: { recovered: recoveryOk, outcomeClass: recoveryOk ? "successful" : "known_failure" },
  };
}

function evaluateSourceDrift(entry, observation) {
  const { expected, observed, drift } = observation;
  const earlier = recordedShaOnlySourceCheck(expected, observed);
  const signature = entry.earlierNegative.signature;
  const versionsMatch = (signature.expectedSdkVersion === undefined || signature.expectedSdkVersion === expected?.sdkVersion)
    && (signature.observedSdkVersion === undefined || signature.observedSdkVersion === observed?.sdkVersion)
    && (signature.expectedServiceVersion === undefined || signature.expectedServiceVersion === expected?.serviceVersion)
    && (signature.observedServiceVersion === undefined || signature.observedServiceVersion === observed?.serviceVersion);
  const reproduced = versionsMatch && earlier.classification === signature.earlierClassification;
  const want = entry.recovery.expected;
  const change = (drift?.changes || []).find((item) => item.kind === want.changeKind);
  const recoveryOk = Boolean(drift?.ok)
    && drift.classification === want.classification
    && Boolean(change)
    && change.recovery?.action === entry.recovery.action
    && (want.protocol === undefined || change.recovery?.protocol === want.protocol);
  return {
    earlierNegative: { reproduced, outcomeClass: reproduced ? "known_failure" : "successful", earlier },
    changedImplementation: { recovered: recoveryOk, outcomeClass: recoveryOk ? "successful" : "known_failure" },
  };
}

const EVALUATORS = Object.freeze({
  "unknown-tool-mapper": evaluateUnknownTool,
  "era-pin-refusal": evaluateEraPin,
  "source-drift": evaluateSourceDrift,
});

/**
 * Evaluate one corpus case. `ok` is true only when the earlier negative is
 * reproduced as recorded and the changed implementation recovers as recorded.
 */
export function evaluateCase(entry, observation = {}) {
  const evaluate = EVALUATORS[entry?.replay?.kind];
  if (!evaluate) throw new Error(`no evaluator for replay kind ${entry?.replay?.kind}`);
  const result = evaluate(entry, observation);
  const ok = result.earlierNegative.outcomeClass === entry.outcomeClass.earlierNegative
    && result.changedImplementation.outcomeClass === entry.outcomeClass.changedImplementation;
  return { caseId: entry.id, consumer: entry.consumer, ok, ...result };
}
