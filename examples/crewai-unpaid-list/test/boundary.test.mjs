import assert from "node:assert/strict";
import test from "node:test";

import { CrewaiUnpaidListError } from "../src/errors.mjs";
import { parseCli } from "../src/parse-args.mjs";
import { postRpc } from "../src/transport.mjs";
import { assertListUrl } from "../src/url-guard.mjs";
import { loadCrewaiConfig, mcpServerAdapterParams } from "../src/crewai-config.mjs";
import { LIVE_MCP_URL } from "../src/constants.mjs";

test("refuses tools/call and payment flags", () => {
  for (const flag of ["--call", "--pay", "--approve", "--kickoff", "--checkout"]) {
    assert.throws(() => parseCli([flag]), (error) => (
      error instanceof CrewaiUnpaidListError
      && error.code === "BOUNDARY_REFUSED"
    ), flag);
  }
});

test("refuses tools/call on the transport", async () => {
  await assert.rejects(
    () => postRpc(LIVE_MCP_URL, "tools/call", { name: "extract" }, 9),
    (error) => error.code === "BOUNDARY_REFUSED" && error.kind === "tools_called",
  );
});

test("refuses payment headers", async () => {
  await assert.rejects(
    () => postRpc(LIVE_MCP_URL, "tools/list", {}, 2, {
      headers: { "PAYMENT-SIGNATURE": "nope" },
    }),
    (error) => error.code === "BOUNDARY_REFUSED",
  );
});

test("url guard pins SDS and allows loopback http", () => {
  assert.equal(assertListUrl(LIVE_MCP_URL), LIVE_MCP_URL);
  assert.equal(assertListUrl("http://127.0.0.1:9/mcp"), "http://127.0.0.1:9/mcp");
  assert.throws(() => assertListUrl("https://example.com/mcp"), /must be/);
  assert.throws(() => assertListUrl("http://agents.samedaydesk.com/mcp"), /loopback/);
  assert.throws(() => assertListUrl("https://user:pass@agents.samedaydesk.com/mcp"), /credentials/);
});

test("shipped CrewAI config is streamable-http with empty headers", () => {
  const config = loadCrewaiConfig();
  assert.equal(config.url, LIVE_MCP_URL);
  assert.equal(config.transport, "streamable-http");
  assert.deepEqual(config.headers, {});
  assert.deepEqual(mcpServerAdapterParams(config), {
    url: LIVE_MCP_URL,
    transport: "streamable-http",
  });
});
