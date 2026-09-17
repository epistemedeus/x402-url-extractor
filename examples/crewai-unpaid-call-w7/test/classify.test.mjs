import assert from "node:assert/strict";
import test from "node:test";

import { unpaidExtractResult } from "../src/challenge.mjs";
import {
  KIND,
  classifyDroppedCallTool,
  classifyToolsCall,
  crewaiCallTool,
  crewaiCallToolResult,
} from "../src/classify.mjs";

test("unpaid extract tools/call is isError Payment required, not paid success", () => {
  const result = unpaidExtractResult();
  const classified = classifyToolsCall({ httpStatus: 200, rpc: { jsonrpc: "2.0", id: 3, result } });
  assert.equal(classified.kind, KIND.UNPAID_TOOLS_CALL_IS_ERROR);
  assert.equal(classified.isError, true);
  assert.equal(classified.handlerRan, false);
  assert.equal(classified.x402Version, 2);
  assert.equal(classified.acceptsCount, 1);
});

test("CrewAI call_tool_result keeps isError; call_tool drops it", () => {
  const result = unpaidExtractResult();
  const kept = crewaiCallToolResult(result);
  const dropped = crewaiCallTool(result);
  assert.equal(kept.is_error, true);
  assert.match(kept.content, /Payment required/);
  assert.match(dropped, /Payment required/);
  assert.equal(Object.hasOwn({ content: dropped }, "is_error"), false);
});

test("HTTP 200 plus extract payload without isError is handler_ran_unpaid", () => {
  const classified = classifyToolsCall({
    httpStatus: 200,
    rpc: {
      jsonrpc: "2.0",
      id: 3,
      result: {
        content: [{ type: "text", text: JSON.stringify({ ok: true, title: "Example", url: "https://example.com/" }) }],
        structuredContent: { ok: true, title: "Example", url: "https://example.com/" },
      },
    },
  });
  assert.equal(classified.kind, KIND.HANDLER_RAN_UNPAID);
  assert.equal(classified.handlerRan, true);
});

test("JSON-RPC error is protocol_error, not the isError tool result", () => {
  const classified = classifyToolsCall({
    httpStatus: 200,
    rpc: { jsonrpc: "2.0", id: 3, error: { code: -32042, message: "Payment required" } },
  });
  assert.equal(classified.kind, KIND.PROTOCOL_ERROR);
});

test("payment-response meta is settlement and is not an unpaid success", () => {
  const result = unpaidExtractResult();
  result._meta = { "x402/payment-response": { success: true } };
  const classified = classifyToolsCall({ httpStatus: 200, rpc: { result } });
  assert.equal(classified.kind, KIND.SETTLEMENT);
});

test("dropping isError on unpaid challenge is the CrewAI false-success trap", () => {
  const result = unpaidExtractResult();
  const dropped = classifyDroppedCallTool(crewaiCallTool(result), result);
  assert.equal(dropped.kind, KIND.FALSE_SUCCESS);
  assert.equal(dropped.claimed, KIND.PAID_SUCCESS);
  assert.equal(dropped.observed, KIND.UNPAID_TOOLS_CALL_IS_ERROR);
  assert.equal(dropped.droppedIsError, true);
});
