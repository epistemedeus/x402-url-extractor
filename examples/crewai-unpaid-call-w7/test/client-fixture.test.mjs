import assert from "node:assert/strict";
import test from "node:test";

import { crewaiUnpaidToolsCall } from "../src/client.mjs";
import { classifyToolsCall, KIND } from "../src/classify.mjs";
import { CrewaiUnpaidCallError } from "../src/errors.mjs";
import { startFixtureServer } from "../src/fixture-server.mjs";
import { TOOL_ARGUMENTS, TOOL_NAME } from "../src/pins.mjs";
import { reportFromCall } from "../src/run.mjs";

test("loopback fixture unpaid extract is CrewAI-visible isError, handler did not run", async () => {
  const fixture = await startFixtureServer();
  try {
    const session = await crewaiUnpaidToolsCall({
      mcpUrl: fixture.mcpUrl,
      toolName: TOOL_NAME,
      arguments: TOOL_ARGUMENTS,
    });
    assert.equal(session.toolsCall.status, 200);
    assert.equal(session.toolsCall.rpc.result.isError, true);
    const names = session.toolsList.rpc.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [TOOL_NAME]);
    const report = reportFromCall(session);
    assert.equal(report.ok, true);
    assert.equal(report.kind, KIND.UNPAID_TOOLS_CALL_IS_ERROR);
    assert.equal(report.mcp.handlerRan, false);
    const classified = classifyToolsCall({
      httpStatus: session.toolsCall.status,
      rpc: session.toolsCall.rpc,
    });
    assert.equal(classified.acceptsCount, 1);
    assert.match(classified.error, /Payment required/i);
  } finally {
    await fixture.close();
  }
});

test("SSE fixture unpaid tools/call still decodes isError:true", async () => {
  const fixture = await startFixtureServer({ preferSse: true });
  try {
    const session = await crewaiUnpaidToolsCall({
      mcpUrl: fixture.mcpUrl,
      toolName: TOOL_NAME,
      arguments: TOOL_ARGUMENTS,
    });
    assert.equal(session.toolsCall.rpc.result.isError, true);
    assert.equal(classifyToolsCall({
      httpStatus: session.toolsCall.status,
      rpc: session.toolsCall.rpc,
    }).kind, KIND.UNPAID_TOOLS_CALL_IS_ERROR);
  } finally {
    await fixture.close();
  }
});

test("client refuses payment headers before any tools/call", async () => {
  const fixture = await startFixtureServer();
  try {
    await assert.rejects(
      () => crewaiUnpaidToolsCall({
        mcpUrl: fixture.mcpUrl,
        toolName: TOOL_NAME,
        arguments: TOOL_ARGUMENTS,
        headers: { "payment-signature": "00" },
      }),
      (error) => error instanceof CrewaiUnpaidCallError && error.code === "PAYMENT_HEADER_REFUSED",
    );
  } finally {
    await fixture.close();
  }
});
