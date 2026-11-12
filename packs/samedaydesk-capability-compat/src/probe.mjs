import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as LegacyTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client as CurrentClient, SdkError } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport as CurrentTransport } from "@modelcontextprotocol/client";
import {
  FREE_PAGE_CHANGE,
  OFFICIAL_CLIENT_NEGOTIATION,
  UNKNOWN_TOOL_RECOVERY,
  mapClientSdk,
} from "./map.mjs";
import { noPaymentSignature, watchFetch } from "./watch.mjs";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/public-two-observations.json");

export function loadHeldObservations() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function endpointOrigin(endpoint) {
  const url = new URL(endpoint);
  return url.origin;
}

async function connectLegacy(endpoint) {
  const client = new LegacyClient({ name: "capability-compat-legacy", version: OFFICIAL_CLIENT_NEGOTIATION.lockedSdk });
  const transport = new LegacyTransport(new URL(endpoint));
  await client.connect(transport);
  return {
    kind: "legacy",
    client,
    protocol: () => transport.protocolVersion,
    close: async () => { await client.close(); },
  };
}

async function connectCurrent(endpoint, mode) {
  const options = mode === undefined || mode === "default"
    ? undefined
    : { versionNegotiation: { mode } };
  const name = mode && typeof mode === "object" && mode.pin
    ? OFFICIAL_CLIENT_NEGOTIATION.pinClientName
    : "capability-compat-current";
  const client = new CurrentClient({ name, version: OFFICIAL_CLIENT_NEGOTIATION.pinClientVersion }, options);
  const transport = new CurrentTransport(new URL(endpoint));
  await client.connect(transport);
  return {
    kind: "current",
    client,
    protocol: () => transport.protocolVersion,
    close: async () => { await client.close(); },
  };
}

export async function connectClient({ endpoint, clientSdk, mode } = {}) {
  if (!endpoint) throw new Error("endpoint is required");
  const mapped = mapClientSdk(clientSdk || OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient);
  if (mapped.kind === "legacy") return connectLegacy(endpoint);
  return connectCurrent(endpoint, mode);
}

export function isPinRefusalError(error) {
  return error instanceof SdkError && error.code === OFFICIAL_CLIENT_NEGOTIATION.pinClientErrorCode;
}

export function describeFreeDiscoverRefusal(events, protocol = OFFICIAL_CLIENT_NEGOTIATION.refusedProtocol) {
  const discover = events.filter((event) => event.method === "server/discover");
  const freeDiscover = discover.filter((event) => event.status === OFFICIAL_CLIENT_NEGOTIATION.discoverHttpStatus);
  const sample = freeDiscover[0] || null;
  return {
    discoverCount: discover.length,
    allRequestedProtocol: discover.length > 0 && discover.every((event) => event.requestedProtocol === protocol),
    refused: Boolean(
      sample
      && sample.errorCode === OFFICIAL_CLIENT_NEGOTIATION.discoverJsonRpcCode
      && OFFICIAL_CLIENT_NEGOTIATION.discoverMessageUnsupported.test(sample.errorMessage || "")
      && OFFICIAL_CLIENT_NEGOTIATION.discoverMessageSupported.test(sample.errorMessage || ""),
    ),
    status: sample?.status ?? null,
    errorCode: sample?.errorCode ?? null,
    errorMessage: sample?.errorMessage ?? null,
  };
}

export async function detectPinRefusal({
  endpoint,
  clientSdk = OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient,
  protocol = OFFICIAL_CLIENT_NEGOTIATION.refusedProtocol,
} = {}) {
  if (!endpoint) throw new Error("endpoint is required");
  const mapped = mapClientSdk(clientSdk);
  if (mapped.kind !== "current") {
    throw new Error("explicit protocol pin refusal is defined for @modelcontextprotocol/client 2.4.0");
  }
  const wire = watchFetch(endpointOrigin(endpoint));
  let session = null;
  let error = null;
  try {
    session = await connectCurrent(endpoint, { pin: protocol });
  } catch (caught) {
    error = caught;
  } finally {
    if (session) {
      try { await session.close(); } catch { /* already closed or refused mid-session */ }
    }
  }
  const discover = describeFreeDiscoverRefusal(wire.events, protocol);
  const result = {
    connected: Boolean(session) && !error,
    pinRefused: isPinRefusalError(error),
    sdkError: error instanceof SdkError,
    code: error?.code ?? null,
    discover,
    paymentSignature: noPaymentSignature(wire.events) ? null : "present",
  };
  wire.restore();
  return result;
}

export async function recoverToSupportedProtocol({
  endpoint,
  clientSdk = OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient,
} = {}) {
  if (!endpoint) throw new Error("endpoint is required");
  const mapped = mapClientSdk(clientSdk);
  const mode = mapped.kind === "current" ? "default" : undefined;
  const session = await connectClient({ endpoint, clientSdk: mapped.id, mode });
  const protocol = session.protocol?.() ?? null;
  return { session, protocol, recovered: protocol === OFFICIAL_CLIENT_NEGOTIATION.legacyProtocol || protocol == null };
}

export function isUnknownToolError(error) {
  if (!error || error.code !== UNKNOWN_TOOL_RECOVERY.jsonRpcCode) return false;
  const data = error.data;
  if (!data || data.nextMethod !== UNKNOWN_TOOL_RECOVERY.nextMethod) return false;
  const tools = data.availableTools;
  return Array.isArray(tools) && tools[0] === FREE_PAGE_CHANGE.tool;
}

export async function recoverUnknownTool({
  session,
  arguments: args,
  unknownName = UNKNOWN_TOOL_RECOVERY.exampleUnknownName,
} = {}) {
  if (!session?.client) throw new Error("session.client is required");
  const request = args || loadHeldObservations();
  let unknown = null;
  try {
    await session.client.callTool({ name: unknownName, arguments: request });
  } catch (error) {
    unknown = error;
  }
  if (!isUnknownToolError(unknown)) {
    throw unknown || new Error("expected unknown-tool refusal with tools/list recovery data");
  }
  const listed = await session.client.listTools();
  const names = (listed.tools || []).map((tool) => tool.name);
  const toolName = names.includes(FREE_PAGE_CHANGE.tool) ? FREE_PAGE_CHANGE.tool : names[0];
  const result = await session.client.callTool({ name: toolName, arguments: request });
  return { unknown, listed: names, result, body: toolBody(result) };
}

export function toolBody(result) {
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error("CallToolResult is missing text content");
  const parsed = JSON.parse(text);
  if (result.structuredContent) {
    const left = JSON.stringify(result.structuredContent);
    const right = JSON.stringify(parsed);
    if (left !== right) throw new Error("structuredContent does not match text content");
  }
  return parsed;
}

export async function compareHeldPages({
  endpoint,
  clientSdk = OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient,
  arguments: args,
  mode = "default",
} = {}) {
  const wire = watchFetch(endpointOrigin(endpoint));
  const session = await connectClient({ endpoint, clientSdk, mode });
  try {
    const listed = await session.client.listTools();
    const names = (listed.tools || []).map((tool) => tool.name);
    const request = args || loadHeldObservations();
    const result = await session.client.callTool({ name: FREE_PAGE_CHANGE.tool, arguments: request });
    const body = toolBody(result);
    return {
      protocol: session.protocol?.() ?? null,
      tools: names,
      result,
      body,
      charged: body.charged,
      verdict: body.report?.verdict ?? null,
      paymentSignature: noPaymentSignature(wire.events) ? null : "present",
    };
  } finally {
    await session.close();
    wire.restore();
  }
}
