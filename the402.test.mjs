import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  fulfillThe402Job,
  validateThe402CallbackUrl,
  verifyThe402Webhook,
} from "./the402.mjs";

test("verifies a current, correctly signed webhook", () => {
  const apiKey = "sk_test";
  const webhookSecret = "whsec_test";
  const timestamp = "1786200000";
  const rawBody = Buffer.from('{"type":"job_dispatch"}');
  const signature = `sha256=${crypto
    .createHmac("sha256", webhookSecret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex")}`;
  assert.deepEqual(
    verifyThe402Webhook({
      apiKey,
      webhookSecret,
      rawBody,
      nowMs: Number(timestamp) * 1000,
      headers: {
        "x-platform-secret": apiKey,
        "x-webhook-timestamp": timestamp,
        "x-webhook-signature": signature,
      },
    }),
    { ok: true, status: 200 }
  );
});

test("rejects replayed and incorrectly signed webhooks", () => {
  const base = {
    apiKey: "sk_test",
    webhookSecret: "whsec_test",
    rawBody: Buffer.from("{}"),
    nowMs: 1_786_200_000_000,
  };
  assert.equal(
    verifyThe402Webhook({
      ...base,
      headers: {
        "x-platform-secret": "sk_test",
        "x-webhook-timestamp": "1786199000",
        "x-webhook-signature": "sha256=bad",
      },
    }).error,
    "stale_timestamp"
  );
  assert.equal(
    verifyThe402Webhook({
      ...base,
      headers: {
        "x-platform-secret": "sk_test",
        "x-webhook-timestamp": "1786200000",
        "x-webhook-signature": "sha256=bad",
      },
    }).error,
    "invalid_signature"
  );
});

test("only accepts callback URLs on the official API origin", () => {
  assert.equal(
    validateThe402CallbackUrl("https://api.the402.ai/v1/threads/thread_1/update"),
    "https://api.the402.ai/v1/threads/thread_1/update"
  );
  assert.equal(validateThe402CallbackUrl("https://attacker.example/v1/jobs/1/update"), null);
  assert.equal(validateThe402CallbackUrl("https://api.the402.ai.evil.test/v1/jobs/1/update"), null);
});

test("fulfills a valid audit job and posts structured deliverables", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200 };
  };
  const result = await fulfillThe402Job(
    {
      type: "job_dispatch",
      job_id: "job_1",
      service_id: "svc_1",
      brief: { domain: "example.com", vertical: "software" },
      callback_url: "https://api.the402.ai/v1/threads/thread_1/update",
    },
    {
      apiKey: "sk_test",
      serviceId: "svc_1",
      fetchImpl,
      deepAudit: async (domain) => ({ ok: true, domain, score: 88 }),
    }
  );
  assert.deepEqual(result, { completed: true, domain: "example.com" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.status, "in_progress");
  assert.equal(calls[1].body.status, "completed");
  assert.equal(calls[1].body.deliverables.audit.score, 88);
});
