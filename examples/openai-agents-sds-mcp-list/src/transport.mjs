import { MODERN_PROTOCOL_PROBE } from "./constants.mjs";
import {
  assertAllowedHttpMethod,
  assertAllowedRpcMethod,
  assertNoCredentialHeaders,
} from "./policy.mjs";

export function decodeBody(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) return body.toString("utf8");
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  return "";
}

export function parseRpc(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseSseOrJson(text) {
  const source = String(text || "");
  const dataLines = source.split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const raw = dataLines.length ? dataLines.at(-1).slice(6) : source.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function headerMap(headers) {
  const out = {};
  if (!headers) return out;
  const iterable = typeof headers.entries === "function" ? headers.entries() : Object.entries(headers);
  for (const [name, value] of iterable) {
    out[String(name).toLowerCase()] = String(value);
  }
  return out;
}

async function requestParts(input, init = {}) {
  const request = input instanceof Request ? input : null;
  const url = String(request ? request.url : input);
  const method = String(init.method || request?.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || request?.headers || undefined);
  let bodyText = "";
  if (init.body != null) bodyText = decodeBody(init.body);
  else if (request && method !== "GET" && method !== "HEAD") {
    bodyText = await request.clone().text();
  }
  return { url, method, headers, bodyText };
}

export function createUnpaidDiscoveryFetch({ innerFetch = globalThis.fetch } = {}) {
  const transcript = [];

  async function fetchImpl(input, init = {}) {
    const parts = await requestParts(input, init);
    assertAllowedHttpMethod(parts.method);
    assertNoCredentialHeaders(parts.headers);
    const rpc = parseRpc(parts.bodyText);
    const rpcMethod = assertAllowedRpcMethod(rpc?.method ?? null);
    const headers = headerMap(parts.headers);

    const record = {
      httpMethod: parts.method,
      url: parts.url,
      rpcMethod,
      mcpMethodHeader: headers["mcp-method"] || null,
      protocolVersionHeader: headers["mcp-protocol-version"] || null,
    };

    const response = await innerFetch(input, init);
    const body = await response.clone().text();
    const payload = parseSseOrJson(body);
    record.status = response.status;
    record.protocolVersion = payload?.result?.protocolVersion
      || (rpcMethod === "server/discover" ? headers["mcp-protocol-version"] : null);
    if (payload?.result?.serverInfo) record.serverInfo = payload.result.serverInfo;
    if (rpcMethod === "server/discover") {
      record.modernDiscoverProbe = {
        attempted: true,
        protocolVersion: headers["mcp-protocol-version"] || MODERN_PROTOCOL_PROBE,
        httpStatus: response.status,
        accepted: response.ok,
      };
    }
    transcript.push(record);
    return response;
  }

  return { fetchImpl, transcript };
}

export function summarizeTranscript(transcript) {
  const records = Array.isArray(transcript) ? transcript : [];
  const initialize = records.find((row) => row.rpcMethod === "initialize" && row.serverInfo);
  const discover = records.find((row) => row.rpcMethod === "server/discover");
  const listed = records.some((row) => row.rpcMethod === "tools/list" && row.status >= 200 && row.status < 300);
  const called = records.some((row) => row.rpcMethod === "tools/call");
  const paymentHeaders = records.some((row) => row.mcpMethodHeader === "tools/call");

  return {
    rpcMethodsSent: records.map((row) => row.rpcMethod).filter(Boolean),
    httpMethodsSent: records.map((row) => row.httpMethod),
    negotiatedProtocolVersion: initialize?.protocolVersion || null,
    serverInfo: initialize?.serverInfo || null,
    modernDiscoverProbe: discover
      ? {
        attempted: true,
        protocolVersion: discover.protocolVersionHeader || discover.protocolVersion || MODERN_PROTOCOL_PROBE,
        httpStatus: discover.status,
        accepted: Boolean(discover.modernDiscoverProbe?.accepted),
      }
      : { attempted: false, accepted: false },
    toolsListed: listed,
    toolsCalled: called,
    paymentAttempted: called || paymentHeaders,
  };
}
