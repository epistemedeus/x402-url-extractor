import assert from "node:assert/strict";
import test from "node:test";

import { LIVE_MCP_URL } from "../src/constants.mjs";
import { PolicyRefusal } from "../src/errors.mjs";
import {
  assertAllowedHttpMethod,
  assertAllowedRpcMethod,
  assertMcpListUrl,
  assertNoCredentialHeaders,
  refusedCliFlag,
} from "../src/policy.mjs";
import { createUnpaidDiscoveryFetch } from "../src/transport.mjs";

test("live SameDayDesk MCP url is accepted", () => {
  assert.equal(assertMcpListUrl(LIVE_MCP_URL), LIVE_MCP_URL);
});

test("http SameDayDesk MCP url is refused", () => {
  assert.throws(
    () => assertMcpListUrl("http://agents.samedaydesk.com/mcp"),
    (error) => error instanceof PolicyRefusal && /HTTPS/.test(error.message),
  );
});

test("foreign host is refused", () => {
  assert.throws(
    () => assertMcpListUrl("https://example.com/mcp"),
    (error) => error instanceof PolicyRefusal && /host/.test(error.message),
  );
});

test("credentials and query are refused", () => {
  assert.throws(() => assertMcpListUrl("https://user:pass@agents.samedaydesk.com/mcp"));
  assert.throws(() => assertMcpListUrl("https://agents.samedaydesk.com/mcp?x=1"));
});

test("loopback /mcp is allowed for fixtures", () => {
  assert.equal(assertMcpListUrl("http://127.0.0.1:9/mcp"), "http://127.0.0.1:9/mcp");
});

test("tools/call and payment headers are refused", () => {
  assert.throws(
    () => assertAllowedRpcMethod("tools/call"),
    (error) => error instanceof PolicyRefusal && /tools\/call/.test(error.message),
  );
  assert.throws(() => assertNoCredentialHeaders({ "PAYMENT-SIGNATURE": "x" }));
  assert.throws(() => assertNoCredentialHeaders({ Authorization: "Bearer x" }));
  assert.equal(assertAllowedRpcMethod("tools/list"), "tools/list");
  assert.equal(assertAllowedHttpMethod("POST"), "POST");
});

test("fetch wrapper refuses tools/call before the inner client runs", async () => {
  let innerCalls = 0;
  const { fetchImpl } = createUnpaidDiscoveryFetch({
    innerFetch: async () => {
      innerCalls += 1;
      return new Response("{}", { status: 200 });
    },
  });
  await assert.rejects(
    () => fetchImpl("https://agents.samedaydesk.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "extract" } }),
    }),
    (error) => error instanceof PolicyRefusal && innerCalls === 0,
  );
});

test("refused CLI flags include call and approve", () => {
  assert.equal(refusedCliFlag("--call"), "--call");
  assert.equal(refusedCliFlag("--call=extract"), "--call");
  assert.equal(refusedCliFlag("--approve"), "--approve");
  assert.equal(refusedCliFlag("--url"), null);
});
