// Bounded owner-QA receiver for one merchant release.
// It checks the source-defined free page-change health route, /healthz,
// paid operations on /mpp-openapi.json, and the configured free SDK route.
// It does not search the general OpenAPI document, and it has no default origin.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  PAGE_CHANGE_HTTP_HEALTH_PATH,
  PAGE_CHANGE_HTTP_PRODUCT,
  PAGE_CHANGE_HTTP_SCHEMA,
} from "../page-change-http.mjs";
import { pageChangeRequestExample } from "../page-change-input-contract.mjs";
import {
  PAGE_CHANGE_MCP_ANNOTATIONS,
  PAGE_CHANGE_MCP_PATH,
  PAGE_CHANGE_MCP_TOOL,
} from "../page-change-mcp.mjs";

const SOURCE_PATTERN = /^[a-f0-9]{40}$/;
const REQUEST_TIMEOUT_MS = 8_000;
const REFUSAL_TOOLS = Object.freeze(["extract", "trial_read"]);

export function exactOrigin(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== value || url.username || url.password || url.search || url.hash) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.origin;
}

export function normalizeExpectedSource(value) {
  const source = String(value || "").trim().toLowerCase();
  return SOURCE_PATTERN.test(source) ? source : null;
}

function configurationResult(reason) {
  return {
    ownerQa: true,
    ok: false,
    network: false,
    reason,
    checks: {},
  };
}

function paidOperations(document) {
  const operations = [];
  const paths = document?.paths && typeof document.paths === "object" ? document.paths : null;
  if (!paths) return null;
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      if (item[method]?.["x-payment-info"]) operations.push({ method: method.toUpperCase(), path });
    }
  }
  return operations;
}

async function readJson(fetchImpl, url) {
  const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  return { status: response.status, json: body && typeof body === "object" ? body : null };
}

function endpoint(origin, route) {
  return new URL(route, origin).href;
}

async function defaultConnect(routeUrl) {
  const transport = new StreamableHTTPClientTransport(new URL(routeUrl));
  const client = new Client({ name: "merchant-release-receiving", version: "0" });
  await client.connect(transport);
  return {
    client,
    async close() { await client.close(); },
  };
}

function refusalRecord(name, error) {
  const message = String(error?.message || error || "").slice(0, 160);
  const code = Number.isInteger(error?.code) ? error.code : null;
  const text = typeof error?.text === "string" ? error.text.slice(0, 240) : "";
  const evidence = `${message}\n${text}`;
  const accepted = (code === -32602 || /unknown tool/i.test(evidence))
    && !/payment-required|x402Version/i.test(evidence);
  return { name, accepted, code, message: message || null };
}

async function callRefusal(client, name) {
  try {
    const result = await client.callTool({ name, arguments: {} });
    const text = result?.content?.find((item) => item.type === "text")?.text || "";
    return refusalRecord(name, { message: result?.isError === true ? "tool error" : "tool result", text });
  } catch (error) {
    return refusalRecord(name, error);
  }
}

