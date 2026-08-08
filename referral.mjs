const AGENTHANSA_ORIGIN = "https://www.agenthansa.com";
const DEFAULT_MIN_TTL_MS = 24 * 60 * 60 * 1000;

function parseReferral(body) {
  const referralUrl = body?.referral_url ?? body?.ref_url ?? body?.url;
  const expiresAt = Date.parse(body?.expires_at ?? "");

  if (!referralUrl || !Number.isFinite(expiresAt)) {
    throw new Error("Agent Hansa returned an incomplete referral response");
  }

  const parsed = new URL(referralUrl);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "www.agenthansa.com" ||
    !parsed.pathname.startsWith("/r/")
  ) {
    throw new Error("Agent Hansa returned an untrusted referral URL");
  }

  return { url: parsed.toString(), expiresAt };
}

export function createReferralResolver({
  apiKey,
  offerId,
  fetchImpl = fetch,
  now = Date.now,
  minTtlMs = DEFAULT_MIN_TTL_MS,
}) {
  let cached = null;

  return async function resolveReferral() {
    if (cached && cached.expiresAt - now() > minTtlMs) {
      return cached;
    }

    if (!apiKey || !offerId) {
      throw new Error("Referral service is not configured");
    }

    const response = await fetchImpl(
      `${AGENTHANSA_ORIGIN}/api/offers/${encodeURIComponent(offerId)}/ref`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Agent Hansa referral generation failed (${response.status})`);
    }

    cached = parseReferral(await response.json());
    return cached;
  };
}

