import assert from "node:assert/strict";
import test from "node:test";
import { createUnpaidListTool, langchainToolSpec, unpaidListTool } from "../src/tool.mjs";
import { TOOL_NAME } from "../src/constants.mjs";
import { jsonResponse } from "./helpers.mjs";

test("LangChain tool invoke returns JSON string from the fixture", async () => {
  const raw = await unpaidListTool.invoke({});
  const report = JSON.parse(raw);
  assert.equal(unpaidListTool.name, TOOL_NAME);
  assert.equal(report.ok, true);
  assert.equal(report.itemCount, 3);
  assert.equal(report.boundary.paymentSent, false);
});

test("LangChain tool accepts a query string and JSON object", async () => {
  const fromString = JSON.parse(await unpaidListTool.invoke("extract"));
  assert.ok(fromString.itemCount >= 1);
  assert.ok(fromString.items.every((item) => item.route.includes("extract") || item.description.toLowerCase().includes("extract")));
  const fromObject = JSON.parse(await unpaidListTool.func({ route: "/read" }));
  assert.equal(fromObject.itemCount, 1);
  assert.equal(fromObject.items[0].route, "/read");
});

test("LangChain tool refuses wallet fields", async () => {
  await assert.rejects(() => unpaidListTool.invoke({ wallet: true }), /unsupported tool field: wallet/);
});

test("tool spec is a function calling descriptor", () => {
  const spec = langchainToolSpec();
  assert.equal(spec.function.name, TOOL_NAME);
  assert.deepEqual(Object.keys(spec.function.parameters.properties).sort(), ["query", "route"]);
});

test("bound tool lists a live mock catalog without payment headers", async () => {
  const calls = [];
  const tool = createUnpaidListTool({
    origin: "https://agents.samedaydesk.com",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), headers: { ...init?.headers } });
      return jsonResponse({
        x402Version: 2,
        items: [
          {
            resource: {
              url: "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com",
              routeTemplate: "/extract",
              description: "extract",
              tags: ["web"],
            },
            type: "http",
            request: { method: "GET", url: "https://agents.samedaydesk.com/extract" },
            accepts: [{
              scheme: "exact",
              network: "eip155:8453",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              amount: "5000",
              payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
            }],
          },
        ],
      });
    },
  });
  const report = JSON.parse(await tool.invoke({ query: "extract" }));
  assert.equal(report.source.kind, "live");
  assert.equal(report.source.httpStatus, 200);
  assert.equal(report.itemCount, 1);
  assert.equal(calls[0].url, "https://agents.samedaydesk.com/.well-known/x402");
  assert.equal(calls[0].headers.accept, "application/json");
  assert.equal(calls[0].headers["payment-signature"], undefined);
});
