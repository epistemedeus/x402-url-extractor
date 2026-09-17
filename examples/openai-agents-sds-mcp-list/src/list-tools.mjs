import {
  CLIENT_NAME,
  CONNECT_TIMEOUT_SECONDS,
  LIVE_MCP_URL,
  REQUEST_TIMEOUT_MS,
  SDK_PACKAGE,
  SDK_VERSION,
  SOURCE_HEADER,
  SOURCE_HEADER_VALUE,
  TRANSPORT_CLASS,
  USER_AGENT,
} from "./constants.mjs";
import { assertUnpaidListInventory } from "./inventory.mjs";
import { assertMcpListUrl } from "./policy.mjs";
import { createUnpaidDiscoveryFetch, summarizeTranscript } from "./transport.mjs";

export async function createStreamableHttpServer(options) {
  const { MCPServerStreamableHttp } = await import("@openai/agents");
  return new MCPServerStreamableHttp(options);
}

function requestHeaders({ declareSource }) {
  const headers = { "user-agent": USER_AGENT };
  if (declareSource) headers[SOURCE_HEADER] = SOURCE_HEADER_VALUE;
  return headers;
}

export async function listUnpaidSdsTools({
  url = LIVE_MCP_URL,
  declareSource = false,
  fetchImpl = globalThis.fetch,
  createServer = createStreamableHttpServer,
} = {}) {
  const mcpUrl = assertMcpListUrl(url);
  const { fetchImpl: guardedFetch, transcript } = createUnpaidDiscoveryFetch({
    innerFetch: fetchImpl,
  });
  const server = await createServer({
    url: mcpUrl,
    name: CLIENT_NAME,
    clientSessionTimeoutSeconds: CONNECT_TIMEOUT_SECONDS,
    timeout: REQUEST_TIMEOUT_MS,
    requestInit: { headers: requestHeaders({ declareSource }) },
    fetch: guardedFetch,
  });

  try {
    await server.connect();
    const tools = await server.listTools();
    const inventory = assertUnpaidListInventory(tools);
    const wire = summarizeTranscript(transcript);
    return {
      ok: true,
      lane: "openai-agents-sds-mcp-list",
      transportClass: TRANSPORT_CLASS,
      sdk: { package: SDK_PACKAGE, version: SDK_VERSION },
      url: mcpUrl,
      sessionId: server.sessionId ?? null,
      negotiatedProtocolVersion: wire.negotiatedProtocolVersion,
      serverInfo: wire.serverInfo,
      modernDiscoverProbe: wire.modernDiscoverProbe,
      toolCount: inventory.names.length,
      names: inventory.names,
      extractPresent: inventory.extractPresent,
      extractBatchPresent: inventory.extractBatchPresent,
      extractInputRequiresUrl: inventory.extractInputRequiresUrl,
      extractBatchInputRequiresUrls: inventory.extractBatchInputRequiresUrls,
      exactGlobalCountRequired: inventory.exactGlobalCountRequired,
      paymentAttempted: wire.paymentAttempted,
      toolsCalled: wire.toolsCalled,
      agentRun: false,
      sourceHeaderSent: Boolean(declareSource),
      rpcMethodsSent: wire.rpcMethodsSent,
    };
  } finally {
    await server.close().catch(() => {});
  }
}
