import { CLIENT_INFO, PROTOCOL_VERSION } from "./pins.mjs";
import { decodeMcpHttpBody, MCP_ACCEPT } from "./mcp-http.mjs";
import { assertLoopbackMcpUrl, refuseLiveOrNeoUrl, refusePaymentHeaders, refusePaymentMeta } from "./refuse.mjs";
import { fail } from "./errors.mjs";

async function postJson(mcpUrl, body, { sessionId = null, headers = {} } = {}) {
  refusePaymentHeaders(headers);
  refusePaymentMeta(body?.params?._meta);
  const outgoing = {
    accept: MCP_ACCEPT,
    "content-type": "application/json",
    ...headers,
  };
  refusePaymentHeaders(outgoing);
  if (sessionId) outgoing["mcp-session-id"] = sessionId;
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: outgoing,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const rpc = buffer.length ? decodeMcpHttpBody(buffer, response.headers.get("content-type")) : null;
  return {
    status: response.status,
    sessionId: response.headers.get("mcp-session-id") || sessionId,
    rpc,
  };
}

export async function crewaiUnpaidToolsCall({
  mcpUrl,
  toolName,
  arguments: toolArguments,
  headers = {},
} = {}) {
  refuseLiveOrNeoUrl(mcpUrl);
  assertLoopbackMcpUrl(mcpUrl);
  refusePaymentHeaders(headers);

  const initialized = await postJson(mcpUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    },
  }, { headers });
  if (initialized.status >= 400 || initialized.rpc?.error) {
    fail("CrewAI-shaped initialize failed against loopback fixture", {
      code: "INITIALIZE_FAILED",
      kind: "protocol_error",
      details: { status: initialized.status, rpc: initialized.rpc },
    });
  }
  const sessionId = initialized.sessionId;
  await postJson(mcpUrl, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  }, { sessionId, headers });

  const listed = await postJson(mcpUrl, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  }, { sessionId, headers });

  const called = await postJson(mcpUrl, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: toolArguments,
    },
  }, { sessionId, headers });

  return {
    initialize: initialized,
    toolsList: listed,
    toolsCall: called,
    clientInfo: CLIENT_INFO,
    transport: "streamable-http",
    paymentHeadersSent: false,
  };
}
