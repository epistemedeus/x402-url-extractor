import {
  compareHeldPages,
  compareSourceDrift,
  connectClient,
  detectPinRefusal,
  isUnknownToolError,
  loadHeldObservations,
  loadSourceDriftFixture,
  observedFactsFromPin,
  recordedFactsAt,
  recoverToSupportedProtocol,
  recoverUnknownTool,
} from "samedaydesk-capability-compat";
import {
  evaluateCase,
  loadCorpus,
  loadResiduals,
  recordedUnknownToolMapper,
} from "samedaydesk-interop-corpus";

export async function useFreeCompare(endpoint, clientSdk) {
  return compareHeldPages({ endpoint, clientSdk });
}

export async function usePinProbe(endpoint, clientSdk) {
  return detectPinRefusal({ endpoint, clientSdk });
}

export async function useRecoveredCompare(endpoint, clientSdk) {
  const recovered = await recoverToSupportedProtocol({ endpoint, clientSdk });
  try {
    const unknown = await recoverUnknownTool({ session: recovered.session });
    return {
      protocol: recovered.protocol,
      listed: unknown.listed,
      charged: unknown.body.charged,
      verdict: unknown.body.report?.verdict ?? null,
      body: unknown.body,
    };
  } finally {
    await recovered.session.close();
  }
}

// Corpus consumer. Loads the maintained interop corpus and replays every case
// against the changed implementation (samedaydesk-capability-compat at c060afcd),
// next to the recorded earlier negative.

export const CORPUS_REPLAY_SCHEMA = "samedaydesk.capability-compat-consumer.corpus-replay.v1";
const TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks";
const CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";

export async function observeUnknownTool(endpoint, clientSdk, attemptedName = "page_change") {
  const session = await connectClient({ endpoint, clientSdk });
  try {
    let error = null;
    try {
      await session.client.callTool({ name: attemptedName, arguments: loadHeldObservations() });
    } catch (caught) {
      error = caught;
    }
    const changedAccepts = isUnknownToolError(error);
    const recovery = await recoverUnknownTool({ session, unknownName: attemptedName });
    return {
      clientSdk,
      attemptedName,
      error,
      changedAccepts,
      recovered: {
        listed: recovery.listed,
        charged: recovery.body.charged,
        verdict: recovery.body.report?.verdict ?? null,
      },
    };
  } finally {
    await session.close();
  }
}

export async function observeEraPin(endpoint, clientSdk = "2.4.0") {
  const probe = await usePinProbe(endpoint, clientSdk);
  const compared = await useFreeCompare(endpoint, clientSdk);
  return {
    probe,
    recovered: {
      protocol: compared.protocol,
      charged: compared.charged,
      verdict: compared.verdict,
      paymentSignature: compared.paymentSignature,
    },
  };
}

export function observeSourceDrift(entry) {
  const fixture = loadSourceDriftFixture();
  const expected = recordedFactsAt(entry.replay.beforeCommit, fixture);
  const observed = entry.replay.afterCommit === "installed-pin"
    ? observedFactsFromPin()
    : recordedFactsAt(entry.replay.afterCommit, fixture);
  if (!expected || !observed) throw new Error(`no recorded facts for ${entry.id}`);
  const drift = compareSourceDrift({ expectedSource: expected, observed, fixture });
  return { expected, observed, drift };
}

export async function observeTasksDeclared(endpoint, clientSdk = "1.32.2") {
  const session = await connectClient({ endpoint, clientSdk });
  try {
    const result = await session.client.callTool({
      name: "compare_page_observations",
      arguments: loadHeldObservations(),
      _meta: { [CLIENT_CAPABILITIES_META_KEY]: { extensions: { [TASKS_EXTENSION_ID]: {} } } },
    });
    return {
      resultTypeTask: result.resultType === "task",
      taskId: result.taskId ?? null,
      content: Array.isArray(result.content) && result.content.length > 0,
      structuredContent: Boolean(result.structuredContent) && typeof result.structuredContent === "object",
    };
  } finally {
    await session.close();
  }
}

async function observe(entry, endpoint) {
  switch (entry.replay.kind) {
    case "unknown-tool-mapper":
      return observeUnknownTool(endpoint, entry.sourceVersions.clientSdk[0].version);
    case "era-pin-refusal":
      return observeEraPin(endpoint, entry.sourceVersions.clientSdk[0].version);
    case "source-drift":
      return observeSourceDrift(entry);
    default:
      throw new Error(`no observer for ${entry.replay.kind}`);
  }
}

/** Replay every corpus case against the changed implementation. */
export async function replayCorpus(endpoint, { cases = loadCorpus() } = {}) {
  const results = [];
  for (const entry of cases) {
    const observation = await observe(entry, endpoint);
    const evaluated = evaluateCase(entry, observation);
    results.push({
      caseId: entry.id,
      ok: evaluated.ok,
      earlierNegative: { commit: entry.earlierNegative.commit, ...evaluated.earlierNegative },
      changedImplementation: evaluated.changedImplementation,
      observedMessage: evaluated.observedMessage ?? null,
    });
  }
  return {
    schema: CORPUS_REPLAY_SCHEMA,
    changedImplementation: { package: "samedaydesk-capability-compat", version: "0.1.0", commit: "c060afcd1419cafff69d3e568ae7fc3d163c79b0" },
    scope: "baseline-relative",
    cases: results,
    ok: results.every((item) => item.ok),
  };
}

/** R-01: unknown-tool message shape per client SDK line, against the recorded b38dc14b mapper. */
export async function observeUnknownToolPairs(endpoint, { residuals = loadResiduals() } = {}) {
  const pairwise = residuals.residuals.find((item) => item.id === "R-01");
  const recordedMapper = recordedUnknownToolMapper("b38dc14b");
  const pairs = [];
  for (const pair of pairwise.pairs) {
    const observed = await observeUnknownTool(endpoint, pair.client.version);
    let recordedMapperAccepts = true;
    try { recordedMapper(observed.error); } catch { recordedMapperAccepts = false; }
    pairs.push({
      client: pair.client,
      serverProtocol: pair.serverProtocol,
      message: observed.error?.message ?? null,
      expectedMessage: pair.expectedMessage,
      recordedMapperAccepts,
      expectedRecordedMapperAccepts: pair.recordedMapperAccepts,
      changedAccepts: observed.changedAccepts,
      recovered: observed.recovered,
    });
  }
  return pairs;
}
