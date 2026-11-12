import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
