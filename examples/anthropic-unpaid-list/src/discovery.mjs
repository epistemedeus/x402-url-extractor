import { admitPublicHttpsUrl } from "./admit.mjs";
import {
  compactExtractActions,
  compactMcpTools,
  compactOffer,
  compactOpenApiExtract,
  compactWellKnownExtractItems,
  parseMcpPayload,
} from "./compact.mjs";
import {
  DEFAULT_BATCH_FIELDS,
  DEFAULT_BATCH_URLS,
  DEFAULT_PROBE_URL,
  DISCOVERY_MAX_BYTES,
  LIVE_ACTIONS_PATH,
  LIVE_EXTRACT_BATCH_PATH,
  LIVE_EXTRACT_PATH,
  LIVE_MCP_PATH,
  LIVE_OPENAPI_PATH,
  LIVE_WELL_KNOWN_PATH,
  MCP_MAX_BYTES,
  MCP_PROTOCOL,
  PROBE_MAX_BYTES,
  USER_AGENT,
} from "./constants.mjs";
import { boundedFetch, readJsonResponse } from "./transport.mjs";

function jsonHeaders() {
  return {
    accept: "application/json",
    "user-agent": USER_AGENT,
  };
}

function mcpHeaders(sessionId = null) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "user-agent": USER_AGENT,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return headers;
}

async function getJson(fetchImpl, url, maxBytes = DISCOVERY_MAX_BYTES) {
  const response = await boundedFetch(fetchImpl, url, {
    method: "GET",
    headers: jsonHeaders(),
  }, maxBytes);
  const read = await readJsonResponse(response);
  return { url, ...read };
}

export async function discoverHttp(origin, fetchImpl) {
  const [openapi, wellKnown, actions] = await Promise.all([
    getJson(fetchImpl, `${origin}${LIVE_OPENAPI_PATH}`),
    getJson(fetchImpl, `${origin}${LIVE_WELL_KNOWN_PATH}`),
    getJson(fetchImpl, `${origin}${LIVE_ACTIONS_PATH}`),
  ]);
  return Object.freeze({
    openapi: Object.freeze({
      kind: "http_discovery",
      path: LIVE_OPENAPI_PATH,
      url: openapi.url,
      status: openapi.status,
      bodyBytes: openapi.bodyBytes,
      extract: compactOpenApiExtract(openapi.body),
    }),
    wellKnown: Object.freeze({
      kind: "http_discovery",
      path: LIVE_WELL_KNOWN_PATH,
      url: wellKnown.url,
      status: wellKnown.status,
      bodyBytes: wellKnown.bodyBytes,
      x402Version: wellKnown.body?.x402Version ?? null,
      extractItems: compactWellKnownExtractItems(wellKnown.body),
    }),
    actions: Object.freeze({
      kind: "http_discovery",
      path: LIVE_ACTIONS_PATH,
      url: actions.url,
      status: actions.status,
      bodyBytes: actions.bodyBytes,
      extractActions: compactExtractActions(actions.body),
    }),
  });
}

export async function discoverMcp(origin, fetchImpl) {
  const mcpUrl = `${origin}${LIVE_MCP_PATH}`;
  const initializeResponse = await boundedFetch(fetchImpl, mcpUrl, {
    method: "POST",
    headers: mcpHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL,
        capabilities: {},
        clientInfo: { name: "samedaydesk-anthropic-unpaid-list", version: "0.1.0" },
      },
    }),
  }, MCP_MAX_BYTES);
  const initializeRead = await readJsonResponse(initializeResponse);
  let initializePayload = null;
  try {
    initializePayload = parseMcpPayload(initializeRead.text);
  } catch {
    initializePayload = initializeRead.body;
  }
  const sessionId = initializeResponse.headers.get("mcp-session-id");
  const listResponse = await boundedFetch(fetchImpl, mcpUrl, {
    method: "POST",
    headers: mcpHeaders(sessionId),
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  }, MCP_MAX_BYTES);
  const listRead = await readJsonResponse(listResponse);
  let listPayload = null;
  try {
    listPayload = parseMcpPayload(listRead.text);
  } catch {
    listPayload = listRead.body;
  }
  const tools = compactMcpTools(listPayload?.result?.tools);
  return Object.freeze({
    url: mcpUrl,
    protocol: MCP_PROTOCOL,
    initialize: Object.freeze({
      kind: "mcp_unpaid",
      method: "initialize",
      status: initializeRead.status,
      protocolVersion: initializePayload?.result?.protocolVersion ?? null,
      serverName: initializePayload?.result?.serverInfo?.name ?? null,
      serverVersion: initializePayload?.result?.serverInfo?.version ?? null,
    }),
    toolsList: Object.freeze({
      kind: "mcp_unpaid",
      method: "tools/list",
      status: listRead.status,
      ...tools,
      toolsCalled: false,
    }),
  });
}

export async function probeExtractChallenges(origin, fetchImpl, {
  probeUrl = DEFAULT_PROBE_URL,
  batchUrls = DEFAULT_BATCH_URLS,
  batchFields = DEFAULT_BATCH_FIELDS,
} = {}) {
  const page = admitPublicHttpsUrl(probeUrl, { field: "probeUrl" });
  const extractUrl = `${origin}${LIVE_EXTRACT_PATH}?url=${encodeURIComponent(page.href)}`;
  const batchUrl = `${origin}${LIVE_EXTRACT_BATCH_PATH}`;
  const admittedUrls = batchUrls.map((value, index) => (
    admitPublicHttpsUrl(value, { field: `urls[${index}]` }).href
  ));

  const getResponse = await boundedFetch(fetchImpl, extractUrl, {
    method: "GET",
    headers: jsonHeaders(),
  }, PROBE_MAX_BYTES);
  const getRead = await readJsonResponse(getResponse);

  const postResponse = await boundedFetch(fetchImpl, batchUrl, {
    method: "POST",
    headers: { ...jsonHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ urls: admittedUrls, fields: [...batchFields] }),
  }, PROBE_MAX_BYTES);
  const postRead = await readJsonResponse(postResponse);

  return Object.freeze({
    getExtract: Object.freeze({
      kind: "unpaid_challenge",
      method: "GET",
      path: LIVE_EXTRACT_PATH,
      url: extractUrl,
      status: getRead.status,
      expectedStatus: 402,
      offer: compactOffer(getRead.body),
      unexpectedDelivery: getRead.status === 200,
    }),
    postExtractBatch: Object.freeze({
      kind: "unpaid_challenge",
      method: "POST",
      path: LIVE_EXTRACT_BATCH_PATH,
      url: batchUrl,
      status: postRead.status,
      expectedStatus: 402,
      offer: compactOffer(postRead.body),
      unexpectedDelivery: postRead.status === 200,
    }),
  });
}
