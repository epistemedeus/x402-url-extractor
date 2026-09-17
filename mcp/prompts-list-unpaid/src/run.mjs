import { classifyPaymentRequired, invokePromptGet } from "./classify.mjs";
import { evaluateNegativeSuite, evaluatePromptsList, evaluateRawListHttp } from "./evaluate.mjs";
import { loadFixture } from "./paths.mjs";
import { withMountedUnpaidPromptsSurface } from "./surface.mjs";

async function toolsCallUnpaid(session) {
  let gated = false;
  let handlerRan = session.handlerCalls.extract > 0;
  try {
    const result = await session.client.callTool({
      name: "extract",
      arguments: { url: "https://example.com/" },
    });
    handlerRan = session.handlerCalls.extract > 0;
    const text = result?.content?.[0]?.text;
    let payload = null;
    try {
      payload = JSON.parse(text ?? "null");
    } catch {
      payload = result;
    }
    if (result?.isError === true && classifyPaymentRequired(200, payload, {}).paymentRequired) {
      gated = true;
    } else if (classifyPaymentRequired(200, payload, {}).paymentRequired) {
      gated = true;
    }
    return {
      gated,
      handlerRan,
      layer: gated ? "payment-required-result" : "unexpected-result",
      message: typeof text === "string" ? text.slice(0, 240) : "tools/call returned a non-text result",
    };
  } catch (error) {
    handlerRan = session.handlerCalls.extract > 0;
    const code = error?.code ?? null;
    const data = error?.data || error?.error?.data;
    const payment = classifyPaymentRequired(code === 402 ? 402 : 200, { error: { code, data }, ...error }, {});
    gated = payment.paymentRequired || code === -32042 || code === 402;
    return {
      gated,
      handlerRan,
      layer: gated ? "payment-required-error" : "unexpected-error",
      code,
      message: String(error?.message || error).slice(0, 240),
    };
  }
}

async function runPromptsList(session) {
  const fixture = loadFixture("prompts-list.json");
  const listed = await session.client.listPrompts();
  const sdk = evaluatePromptsList(listed, fixture);
  const raw = await session.postRaw({ jsonrpc: "2.0", id: 20, method: "prompts/list", params: {} });
  const rawEval = evaluateRawListHttp(raw.status, raw.json, raw.headers, fixture);
  const initialized = await session.postRaw({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "prompts-list-unpaid", version: "0.1.0" },
    },
  });
  const capabilities = initialized.json?.result?.capabilities ?? null;
  return {
    sdk,
    raw: rawEval,
    initialize: {
      httpStatus: initialized.status,
      protocolVersion: initialized.json?.result?.protocolVersion ?? null,
      serverName: initialized.json?.result?.serverInfo?.name ?? null,
      capabilities,
      promptsAdvertised: Boolean(capabilities?.prompts),
    },
    ok: sdk.ok === true && rawEval.ok === true && capabilities?.prompts != null,
  };
}

async function runNegative(session, { seededOnly = false } = {}) {
  const fixture = loadFixture("seeded-failure.json");
  const cases = seededOnly
    ? (fixture.cases ?? []).filter((item) => item.seededFailure === true)
    : fixture.cases ?? [];
  const observationsById = {};
  for (const fixtureCase of cases) {
    observationsById[fixtureCase.id] = await invokePromptGet(session.client, { name: fixtureCase.name });
  }
  return evaluateNegativeSuite({ ...fixture, cases }, observationsById);
}

export async function runConformance({
  includeList = true,
  includeNegative = true,
  includeToolsGate = true,
  seededOnly = false,
} = {}) {
  return withMountedUnpaidPromptsSurface(async (session) => {
    const report = {
      status: "pass",
      surface: "mountMcp",
      origin: session.origin,
      mcpUrl: session.mcpUrl,
      client: "@modelcontextprotocol/sdk@1.30.0 Client + StreamableHTTPClientTransport",
      paymentAttempted: false,
    };
    if (includeList && !seededOnly) {
      report.promptsList = await runPromptsList(session);
    }
    if (includeToolsGate && !seededOnly) {
      report.toolsCallUnpaid = await toolsCallUnpaid(session);
    }
    if (includeNegative) {
      report.negativePromptsGet = await runNegative(session, { seededOnly });
    }
    const listOk = report.promptsList ? report.promptsList.ok === true : true;
    const negativeOk = report.negativePromptsGet ? report.negativePromptsGet.ok === true : true;
    const gateOk = report.toolsCallUnpaid
      ? report.toolsCallUnpaid.gated === true && report.toolsCallUnpaid.handlerRan === false
      : true;
    report.status = listOk && negativeOk && gateOk ? "pass" : "fail";
    if (!gateOk) {
      report.toolsCallUnpaid.reason = "tools/call without payment must stay gated and must not run extract";
    }
    return report;
  });
}

export async function runSeededFailure() {
  const report = await runConformance({
    includeList: false,
    includeNegative: true,
    includeToolsGate: false,
    seededOnly: true,
  });
  const seeded = report.negativePromptsGet?.seededFailure;
  return {
    ...report,
    seededFailure: seeded
      ? {
          id: seeded.id,
          rejected: seeded.ok === true && seeded.observation?.rejected === true,
          layer: seeded.observation?.layer ?? null,
          code: seeded.observation?.code ?? null,
          message: seeded.observation?.message ?? seeded.reason,
          reason: seeded.reason,
        }
      : {
          id: "seeded-unknown-prompt",
          rejected: false,
          reason: "seeded-unknown-prompt fixture did not run",
        },
  };
}

export const VERBS = Object.freeze(["run", "cold-run", "seeded-failure", "help"]);
