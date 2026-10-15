import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import express from "express";

import { callerResultFeedbackPublicContract } from "../../../caller-result-feedback.mjs";
import { attachMcpCallerResultFeedback, mcpCallerResultFeedbackPublicContract } from "../../../caller-result-feedback.mjs";
import { CALLER_RESULT_FEEDBACK_PATH } from "../../../caller-result-client/src/contract.mjs";
import { createDeliveryObservation } from "../../../http-delivery-evidence/observation.mjs";
import { digestMcpCallId, digestMcpPayload } from "../../../http-delivery-evidence/digest.mjs";
import { MCP_MORPHO_RESOURCE, MCP_MORPHO_TOOL } from "../../../http-delivery-evidence/mcp-delivery.mjs";
import { decoratePaidResponse, mountUsefulServiceObservation } from "../src/mount.mjs";
import {
  NOW,
  observationFor,
  observedPair,
  removeDir,
  secret,
  tempDir,
  writeCaptures,
} from "./helpers.mjs";

function listen(app) {
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

test("D2 a cold client discovers and submits the extension from the served link", async () => {
  const dir = await tempDir();
  const key = secret();
  const pair = observedPair();
  await writeCaptures(dir, [pair]);
  const observation = observationFor(dir, key);
  const app = express();
  app.use(express.json({
    verify(req, _res, buffer) {
      req.rawBody = Buffer.from(buffer);
    },
  }));
  app.get("/extract", (_req, res) => {
    decoratePaidResponse(res, {
      key,
      eventId: pair.paid.id,
      method: "GET",
      route: "/extract",
      requestDigest: pair.paid.requestDigest,
      responseDigest: pair.paid.responseDigest,
      statusCode: 200,
      now: NOW,
    });
    res.status(200).json({ ok: true });
  });
  mountUsefulServiceObservation(app, observation);
  const { server, base } = await listen(app);
  try {
    const paid = await fetch(`${base}/extract`);
    const link = paid.headers.get("link") || "";
    const part = link.split(",").find((item) => item.includes('rel="useful-service-observation"'));
    assert.ok(part, "paid response omitted the observation link");
    const href = part.match(/<([^>]+)>/)?.[1];
    assert.equal(href, CALLER_RESULT_FEEDBACK_PATH);
    const contractResponse = await fetch(`${base}${href}`);
    const contract = await contractResponse.json();
    const canonical = callerResultFeedbackPublicContract();
    for (const [keyName, value] of Object.entries(canonical)) {
      assert.deepEqual(contract[keyName], value);
    }
    const extension = contract.usefulServiceObservation;
    assert.equal(extension.optional, true);
    assert.equal(extension.charged, false);
    assert.equal(extension.usefulness, "unknown");
    assert.equal(extension.priorHeader, "x-samedaydesk-prior-caller-result");
    assert.equal(extension.retainedUse.includes("retained"), true);
    assert.equal(extension.nextTaskRelations.includes("none"), true);
    const token = paid.headers.get("x-samedaydesk-caller-result-feedback");
    const submitted = await fetch(`${base}${href}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-samedaydesk-caller-result-feedback": token,
      },
      body: JSON.stringify({
        disposition: contract.dispositions[0],
        reasonCategory: contract.reasonCategories[0],
        retainedUse: extension.retainedUse[0],
        nextTask: { relation: "none", taskRef: "none" },
        originLabel: extension.originLabels[0],
      }),
    });
    const body = await submitted.json();
    assert.equal(submitted.status, 200, JSON.stringify(body));
    assert.equal(body.accepted, true);
    assert.equal(body.retainedUse, "retained");
    assert.equal(body.usefulness, "unknown");
    assert.equal(body.charged, false);
  } finally {
    server.close();
    await removeDir(dir);
  }
});

test("D2 MCP meta keeps the canonical contract and does not carry the HTTP extension", () => {
  const payload = Buffer.from('{"ok":true}', "utf8");
  const callId = "7";
  const result = { content: [{ type: "text", text: payload.toString("utf8") }] };
  const attached = attachMcpCallerResultFeedback(result, {
    key: secret(),
    eligible: true,
    observation: createDeliveryObservation({
      source: "mcp_tool_result",
      responseDigest: digestMcpPayload(payload),
      responseByteLength: payload.length,
      tool: MCP_MORPHO_TOOL,
      productSku: "samedaydesk-morpho-position",
      resource: MCP_MORPHO_RESOURCE,
      issuedOfferDigest: "ab".repeat(32),
      callId,
      callDigest: digestMcpCallId(callId),
      settlementReference: `0x${"a".repeat(64)}`,
      applicationIsError: false,
      payload,
    }),
  });
  assert.equal(attached, true);
  const meta = result._meta["samedaydesk/mcp-caller-result"];
  assert.deepEqual(
    Object.fromEntries(Object.entries(mcpCallerResultFeedbackPublicContract()).map(([key, value]) => [key, meta[key]])),
    mcpCallerResultFeedbackPublicContract(),
  );
  assert.equal(Object.hasOwn(meta, "usefulServiceObservation"), false);
  assert.equal(JSON.stringify(meta).includes(CALLER_RESULT_FEEDBACK_PATH), false);
});
