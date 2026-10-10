import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CALLER_RESULT_USEFULNESS,
  mcpCallerResultFeedbackPublicContract,
} from "../src/contract.mjs";
import {
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_PATH,
  bindCallerResultFeedback,
  reportCallerResult,
} from "../src/http-caller-result.mjs";
import {
  bindPaidMcpCallerResult,
  readMcpCallerResultCapability,
  reportMcpCallerResult,
} from "../src/mcp-caller-result.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const token = `${"a".repeat(24)}.${"a".repeat(43)}`;

test("package sources do not import the merchant server", async () => {
  const files = [
    "src/contract.mjs",
    "src/http-caller-result.mjs",
    "src/mcp-caller-result.mjs",
    "src/index.mjs",
    "bin/cold-consumer.mjs",
  ];
  const banned = [
    "caller-result-" + "feedback.mjs",
    "serv" + "er.js",
    "create" + "Hmac",
    "generate" + "PrivateKey",
    "commerce-" + "events.mjs",
  ];
  for (const file of files) {
    const text = await readFile(join(root, file), "utf8");
    for (const needle of banned) assert.equal(text.includes(needle), false, `${file} ${needle}`);
  }
});

test("mcp contract stays free of links and chain claims", () => {
  const contract = mcpCallerResultFeedbackPublicContract();
  const encoded = JSON.stringify(contract);
  assert.equal(encoded.includes("http"), false);
  assert.equal(contract.channel, "mcp");
  assert.equal(contract.charged, false);
  assert.equal(contract.usefulness, CALLER_RESULT_USEFULNESS);
  assert.equal(contract.optional, true);
});

test("overlapping results keep separate capabilities and reporting does not pay", async () => {
  const hooks = [];
  let paymentCalls = 0;
  const issuedA = `${"A".repeat(24)}.${"A".repeat(43)}`;
  const issuedB = `${"B".repeat(24)}.${"B".repeat(43)}`;
  const client = {
    onAfterPayment(hook) { hooks.push(hook); },
    async callTool(name, args) {
      paymentCalls += 1;
      const content = [{ type: "text", text: args.id }];
      await hooks[0]({
        result: {
          content,
          _meta: {
            "samedaydesk/mcp-caller-result": {
              ...mcpCallerResultFeedbackPublicContract(),
              token: args.id === "A" ? issuedA : issuedB,
            },
          },
        },
      });
      return { content, paymentMade: true };
    },
    client: {
      async callTool(params) {
        assert.equal(params.name, "report_caller_result");
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              accepted: true,
              bound: false,
              parent: "pending",
              charged: false,
              disposition: params.arguments.disposition,
            }),
          }],
        };
      },
    },
  };
  const paid = bindPaidMcpCallerResult(client);
  const [left, right] = await Promise.all([
    paid.pay("morpho_position", { id: "A" }),
    paid.pay("morpho_position", { id: "B" }),
  ]);
  assert.equal(left.capability.token, issuedA);
  assert.equal(right.capability.token, issuedB);
  assert.equal(left.returnedCapability, false);
  const before = JSON.stringify(left.content);
  const reported = await paid.report({ token: issuedA, disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(reported.accepted, true);
  assert.equal(reported.bound, false);
  assert.equal(reported.parent, "pending");
  assert.equal(JSON.stringify(left.content), before);
  assert.equal(paymentCalls, 2);
  const link = readMcpCallerResultCapability({
    _meta: { "samedaydesk/mcp-caller-result": { ...mcpCallerResultFeedbackPublicContract(), token, link: "https://evil.example" } },
  });
  assert.equal(link.reason, "unbounded_field");
});

test("http report stays on the paid origin and does not treat accepted as bound", async () => {
  const result = { kept: true };
  bindCallerResultFeedback(result, {
    response: new Response(null, { headers: { [CALLER_RESULT_FEEDBACK_HEADER]: token } }),
    resourceUrl: "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com",
  });
  const posts = [];
  const reported = await reportCallerResult(result, { disposition: "not_useful", reasonCategory: "missing_field" }, {
    fetchImpl: async (url, init) => {
      posts.push(String(url));
      assert.equal(new Request(url, init).headers.get(CALLER_RESULT_FEEDBACK_HEADER), token);
      return new Response(JSON.stringify({
        ok: true,
        accepted: true,
        bound: false,
        charged: false,
        payerIdentity: false,
        usefulness: "unknown",
        disposition: "not_useful",
        reasonCategory: "missing_field",
      }), { status: 200 });
    },
  });
  assert.equal(posts[0], `https://agents.samedaydesk.com${CALLER_RESULT_FEEDBACK_PATH}`);
  assert.equal(reported.accepted, true);
  assert.equal(reported.bound, false);
  assert.equal(result.kept, true);
  const local = {};
  bindCallerResultFeedback(local, {
    response: new Response(null, { headers: { [CALLER_RESULT_FEEDBACK_HEADER]: token } }),
    resourceUrl: "http://127.0.0.1/extract",
  });
  assert.equal((await reportCallerResult(local, { disposition: "useful" })).code, "untrusted_origin");
});