async function receiveFreeRoute({ origin, freeRoute, fetchImpl, connect, healthDisabled }) {
  const routeUrl = endpoint(origin, freeRoute);
  const check = {
    route: freeRoute,
    getStatus: null,
    allow: null,
    tool: null,
    annotations: null,
    authorizationSent: false,
    refused: [],
    disabledCall: null,
  };
  let method;
  try {
    method = await fetchImpl(routeUrl, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    await method.arrayBuffer();
  } catch (error) {
    return { ...check, reason: "free_route_transport", message: String(error?.message || error).slice(0, 160) };
  }
  check.getStatus = method.status;
  check.allow = method.headers.get("allow");
  if (method.status !== 405) return { ...check, reason: "free_route_method" };
  let session;
  try {
    session = await connect(routeUrl);
    const listed = await session.client.listTools();
    const tools = listed?.tools || [];
    check.toolCount = tools.length;
    if (tools.length !== 1 || tools[0].name !== PAGE_CHANGE_MCP_TOOL) {
      return { ...check, reason: "free_route_tools" };
    }
    check.tool = tools[0].name;
    check.annotations = tools[0].annotations || null;
    if (!isDeepStrictEqual(check.annotations, PAGE_CHANGE_MCP_ANNOTATIONS)) {
      return { ...check, reason: "free_route_annotations" };
    }
    for (const name of REFUSAL_TOOLS) check.refused.push(await callRefusal(session.client, name));
    if (check.refused.some((item) => item.accepted !== true)) return { ...check, reason: "free_route_refusal" };
    if (healthDisabled) {
      const result = await session.client.callTool({ name: PAGE_CHANGE_MCP_TOOL, arguments: pageChangeRequestExample() });
      const text = result?.content?.find((item) => item.type === "text")?.text || "";
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      check.disabledCall = parsed?.error || null;
      if (result?.isError !== true || parsed?.error !== "page_change_http_disabled" || parsed?.charged !== false) {
        return { ...check, reason: "free_route_disabled_call" };
      }
    }
    return check;
  } catch (error) {
    return { ...check, reason: "free_route_transport", message: String(error?.message || error).slice(0, 160) };
  } finally {
    await session?.close?.();
  }
}

export async function receiveMerchantRelease({
  origin,
  expectedSource,
  freeRoute = PAGE_CHANGE_MCP_PATH,
  fetchImpl = fetch,
  connect = defaultConnect,
} = {}) {
  const resolvedOrigin = exactOrigin(origin);
  const source = normalizeExpectedSource(expectedSource);
  if (!origin) return configurationResult("missing_origin");
  if (!resolvedOrigin) return configurationResult("origin_not_exact");
  if (!source) return configurationResult("invalid_expected_source");
  if (typeof freeRoute !== "string" || !freeRoute.startsWith("/") || freeRoute.startsWith("//")
      || /[\\\s?#]/.test(freeRoute)
      || new URL(freeRoute, resolvedOrigin).origin !== resolvedOrigin
      || new URL(freeRoute, resolvedOrigin).pathname !== freeRoute) {
    return configurationResult("invalid_free_route");
  }

  const reasons = [];
  const checks = {};
  let healthDisabled = false;
  try {
    const health = await readJson(fetchImpl, endpoint(resolvedOrigin, PAGE_CHANGE_HTTP_HEALTH_PATH));
    const body = health.json || {};
    checks.pageChangeHealth = {
      httpStatus: health.status,
      enabled: body.enabled === true,
      product: body.product || null,
      schemaVersion: body.schemaVersion || null,
      commit: typeof body.commit === "string" ? body.commit : null,
      error: typeof body.error === "string" ? body.error : null,
      reason: typeof body.reason === "string" ? body.reason : null,
    };
    if (body.product !== PAGE_CHANGE_HTTP_PRODUCT || body.schemaVersion !== PAGE_CHANGE_HTTP_SCHEMA) {
      reasons.push("page_change_health_identity");
    }
    if (body.enabled !== true) {
      healthDisabled = true;
      if (health.status !== 404 || body.error !== "page_change_http_disabled" || body.commit !== undefined) {
        reasons.push("page_change_health_disabled");
      } else reasons.push("page_change_http_disabled");
    } else if (health.status !== 200 || body.commit !== source) {
      reasons.push(body.commit ? "source_mismatch" : "missing_source_commit");
    }

    const healthzResponse = await readJson(fetchImpl, endpoint(resolvedOrigin, "/healthz"));
    const protocols = healthzResponse.json?.paymentProtocols || {};
    checks.healthz = {
      httpStatus: healthzResponse.status,
      ok: healthzResponse.json?.ok === true,
      x402Enabled: protocols.x402?.enabled === true,
      mppEnabled: typeof protocols.mpp?.enabled === "boolean" ? protocols.mpp.enabled : null,
      mppReason: typeof protocols.mpp?.reason === "string" ? protocols.mpp.reason : null,
    };
    if (healthzResponse.status !== 200 || checks.healthz.ok !== true || checks.healthz.x402Enabled !== true) {
      reasons.push("healthz");
    }
    if (checks.healthz.mppEnabled === null) reasons.push("mpp_state_unknown");

    const mpp = await readJson(fetchImpl, endpoint(resolvedOrigin, "/mpp-openapi.json"));
    const operations = paidOperations(mpp.json);
    checks.mppOpenApi = {
      httpStatus: mpp.status,
      parsed: operations !== null,
      paidOperations: operations || [],
    };
    if (mpp.status !== 200 || operations === null) reasons.push("mpp_openapi");
    else if (checks.healthz.mppEnabled && operations.length === 0) reasons.push("mpp_paid_operations_absent");
    else if (checks.healthz.mppEnabled === false && operations.length > 0) reasons.push("mpp_paid_operations_present");
  } catch (error) {
    reasons.push("origin_unreachable");
    checks.transport = { message: String(error?.message || error).slice(0, 160) };
    return { ownerQa: true, ok: false, network: true, origin: resolvedOrigin, expectedSource: source, freeRoute, reason: reasons[0], reasons, checks };
  }

  const free = await receiveFreeRoute({
    origin: resolvedOrigin,
    freeRoute,
    fetchImpl,
    connect,
    healthDisabled,
  });
  checks.freeSdk = free;
  if (free.reason) reasons.push(free.reason);

  return {
    ownerQa: true,
    ok: reasons.length === 0,
    network: true,
    origin: resolvedOrigin,
    expectedSource: source,
    freeRoute,
    reason: reasons[0] || null,
    reasons,
    checks,
  };
}

function parseArgs(argv) {
  const args = { freeRoute: PAGE_CHANGE_MCP_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--origin") args.origin = value;
    else if (flag === "--expected-source") args.expectedSource = value;
    else if (flag === "--free-route") args.freeRoute = value;
    else return null;
    if (value === undefined) return null;
    index += 1;
  }
  return args;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const args = parseArgs(process.argv.slice(2));
  const result = args
    ? await receiveMerchantRelease(args)
    : configurationResult("invalid_arguments");
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.network === false ? 2 : result.ok ? 0 : 1;
}
