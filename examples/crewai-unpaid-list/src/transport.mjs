import {
  CLIENT_NAME,
  CLIENT_VERSION,
  MAX_BYTES,
  MCP_PROTOCOL,
  TIMEOUT_MS,
  USER_AGENT,
} from "./constants.mjs";
import { fail } from "./errors.mjs";
import {
  assertAllowedMethod,
  assertNoPaymentHeaders,
  assertUnpaidProtocol,
} from "./boundary.mjs";

export function parseSseOrJson(text, label) {
  const dataLines = String(text || "").split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const raw = dataLines.length ? dataLines.at(-1).slice(6) : text;
  try {
    return JSON.parse(raw);
  } catch {
    fail("TRANSPORT", `${label} did not return JSON or JSON SSE data`);
  }
}

export function initializeParams() {
  return {
    protocolVersion: MCP_PROTOCOL,
    capabilities: {},
    clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
  };
}

export async function postRpc(url, method, params, id, extra = {}) {
  assertAllowedMethod(method);
  assertUnpaidProtocol(MCP_PROTOCOL);
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "user-agent": USER_AGENT,
    ...extra.headers,
  };
  if (extra.sessionId) headers["mcp-session-id"] = extra.sessionId;
  assertNoPaymentHeaders(headers);
  const fetchImpl = extra.fetchImpl || fetch;
  const response = await fetchImpl(url, {
    method: "POST",
    redirect: "error",
    signal: extra.signal || AbortSignal.timeout(extra.timeoutMs || TIMEOUT_MS),
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
    fail("TRANSPORT", `${method} response exceeded ${MAX_BYTES} bytes`);
  }
  let payload = null;
  try {
    payload = parseSseOrJson(text, method);
  } catch (error) {
    payload = { parseError: true, textPreview: text.slice(0, 500), message: error.message };
  }
  return { response, text, payload };
}
