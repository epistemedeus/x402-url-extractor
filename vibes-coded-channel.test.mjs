import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createVibesChannel } from "./vibes-coded-channel.mjs";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

const ticket = "header.payload.signature";
const body = { origin: "https://example.com", intent: "extract public website metadata", route: "/extract" };
const rawBody = Buffer.from(JSON.stringify(body));
const requestHash = createHash("sha256").update(rawBody).digest("hex");

test("rejects missing ticket before product or network use", async () => {
  let calls = 0;
  const channel = createVibesChannel({
    product: async () => { calls += 1; },
    fetchImpl: async () => { calls += 1; },
  });
  const result = await channel.execute({ body, rawBody });
  assert.equal(result.status, 401);
  assert.equal(result.body.charged, false);
  assert.equal(calls, 0);
});

test("settles a failed receipt when a paid ticket carries malformed input", async () => {
  let productCalls = 0;
  const calls = [];
  const channel = createVibesChannel({
    validateInput: () => { throw new Error("bad input"); },
    product: async () => { productCalls += 1; },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      if (String(url).endsWith("/verify-call-ticket")) {
        return json({ ok: true, endpoint_slug: "samedaydesk-discoverability-audit", amount_cents: 50, request_body_sha256: requestHash });
      }
      return json({ ok: true, status: "failed" });
    },
  });
  const result = await channel.execute({ ticket, body, rawBody });
  assert.equal(result.status, 400);
  assert.equal(result.body.channel.deliveryReceipt, "failed");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.status, "failed");
  assert.equal(productCalls, 0);
});

test("verifies request binding, delivers product, and confirms receipt", async () => {
  const calls = [];
  const channel = createVibesChannel({
    apiKey: "private-owner-key",
    validateInput: (value) => ({ ...value, normalized: true }),
    product: async (input) => ({ ok: true, product: "audit", input }),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init, body: JSON.parse(init.body) });
      if (String(url).endsWith("/verify-call-ticket")) {
        return json({ ok: true, valid: true, endpoint_slug: "samedaydesk-discoverability-audit", amount_cents: 50, request_body_sha256: requestHash, charge_id: "charge_test", status: "settled" });
      }
      return json({ ok: true, status: "delivered" });
    },
  });
  const result = await channel.execute({ ticket, body, rawBody });
  assert.equal(result.status, 200);
  assert.equal(result.body.channel.deliveryReceipt, "confirmed");
  assert.equal(result.body.channel.chargeId, "charge_test");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.call_ticket, ticket);
  assert.equal(calls[0].body.request_body_sha256, requestHash);
  assert.equal(calls[1].init.headers["X-API-Key"], "private-owner-key");
  assert.equal(calls[1].body.status, "delivered");
  assert.match(calls[1].body.response_sha256, /^[a-f0-9]{64}$/);
});

test("replays the same ticket and body without another network or product call", async () => {
  let networkCalls = 0;
  let productCalls = 0;
  const channel = createVibesChannel({
    product: async () => { productCalls += 1; return { ok: true }; },
    fetchImpl: async (url) => {
      networkCalls += 1;
      if (String(url).endsWith("/verify-call-ticket")) {
        return json({ ok: true, endpoint_slug: "samedaydesk-discoverability-audit", amount_cents: 50, request_body_sha256: requestHash });
      }
      return json({ ok: true, status: "delivered" });
    },
  });
  const first = await channel.execute({ ticket, body, rawBody });
  const second = await channel.execute({ ticket, body, rawBody });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.channel.replay, true);
  assert.equal(networkCalls, 2);
  assert.equal(productCalls, 1);
});

test("fails closed on wrong slug, amount, or body hash", async () => {
  for (const wrong of [
    { endpoint_slug: "other" },
    { amount_cents: 51 },
    { request_body_sha256: "0".repeat(64) },
  ]) {
    let productCalls = 0;
    const channel = createVibesChannel({
      product: async () => { productCalls += 1; },
      fetchImpl: async (url) => String(url).endsWith("/verify-call-ticket")
        ? json({ ok: true, endpoint_slug: "samedaydesk-discoverability-audit", amount_cents: 50, request_body_sha256: requestHash, ...wrong })
        : json({ ok: true, status: "failed" }),
    });
    const result = await channel.execute({ ticket, body, rawBody });
    assert.equal(result.status, 502);
    assert.equal(productCalls, 0);
  }
});
