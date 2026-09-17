import assert from "node:assert/strict";
import test from "node:test";

import { MCPServerStreamableHttp } from "@openai/agents";

import { LIVE_MCP_URL, TRANSPORT_CLASS } from "../src/constants.mjs";
import { InventoryError } from "../src/errors.mjs";
import { createStreamableHttpServer, listUnpaidSdsTools } from "../src/list-tools.mjs";
import { fakeServer, fixtureTools } from "./helpers.mjs";

test("default server factory is MCPServerStreamableHttp", async () => {
  const server = await createStreamableHttpServer({ url: LIVE_MCP_URL, name: "test" });
  assert.equal(server.constructor.name, TRANSPORT_CLASS);
  assert.equal(server instanceof MCPServerStreamableHttp, true);
});

test("injected server lists extract and extract_batch unpaid", async () => {
  const result = await listUnpaidSdsTools({
    createServer: () => fakeServer(fixtureTools()),
    fetchImpl: async () => {
      throw new Error("network must not be used for injected server");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.transportClass, TRANSPORT_CLASS);
  assert.equal(result.url, LIVE_MCP_URL);
  assert.equal(result.extractPresent, true);
  assert.equal(result.extractBatchPresent, true);
  assert.equal(result.paymentAttempted, false);
  assert.equal(result.toolsCalled, false);
  assert.equal(result.agentRun, false);
  assert.equal(result.exactGlobalCountRequired, false);
  assert.ok(result.names.includes("extract"));
  assert.ok(result.names.includes("extract_batch"));
});

test("injected missing extract is refused", async () => {
  await assert.rejects(
    () => listUnpaidSdsTools({
      createServer: () => fakeServer(fixtureTools("tools-list-missing-extract.json")),
    }),
    InventoryError,
  );
});
