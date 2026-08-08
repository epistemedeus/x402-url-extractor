import assert from "node:assert/strict";
import test from "node:test";
import { createReferralResolver } from "./referral.mjs";

const OFFER_ID = "cd10af36-7e5b-460e-b74b-73c71fe3cf40";
const REFERRAL_URL = "https://www.agenthansa.com/r/signed-public-link";

test("caches a valid referral until its renewal window", async () => {
  let calls = 0;
  const now = Date.parse("2026-08-08T00:00:00Z");
  const resolveReferral = createReferralResolver({
    apiKey: "test-key",
    offerId: OFFER_ID,
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          referral_url: REFERRAL_URL,
          expires_at: "2026-09-07T00:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal((await resolveReferral()).url, REFERRAL_URL);
  assert.equal((await resolveReferral()).url, REFERRAL_URL);
  assert.equal(calls, 1);
});

test("refreshes a referral inside the renewal window", async () => {
  let calls = 0;
  let now = Date.parse("2026-08-08T00:00:00Z");
  const resolveReferral = createReferralResolver({
    apiKey: "test-key",
    offerId: OFFER_ID,
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          referral_url: `${REFERRAL_URL}-${calls}`,
          expires_at: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal((await resolveReferral()).url, `${REFERRAL_URL}-1`);
  now += 29 * 24 * 60 * 60 * 1000 + 1;
  assert.equal((await resolveReferral()).url, `${REFERRAL_URL}-2`);
  assert.equal(calls, 2);
});

test("rejects an unexpected redirect host", async () => {
  const resolveReferral = createReferralResolver({
    apiKey: "test-key",
    offerId: OFFER_ID,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          referral_url: "https://example.com/r/not-agent-hansa",
          expires_at: "2026-09-07T00:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  await assert.rejects(resolveReferral, /untrusted referral URL/);
});

test("keeps caches isolated across separate offer resolvers", async () => {
  const offerIds = [];
  const fetchImpl = async (url) => {
    const offerId = url.split("/api/offers/")[1].split("/ref")[0];
    offerIds.push(offerId);
    return new Response(
      JSON.stringify({
        referral_url: `${REFERRAL_URL}-${offerId}`,
        expires_at: "2026-09-07T00:00:00Z",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const topify = createReferralResolver({
    apiKey: "test-key",
    offerId: "topify",
    now: () => Date.parse("2026-08-08T00:00:00Z"),
    fetchImpl,
  });
  const manychat = createReferralResolver({
    apiKey: "test-key",
    offerId: "manychat",
    now: () => Date.parse("2026-08-08T00:00:00Z"),
    fetchImpl,
  });

  assert.equal((await topify()).url, `${REFERRAL_URL}-topify`);
  assert.equal((await manychat()).url, `${REFERRAL_URL}-manychat`);
  assert.equal((await topify()).url, `${REFERRAL_URL}-topify`);
  assert.deepEqual(offerIds, ["topify", "manychat"]);
});
