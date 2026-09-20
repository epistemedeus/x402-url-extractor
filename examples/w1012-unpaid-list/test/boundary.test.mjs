import assert from "node:assert/strict";
import test from "node:test";

import { W1012UnpaidListError } from "../src/errors.mjs";
import { parseCli } from "../src/parse-args.mjs";
import { postRpc } from "../src/transport.mjs";
import { assertListUrl } from "../src/url-guard.mjs";
import { loadMcpConfig } from "../src/config.mjs";
import { LIVE_MCP_URL } from "../src/constants.mjs";

test("refuses tools/call, pay, publish, and neo flags", () => {
  for (const flag of ["--call", "--pay", "--approve", "--publish", "--neo", "--checkout"]) {
    assert.throws(() => parseCli([flag]), (error) => (
      error instanceof W1012UnpaidListError
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

test("url guard pins SDS, allows loopback http, and refuses neo", () => {
  assert.equal(assertListUrl(LIVE_MCP_URL), LIVE_MCP_URL);
  assert.equal(assertListUrl("http://127.0.0.1:9/mcp"), "http://127.0.0.1:9/mcp");
  assert.throws(() => assertListUrl("https://example.com/mcp"), /must be/);
  assert.throws(() => assertListUrl("http://agents.samedaydesk.com/mcp"), /loopback/);
  assert.throws(() => assertListUrl("https://user:pass@agents.samedaydesk.com/mcp"), /credentials/);
  assert.throws(() => assertListUrl("https://mcp.neomorphic.io/mcp"), /neo/);
  assert.throws(() => assertListUrl("https://agents.samedaydesk.com/mcp?pay=1"), /query/);
});

test("shipped MCP config is streamable-http with empty headers", () => {
  const config = loadMcpConfig();
  assert.equal(config.url, LIVE_MCP_URL);
  assert.equal(config.transport, "streamable-http");
  assert.deepEqual(config.headers, {});
});
