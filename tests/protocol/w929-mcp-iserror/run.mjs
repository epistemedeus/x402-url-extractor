import { SDS } from "./constants.mjs";
import { evaluateColdSuite, evaluateFixture, evaluateFixtureCorpus } from "./evaluate.mjs";
import { loadFixtures, loadJson, SEEDED_HTTP_200_AS_CHARGED } from "./paths.mjs";
import { SERVER_INFO, withUnpaidMcpSurface } from "./surface.mjs";

async function initialize(session) {
  return session.post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "w929-mcp-iserror", version: "1.0.0" },
    },
  });
}

function asListFixture(response) {
  return {
    id: "cold-tools-list",
    expect: "pass",
    kind: "mcp-tools-list-unpaid",
    method: "tools/list",
    request: {
      method: "tools/list",
      paymentSignatureSent: false,
    },
    observation: {
      httpStatus: response.status,
      headers: response.headers,
      headerNames: response.headerNames,
      hasPaymentRequiredHeader: response.hasPaymentRequiredHeader,
      jsonrpc: response.json,
    },
    claims: {
      charged: false,
      paidDelivery: false,
      successProven: false,
      settlement: false,
    },
    counters: { handler: 0, verify: 0, settle: 0 },
  };
}

function asCallFixture(response, counters) {
  return {
    id: "cold-tools-call",
    expect: "pass",
    kind: "mcp-tools-call-unpaid",
    method: "tools/call",
    request: {
      method: "tools/call",
      params: { name: SDS.mcpTool, arguments: { url: "https://example.com" } },
      paymentSignatureSent: false,
    },
    observation: {
      httpStatus: response.status,
      headers: response.headers,
      headerNames: response.headerNames,
      hasPaymentRequiredHeader: response.hasPaymentRequiredHeader,
      jsonrpc: response.json,
    },
    claims: {
      charged: false,
      paidDelivery: false,
      successProven: false,
      settlement: false,
    },
    counters,
  };
}

export async function runColdSuite() {
  return withUnpaidMcpSurface(async (session) => {
    const initialized = await initialize(session);
    const listed = await session.post({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const beforeCall = session.snapshot();
    const called = await session.post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: SDS.mcpTool, arguments: { url: "https://example.com" } },
    });
    const afterCall = session.snapshot();
    const counters = {
      handler: afterCall.handler - beforeCall.handler,
      verify: afterCall.verify - beforeCall.verify,
      settle: afterCall.settle - beforeCall.settle,
    };
    const report = evaluateColdSuite({
      toolsList: asListFixture(listed),
      toolsCall: asCallFixture(called, counters),
      counters: session.snapshot(),
      origin: session.origin,
      serverInfo: initialized.json?.result?.serverInfo ?? SERVER_INFO,
    });
    report.wire = {
      initializeHttpStatus: initialized.status,
      toolsListHttpStatus: listed.status,
      toolsCallHttpStatus: called.status,
      toolsCallIsError: called.json?.result?.isError === true,
      toolsCallHasJsonRpcError: Boolean(called.json?.error),
      paymentRequiredHeader: called.hasPaymentRequiredHeader,
      contentType: called.contentType ?? called.headers?.["content-type"] ?? null,
      headerNames: called.headerNames,
    };
    return report;
  });
}

export function runSeededFailure(fixturePath = SEEDED_HTTP_200_AS_CHARGED) {
  const fixture = loadJson(fixturePath);
  const evaluated = evaluateFixture(fixture);
  return {
    ...evaluated,
    mode: "seeded-failure",
    fixture: fixturePath,
    id: fixture.id ?? evaluated.id,
    claims: fixture.claims ?? null,
  };
}

export function runFixtureCorpus() {
  return evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
}
