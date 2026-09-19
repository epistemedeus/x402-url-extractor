import { SDS } from "./constants.mjs";
import { evaluateColdSuite, evaluateFixture, evaluateFixtureCorpus } from "./evaluate.mjs";
import { withProductionMerchant } from "./merchant.mjs";
import { loadFixtures, loadJson, SEEDED_HTTP_200_ISERROR_AS_CHARGED } from "./paths.mjs";
import { SERVER_INFO, withUnpaidMcpSurface } from "./surface.mjs";

async function initialize(session) {
  return session.post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "w809-mcp-iserror", version: "1.0.0" },
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

async function runMountedUnpaid() {
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
    return {
      initialized,
      listed,
      called,
      counters: {
        handler: afterCall.handler - beforeCall.handler,
        verify: afterCall.verify - beforeCall.verify,
        settle: afterCall.settle - beforeCall.settle,
      },
      origin: session.origin,
    };
  });
}

async function runProductionUnpaid() {
  return withProductionMerchant(async (session) => {
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
    return {
      listed,
      called,
      counters: {
        handler: 0,
        verify: afterCall.verify - beforeCall.verify,
        settle: afterCall.settle - beforeCall.settle,
      },
      origin: session.origin,
    };
  });
}

export async function runColdSuite() {
  const mounted = await runMountedUnpaid();
  const production = await runProductionUnpaid();
  const report = evaluateColdSuite({
    toolsList: asListFixture(mounted.listed),
    toolsCall: asCallFixture(mounted.called, mounted.counters),
    counters: mounted.counters,
    origin: mounted.origin,
    serverInfo: mounted.initialized.json?.result?.serverInfo ?? SERVER_INFO,
    productionList: { ...asListFixture(production.listed), id: "cold-server-js-tools-list" },
    productionCall: { ...asCallFixture(production.called, production.counters), id: "cold-server-js-tools-call" },
    productionCounters: production.counters,
    productionOrigin: production.origin,
  });
  report.wire = {
    initializeHttpStatus: mounted.initialized.status,
    toolsListHttpStatus: mounted.listed.status,
    toolsCallHttpStatus: mounted.called.status,
    toolsCallIsError: mounted.called.json?.result?.isError === true,
    toolsCallHasJsonRpcError: Boolean(mounted.called.json && Object.hasOwn(mounted.called.json, "error")),
    paymentRequiredHeader: mounted.called.hasPaymentRequiredHeader,
    headerNames: mounted.called.headerNames,
    productionToolsCallHttpStatus: production.called.status,
    productionToolsCallIsError: production.called.json?.result?.isError === true,
    productionJsonrpcError: Boolean(production.called.json && Object.hasOwn(production.called.json, "error")),
    productionPaymentRequiredHeader: production.called.hasPaymentRequiredHeader,
    productionSettle: production.counters.settle,
    productionVerify: production.counters.verify,
  };
  return report;
}

export function runSeededFailure(fixturePath = SEEDED_HTTP_200_ISERROR_AS_CHARGED) {
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
