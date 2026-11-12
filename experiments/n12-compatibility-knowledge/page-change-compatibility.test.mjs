import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client as CurrentClient, SdkError } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport as CurrentTransport } from "@modelcontextprotocol/client";
import { pageChangeRequestExample } from "../../page-change-input-contract.mjs";
import {
  PAGE_CHANGE_MCP_PATH,
  PAGE_CHANGE_MCP_TOOL,
  mountPageChangeMcp,
} from "../../page-change-mcp.mjs";
import { mountPageChangeHttp } from "../../page-change-http.mjs";
import {
  CALLER_RESULT_RECOVERY,
  FREE_PAGE_CHANGE,
  MERCHANT_PIN,
  OFFICIAL_CLIENT_NEGOTIATION,
  TASKS_EXTENSION,
  UNKNOWN_TOOL_RECOVERY,
  mapUnknownToolRecovery,
  omitSelectedTitle,
  tasksClientCapabilityMeta,
  unknownToolErrorData,
} from "./page-change-compatibility-mapping.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const enabledEnv = { PAGE_CHANGE_HTTP_ENABLED: "1" };

function stable(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => (key === "elapsedMs" ? undefined : item)));
}

async function listenProfile(env) {
  const app = express();
  mountPageChangeHttp(app, { env });
  mountPageChangeMcp(app, { env });
  const server = createHttpServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function connectClient(base) {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}${PAGE_CHANGE_MCP_PATH}`));
  const client = new Client({ name: "n12-page-change-compat", version: "0" });
  await client.connect(transport);
  return {
    client,
    async close() {
      await client.close();
    },
  };
}

function toolJson(result) {
  const text = result?.content?.find((item) => item.type === "text")?.text;
  assert.equal(typeof text, "string");
  const parsed = JSON.parse(text);
  if (result.structuredContent) assert.deepEqual(stable(result.structuredContent), stable(parsed));
  return parsed;
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

function parseRpc(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  const messages = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    messages.push(JSON.parse(payload));
  }
  return messages.find((message) => message && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) || messages.at(-1) || null;
}

function declaredTasksExtension(requestBody) {
  const extensions = requestBody?.params?._meta?.[TASKS_EXTENSION.clientCapabilitiesMetaKey]?.extensions;
  return Boolean(extensions && Object.hasOwn(extensions, TASKS_EXTENSION.id));
}

function watchFetch(origin, { attachTasksCapability = false } = {}) {
  const events = [];
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let requestInit = init;
    if (attachTasksCapability && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if (body?.method === "tools/call") {
          body.params = body.params && typeof body.params === "object" ? body.params : {};
          body.params._meta = {
            ...(body.params._meta || {}),
            ...tasksClientCapabilityMeta(),
          };
          requestInit = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        requestInit = init;
      }
    }
    const response = await original(input, requestInit);
    if (!String(url).startsWith(origin)) return response;
    let requestBody = null;
    if (typeof requestInit.body === "string") {
      try { requestBody = JSON.parse(requestInit.body); } catch { requestBody = null; }
    }
    const text = await response.clone().text();
    let rpc = null;
    try { rpc = parseRpc(text); } catch { rpc = null; }
    events.push({
      method: requestBody?.method || requestInit.method || "GET",
      tool: requestBody?.params?.name || null,
      requestedProtocol: requestBody?.params?.protocolVersion
        || requestBody?.params?._meta?.["io.modelcontextprotocol/protocolVersion"]
        || headerValue(requestInit.headers, "mcp-protocol-version")
        || null,
      mcpMethod: headerValue(requestInit.headers, "mcp-method"),
      paymentSignature: headerValue(requestInit.headers, "payment-signature") ? "present" : null,
      status: response.status,
      errorCode: rpc?.error?.code ?? null,
      errorMessage: rpc?.error?.message ? String(rpc.error.message).slice(0, 240) : null,
      responseProtocol: rpc?.result?.protocolVersion ?? null,
      resultType: rpc?.result?.resultType ?? null,
      resultTaskId: rpc?.result?.[TASKS_EXTENSION.taskIdField] ?? null,
      hasContent: Array.isArray(rpc?.result?.content) && rpc.result.content.length > 0,
      hasStructuredContent: rpc?.result?.structuredContent != null && typeof rpc.result.structuredContent === "object",
      declaredTasksExtension: declaredTasksExtension(requestBody),
    });
    return response;
  };
  return {
    events,
    restore() { globalThis.fetch = original; },
  };
}

test("mapping records the pinned free-profile contracts", async () => {
  assert.equal(MERCHANT_PIN, "e90676f48da875c5e0f475f57f7774de947b75a7");
  assert.equal(FREE_PAGE_CHANGE.path, PAGE_CHANGE_MCP_PATH);
  assert.equal(FREE_PAGE_CHANGE.tool, PAGE_CHANGE_MCP_TOOL);
  assert.equal(FREE_PAGE_CHANGE.protocol, OFFICIAL_CLIENT_NEGOTIATION.supportedFreeProtocol);
  assert.equal(FREE_PAGE_CHANGE.refusedProtocol, OFFICIAL_CLIENT_NEGOTIATION.refusedFreeProtocol);
  assert.equal(TASKS_EXTENSION.implementedOnFreeProfile, false);
  assert.equal(TASKS_EXTENSION.mustNotReturnTaskWithoutDeclaration, true);
  assert.deepEqual(unknownToolErrorData(), {
    nextMethod: "tools/list",
    availableTools: [PAGE_CHANGE_MCP_TOOL],
  });
  assert.deepEqual(tasksClientCapabilityMeta(), {
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
  });
  assert.equal(OFFICIAL_CLIENT_NEGOTIATION.pinClientErrorCode, "ERA_NEGOTIATION_FAILED");
  assert.equal(OFFICIAL_CLIENT_NEGOTIATION.discoverHttpStatus, 400);
  assert.equal(OFFICIAL_CLIENT_NEGOTIATION.discoverJsonRpcCode, -32000);

  const pin = JSON.parse(await readFile(path.join(repoRoot, CALLER_RESULT_RECOVERY.pinPath), "utf8"));
  assert.equal(pin.package, CALLER_RESULT_RECOVERY.package);
  assert.equal(pin.version, CALLER_RESULT_RECOVERY.version);
  assert.equal(pin.dependencies[CALLER_RESULT_RECOVERY.sdk], CALLER_RESULT_RECOVERY.sdkVersion);
  assert.equal(pin.contract.tool, CALLER_RESULT_RECOVERY.tool);
  assert.equal(pin.recovery.module, CALLER_RESULT_RECOVERY.module);
  assert.equal(pin.recovery.bin, CALLER_RESULT_RECOVERY.bin);
  assert.equal(pin.recovery.packageExport, CALLER_RESULT_RECOVERY.packageExport);
  assert.equal(pin.recovery.charged, false);
  assert.equal(Object.hasOwn(pin, "hmac"), false);
  assert.equal(Object.hasOwn(CALLER_RESULT_RECOVERY, "hmac"), false);
});

test("positive: official-style client compares held observations without payment", async (t) => {
  const profile = await listenProfile(enabledEnv);
  t.after(() => profile.close());
  const session = await connectClient(profile.base);
  t.after(() => session.close());

  const { tools } = await session.client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [FREE_PAGE_CHANGE.tool]);
  const result = await session.client.callTool({
    name: FREE_PAGE_CHANGE.tool,
    arguments: pageChangeRequestExample(),
  });
  assert.notEqual(result.isError, true);
  assert.notEqual(result.resultType, TASKS_EXTENSION.resultTypeTask);
  const body = toolJson(result);
  assert.equal(body.ok, true);
  assert.equal(body.charged, false);
  assert.equal(body.report.verdict, "changed");
});

test("failure: unknown tool keeps the recovery mapping and does not take a paid fallback", async (t) => {
  const profile = await listenProfile(enabledEnv);
  t.after(() => profile.close());
  const session = await connectClient(profile.base);
  t.after(() => session.close());

  const attemptedName = "other-client-private-tool-name";
  await assert.rejects(session.client.callTool({
    name: attemptedName,
    arguments: pageChangeRequestExample(),
  }), (error) => {
    assert.equal(error.code, UNKNOWN_TOOL_RECOVERY.jsonRpcCode);
    assert.deepEqual(error.data, unknownToolErrorData());
    const mapped = mapUnknownToolRecovery(error, { attemptedName });
    assert.equal(mapped.nextMethod, "tools/list");
    assert.equal(mapped.tool, FREE_PAGE_CHANGE.tool);
    assert.equal(mapped.paidFallback, false);
    return true;
  });

  assert.throws(
    () => mapUnknownToolRecovery({ code: -32602, message: "Unknown tool", data: { nextMethod: "tools/list", availableTools: ["extract"] } }),
    { message: "unknown_tool_recovery_unmapped" },
  );
  assert.throws(
    () => mapUnknownToolRecovery({
      code: -32602,
      message: "Unknown tool",
      data: unknownToolErrorData(),
      extra: "other-client-private-tool-name",
    }, { attemptedName: "other-client-private-tool-name" }),
    { message: "unknown_tool_recovery_reflected_name" },
  );

  const incomplete = await session.client.callTool({
    name: FREE_PAGE_CHANGE.tool,
    arguments: omitSelectedTitle(pageChangeRequestExample()),
  });
  assert.notEqual(incomplete.isError, true);
  const incompleteBody = toolJson(incomplete);
  assert.equal(incompleteBody.ok, true);
  assert.equal(incompleteBody.charged, false);
  assert.equal(incompleteBody.report.verdict, "incomplete");
});

test("recovery: tools/list after a wrong-tool refusal completes the free compare", async (t) => {
  const profile = await listenProfile(enabledEnv);
  t.after(() => profile.close());
  const session = await connectClient(profile.base);
  t.after(() => session.close());

  const attemptedName = "page_change";
  let mapped;
  await assert.rejects(session.client.callTool({
    name: attemptedName,
    arguments: pageChangeRequestExample(),
  }), (error) => {
    mapped = mapUnknownToolRecovery(error, { attemptedName });
    return true;
  });
  assert.equal(mapped.nextMethod, "tools/list");

  const listed = await session.client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), [mapped.tool]);
  const recoveredResult = await session.client.callTool({
    name: mapped.tool,
    arguments: pageChangeRequestExample(),
  });
  assert.notEqual(recoveredResult.resultType, TASKS_EXTENSION.resultTypeTask);
  const recovered = toolJson(recoveredResult);
  assert.equal(recovered.charged, false);
  assert.equal(recovered.report.verdict, "changed");
});

test("tasks-capability lock: declaring ext-tasks on tools/call still returns a plain CallToolResult", async (t) => {
  const profile = await listenProfile(enabledEnv);
  t.after(() => profile.close());
  const wire = watchFetch(profile.base, { attachTasksCapability: true });
  t.after(() => wire.restore());
  const session = await connectClient(profile.base);
  t.after(() => session.close());

  const result = await session.client.callTool({
    name: FREE_PAGE_CHANGE.tool,
    arguments: pageChangeRequestExample(),
    _meta: tasksClientCapabilityMeta(),
  });
  assert.notEqual(result.isError, true);
  assert.notEqual(result.resultType, TASKS_EXTENSION.resultTypeTask);
  assert.equal(result[TASKS_EXTENSION.taskIdField], undefined);
  const body = toolJson(result);
  assert.equal(body.ok, true);
  assert.equal(body.charged, false);
  assert.equal(body.report.verdict, "changed");
  assert.ok(Array.isArray(result.content) && result.content.length > 0);
  assert.equal(typeof result.structuredContent, "object");
  assert.ok(result.structuredContent);

  const calls = wire.events.filter((event) => event.method === "tools/call" && event.tool === FREE_PAGE_CHANGE.tool);
  assert.ok(calls.length >= 1);
  assert.equal(calls.every((event) => event.declaredTasksExtension), true);
  assert.equal(calls.every((event) => event.resultType !== TASKS_EXTENSION.resultTypeTask), true);
  assert.equal(calls.every((event) => event.resultTaskId == null), true);
  assert.equal(calls.every((event) => event.hasContent), true);
  assert.equal(calls.every((event) => event.hasStructuredContent), true);
  assert.equal(wire.events.some((event) => event.paymentSignature), false);
});

test("failure: explicit 2026-07-28 pin is refused on the free profile without a paid fallback", async (t) => {
  const profile = await listenProfile(enabledEnv);
  t.after(() => profile.close());
  const freeUrl = `${profile.base}${FREE_PAGE_CHANGE.path}`;
  const wire = watchFetch(profile.base);
  t.after(() => wire.restore());

  // Mirror mcp-current-client-compat.test.mjs at e90676f4:
  // const pinnedFree = new CurrentClient({ name: "current-pin", version: "2.4.0" }, {
  //   versionNegotiation: { mode: { pin: CURRENT_PROTOCOL } },
  // });
  // await assert.rejects(
  //   () => pinnedFree.connect(new CurrentTransport(new URL(freeUrl))),
  //   (error) => error instanceof SdkError && error.code === "ERA_NEGOTIATION_FAILED",
  // );
  const pinnedFree = new CurrentClient({
    name: OFFICIAL_CLIENT_NEGOTIATION.pinClientName,
    version: OFFICIAL_CLIENT_NEGOTIATION.pinClientVersion,
  }, {
    versionNegotiation: { mode: { pin: OFFICIAL_CLIENT_NEGOTIATION.refusedFreeProtocol } },
  });
  await assert.rejects(
    () => pinnedFree.connect(new CurrentTransport(new URL(freeUrl))),
    (error) => error instanceof SdkError && error.code === OFFICIAL_CLIENT_NEGOTIATION.pinClientErrorCode,
  );
  await pinnedFree.close().catch(() => {});

  // Same file, same pin: free server/discover events have status 400, errorCode
  // -32000, and errorMessage /Unsupported protocol version: 2026-07-28/ plus
  // /2025-11-25/. No payment signature is observed on the wire.
  const discover = wire.events.filter((event) => event.method === "server/discover");
  const freeDiscover = discover.filter((event) => event.status === OFFICIAL_CLIENT_NEGOTIATION.discoverHttpStatus);
  assert.ok(freeDiscover.length >= 1);
  assert.equal(freeDiscover.every((event) => event.errorCode === OFFICIAL_CLIENT_NEGOTIATION.discoverJsonRpcCode), true);
  assert.match(freeDiscover[0].errorMessage, OFFICIAL_CLIENT_NEGOTIATION.discoverMessageUnsupported);
  assert.match(freeDiscover[0].errorMessage, OFFICIAL_CLIENT_NEGOTIATION.discoverMessageSupported);
  assert.equal(wire.events.some((event) => event.paymentSignature), false);
  assert.equal(wire.events.some((event) => event.tool && event.tool !== FREE_PAGE_CHANGE.tool), false);

  const session = await connectClient(profile.base);
  t.after(() => session.close());
  const { tools } = await session.client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [FREE_PAGE_CHANGE.tool]);
});
