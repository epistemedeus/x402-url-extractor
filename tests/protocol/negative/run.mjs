import { classifyJsonRpcResponse, invokeToolsCall } from "./classify.mjs";
import { evaluateNegativeSuite, evaluateToolsList } from "./evaluate.mjs";
import { loadFixture } from "./paths.mjs";
import { SERVER_INFO, withNegativeMcpClient } from "./surface.mjs";

async function runToolsList(session) {
  const fixture = loadFixture("tools-list.json");
  const listed = await session.client.listTools();
  return {
    ...evaluateToolsList(listed, fixture),
    tools: (listed.tools ?? []).map((tool) => ({
      name: tool.name,
      hasInputSchema: Boolean(tool.inputSchema),
      inputSchemaType: tool.inputSchema?.type ?? null,
      paymentRequired: tool._meta?.x402?.paymentRequired === true,
    })),
  };
}

async function runNegativeToolsCall(session, { seededOnly = false } = {}) {
  const fixture = loadFixture("negative-tools-call.json");
  const cases = seededOnly
    ? (fixture.cases ?? []).filter((item) => item.seededFailure === true)
    : fixture.cases ?? [];
  const scoped = { ...fixture, cases };
  const observationsById = {};
  const countersById = {};
  for (const fixtureCase of cases) {
    const before = session.snapshot();
    const observation = await invokeToolsCall(session.client, {
      name: fixtureCase.name,
      arguments: fixtureCase.arguments,
      meta: fixtureCase.meta,
    });
    countersById[fixtureCase.id] = session.delta(before, session.snapshot());
    observationsById[fixtureCase.id] = observation;
  }
  const evaluation = evaluateNegativeSuite(scoped, observationsById, countersById);
  evaluation.counters = session.snapshot();
  return evaluation;
}

export async function runConformance({
  includeToolsList = true,
  includeNegative = true,
  seededOnly = false,
} = {}) {
  return withNegativeMcpClient(async (session) => {
    const report = {
      status: "pass",
      surface: "mountMcp",
      serverName: SERVER_INFO.name,
      origin: session.origin,
      client: "@modelcontextprotocol/sdk@1.30.0 Client + StreamableHTTPClientTransport",
    };

    if (includeToolsList && !seededOnly) {
      report.toolsList = await runToolsList(session);
    }
    if (includeNegative) {
      report.negativeToolsCall = await runNegativeToolsCall(session, { seededOnly });
    }

    const toolsOk = report.toolsList ? report.toolsList.ok === true : true;
    const negativeOk = report.negativeToolsCall ? report.negativeToolsCall.ok === true : true;
    report.status = toolsOk && negativeOk ? "pass" : "fail";
    report.counters = session.snapshot();
    return report;
  });
}

export async function runSeededFailure() {
  return withNegativeMcpClient(async (session) => {
    const fixture = loadFixture("negative-tools-call.json");
    const seededCase = (fixture.cases ?? []).find((item) => item.seededFailure === true);
    const before = session.snapshot();
    const clientObservation = await invokeToolsCall(session.client, {
      name: seededCase.name,
      arguments: seededCase.arguments,
    });
    const clientCounters = session.delta(before, session.snapshot());

    const wireBefore = session.snapshot();
    const wire = await session.post({
      jsonrpc: "2.0",
      id: 43,
      method: "tools/call",
      params: { name: seededCase.name, arguments: seededCase.arguments ?? {} },
    });
    const wireObservation = classifyJsonRpcResponse(wire.json);
    const wireCounters = session.delta(wireBefore, session.snapshot());

    const clientEval = evaluateNegativeSuite(
      { ...fixture, cases: [seededCase] },
      { [seededCase.id]: clientObservation },
      { [seededCase.id]: clientCounters },
    );
    const wireOk = wireObservation.rejected === true
      && wireObservation.layer === (seededCase.expectedLayer ?? "mcp-protocol")
      && (seededCase.expectedCode == null || wireObservation.code === seededCase.expectedCode)
      && wireCounters.handler === 0
      && wireCounters.settle === 0
      && wireCounters.verify === 0;

    const rejected = clientEval.ok === true && wireOk;
    return {
      status: rejected ? "pass" : "fail",
      surface: "mountMcp",
      serverName: SERVER_INFO.name,
      origin: session.origin,
      client: "@modelcontextprotocol/sdk@1.30.0 Client + StreamableHTTPClientTransport",
      negativeToolsCall: clientEval,
      seededFailure: {
        id: seededCase.id,
        name: seededCase.name,
        rejected,
        layer: clientObservation.layer,
        code: clientObservation.code,
        message: clientObservation.message,
        reason: rejected
          ? seededCase.reason
          : clientEval.reason || "seeded unknown tools/call was not rejected on the wire",
        client: clientObservation,
        wire: {
          httpStatus: wire.status,
          observation: wireObservation,
          resultText: wire.json?.result?.content?.[0]?.text ?? null,
          jsonrpcError: wire.json?.error ?? null,
        },
        counters: {
          client: clientCounters,
          wire: wireCounters,
          total: session.snapshot(),
        },
      },
    };
  });
}

export const VERBS = Object.freeze([
  "run",
  "tools-list",
  "negative-tools-call",
  "seeded-failure",
  "classify",
  "help",
]);
