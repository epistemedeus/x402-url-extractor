import assert from "node:assert/strict";
import test from "node:test";

import { CrewaiUnpaidCallError } from "../src/errors.mjs";
import { NEO_LABS_CREWAI, SDS_MCP_URL } from "../src/pins.mjs";
import {
  assertLoopbackMcpUrl,
  refuseForbiddenArgv,
  refuseLiveOrNeoUrl,
  refusePaymentHeaders,
  refusePaymentMeta,
} from "../src/refuse.mjs";

function throwsCode(fn, code) {
  assert.throws(fn, (error) => error instanceof CrewaiUnpaidCallError && error.code === code);
}

test("forbidden live/pay/kickoff/neo flags fail closed", () => {
  for (const flag of ["--live", "--approve", "--pay", "--kickoff", "--neo", "--publish", "--wallet"]) {
    throwsCode(() => refuseForbiddenArgv([flag]), "BOUNDARY_REFUSED");
  }
});

test("payment headers and tools/call payment meta are refused", () => {
  throwsCode(() => refusePaymentHeaders({ authorization: "Bearer x" }), "PAYMENT_HEADER_REFUSED");
  throwsCode(() => refusePaymentHeaders({ "PAYMENT-SIGNATURE": "aa" }), "PAYMENT_HEADER_REFUSED");
  throwsCode(() => refusePaymentMeta({ "x402/payment": { extra: true } }), "PAYMENT_META_REFUSED");
});

test("live SDS MCP and neo labs URLs are refused", () => {
  throwsCode(() => refuseLiveOrNeoUrl(SDS_MCP_URL), "LIVE_URL_REFUSED");
  throwsCode(() => refuseLiveOrNeoUrl(NEO_LABS_CREWAI), "NEO_REFUSED");
  throwsCode(() => assertLoopbackMcpUrl("https://agents.samedaydesk.com/mcp"), "NON_LOOPBACK_REFUSED");
  throwsCode(() => assertLoopbackMcpUrl("http://example.com/mcp"), "NON_LOOPBACK_REFUSED");
});

test("loopback HTTP MCP URLs are accepted", () => {
  const url = assertLoopbackMcpUrl("http://127.0.0.1:9/mcp");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/mcp");
});
