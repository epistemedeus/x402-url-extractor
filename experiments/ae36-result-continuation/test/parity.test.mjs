import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CALLER_RESULT_TOKEN_RE } from "../../../caller-result-client/src/contract.mjs";
import {
  NEW_PAID_TASK,
  actionParity,
  classifyHttpExchange,
  classifySdkResult,
  discoverHttpNextActions,
  discoverSdkNextActions,
  matchesSupportedNextActions,
  reportSdkResult,
} from "../src/cold-client.mjs";

const expected = JSON.parse(await readFile(new URL("../fixtures/supported-next-actions.json", import.meta.url), "utf8"));
const classes = JSON.parse(await readFile(new URL("../fixtures/exchange-classes.json", import.meta.url), "utf8"));
const forged = JSON.parse(await readFile(new URL("../fixtures/forged-capability.json", import.meta.url), "utf8"));

const httpDiscovery = {
  feedbackContract: {
    optional: true,
    charged: false,
    payerIdentity: false,
    usefulness: "unknown",
    method: "POST",
    path: "/commerce/caller-result-feedback",
    header: "x-samedaydesk-caller-result-feedback",
    dispositions: ["useful", "not_useful"],
  },
  routeReplay: { responseReplay: "conditional", mismatchStatus: 409 },
  capability: { available: true, charged: false, automatic: false },
};

const sdkDiscovery = {
  tools: [
    { name: "extract", _meta: { x402: { accepts: [{}] } } },
    { name: "report_caller_result", _meta: { samedaydesk: { charged: false, paymentRequired: false } } },
    { name: "recover_paid_result", _meta: { samedaydesk: { charged: false, paymentRequired: false } } },
  ],
  capability: { present: true, tool: "report_caller_result", token: forged.token },
};

test("current source advertises the same next actions on HTTP and SDK", async () => {
  const source = await readFile(new URL("../src/cold-client.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("server.js"), false);
  assert.equal(source.includes("caller-result-feedback.mjs"), false);
  assert.equal(source.includes("bindMerchantHttpDeliveryContracts"), false);
  assert.equal(source.includes("experiments/ae19-paid-continuation"), false);
  const http = discoverHttpNextActions(httpDiscovery);
  const sdk = discoverSdkNextActions(sdkDiscovery);
  assert.equal(matchesSupportedNextActions(http, expected), true);
  assert.equal(matchesSupportedNextActions(sdk, expected), true);
  assert.equal(actionParity(http, sdk), true);
  assert.equal(http.paidTask.id, NEW_PAID_TASK);
  assert.equal(sdk.actions.some((action) => action.id === NEW_PAID_TASK), false);
  const hidden = discoverHttpNextActions({ ...httpDiscovery, capability: { available: false, charged: false, automatic: false } });
  assert.equal(hidden.actions.some((action) => action.id === "report_result"), false);
});

test("exchange fixtures separate a new paid task, entitled retrieval, and a wrong receipt", () => {
  for (const entry of classes.http) {
    assert.deepEqual(classifyHttpExchange(entry), {
      kind: entry.kind,
      repurchase: entry.repurchase,
      ...(entry.code ? { code: entry.code } : {}),
    });
  }
  for (const entry of classes.sdk) {
    assert.deepEqual(classifySdkResult({
      _meta: {
        "samedaydesk/recovery": {
          version: 1,
          replayed: entry.replayed,
          newSettlementAttempt: entry.newSettlementAttempt,
        },
      },
    }), { kind: entry.kind, repurchase: entry.repurchase });
  }
});

test("a forged or other result receipt is refused before a report is sent", async () => {
  assert.equal(CALLER_RESULT_TOKEN_RE.test(forged.token), true);
  let calls = 0;
  const client = { callTool() { calls += 1; return {}; } };
  const issued = `${"b".repeat(24)}.${"b".repeat(43)}`;
  const refused = await reportSdkResult(client, {
    present: true,
    token: issued,
    tool: "report_caller_result",
  }, { token: forged.token, disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(refused.code, "wrong_receipt");
  assert.equal(refused.accepted, false);
  assert.equal(refused.charged, false);
  assert.equal(calls, 0);
});
