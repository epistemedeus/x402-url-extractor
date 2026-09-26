import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applySeededFalseSuccess,
  classifyToolsCall,
  crewaiCallTool,
  crewaiCallToolResult,
  KIND,
} from "./classify.mjs";
import { crewaiUnpaidToolsCall } from "./client.mjs";
import { fail } from "./errors.mjs";
import { startFixtureServer } from "./fixture-server.mjs";
import {
  CREWAI_ADAPTER,
  CREWAI_CLIENT,
  CREWAI_DSL,
  CREWAI_PIN,
  CREWAI_SAFE_API,
  CREWAI_TRANSPORT,
  CREWAI_UNSAFE_API,
  TOOL_ARGUMENTS,
  TOOL_NAME,
} from "./pins.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SEEDED_FALSE_SUCCESS_PATH = join(ROOT, "fixtures/seeded/false-success-dropped-iserror.json");

export function loadSeededFalseSuccess(path = SEEDED_FALSE_SUCCESS_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function reportFromCall(session) {
  const classification = classifyToolsCall({
    httpStatus: session.toolsCall.status,
    rpc: session.toolsCall.rpc,
  });
  const result = session.toolsCall.rpc?.result;
  const kept = crewaiCallToolResult(result);
  const dropped = crewaiCallTool(result);
  return {
    ok: classification.kind === KIND.UNPAID_TOOLS_CALL_IS_ERROR,
    kind: classification.kind,
    adapter: {
      runtime: "crewai",
      pin: CREWAI_PIN,
      transport: CREWAI_TRANSPORT,
      dsl: CREWAI_DSL,
      adapter: CREWAI_ADAPTER,
      client: CREWAI_CLIENT,
      api: CREWAI_SAFE_API,
      not: [CREWAI_UNSAFE_API, "Agent.kickoff", "Crew.kickoff"],
    },
    call: {
      method: "tools/call",
      name: TOOL_NAME,
      arguments: TOOL_ARGUMENTS,
      paid: false,
      paymentHeadersSent: session.paymentHeadersSent,
    },
    mcp: {
      httpStatus: session.toolsCall.status,
      jsonrpc: session.toolsCall.rpc?.jsonrpc ?? null,
      isError: result?.isError === true,
      handlerRan: classification.handlerRan,
    },
    crewai: {
      call_tool_result: kept,
      call_tool_dropped_isError: Boolean(dropped) && kept.is_error,
    },
    classification,
    boundary: {
      paymentSent: false,
      live: false,
      kickoff: false,
      settlement: false,
      isErrorMeansPaid: false,
      http200MeansPaid: false,
      callToolDropsIsError: true,
    },
  };
}

export async function runUnpaidCall({ mcpUrl } = {}) {
  let fixture = null;
  try {
    if (!mcpUrl) {
      fixture = await startFixtureServer();
      mcpUrl = fixture.mcpUrl;
    }
    const session = await crewaiUnpaidToolsCall({
      mcpUrl,
      toolName: TOOL_NAME,
      arguments: TOOL_ARGUMENTS,
    });
    const report = reportFromCall(session);
    if (!report.ok) {
      fail("unpaid tools/call was not classified as isError Payment required", {
        code: "UNPAID_NOT_ISERROR",
        kind: report.kind,
        details: report,
      });
    }
    return { report, fixtureOrigin: fixture?.origin ?? null };
  } finally {
    await fixture?.close();
  }
}

export async function runSeededFailure({ mcpUrl } = {}) {
  const seed = loadSeededFalseSuccess();
  const { report } = await runUnpaidCall({ mcpUrl });
  if (seed.claimed?.kind !== KIND.PAID_SUCCESS) {
    fail("seeded fixture must claim paid_success", {
      code: "SEED_MISPREPARED",
      kind: KIND.MALFORMED,
      details: { seed },
    });
  }
  applySeededFalseSuccess(report.classification, report.crewai.call_tool_result.content);
}
