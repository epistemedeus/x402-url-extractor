// AE22 traffic->paid continuity: the opaque client token `x-samedaydesk-journey` becomes a keyed digest on the paid event.
// Same domain/format as the SDS J9-LOG discovery log (pilot codex/ae21-j9-log-handover@364e21d0 server/lib/discovery-log/log.js),
// so the apex discovery line and the gateway quote/mandate/capture rows join on equal journeyDigest. The raw token is never stored.
import crypto from "node:crypto";

export const JOURNEY_HEADER = "x-samedaydesk-journey";
export const JOURNEY_DOMAIN = "samedaydesk.journey-token.v1";
const TOKEN = /^[A-Za-z0-9._~-]{16,128}$/;

/** -> "hmac-sha256:<hex>" | null. null when the secret is unset or the token is missing/invalid (never guessed). */
export function journeyDigest(token, secret = process.env.DISCOVERY_LOG_JOURNEY_SECRET || "") {
  if (!secret || secret.length < 32 || typeof token !== "string" || !TOKEN.test(token)) return null;
  return "hmac-sha256:" + crypto.createHmac("sha256", secret).update(JOURNEY_DOMAIN + "\0" + token).digest("hex");
}

export function journeyDigestFromHeaders(headers, secret) {
  const raw = headers?.[JOURNEY_HEADER];
  return journeyDigest(Array.isArray(raw) ? undefined : raw, secret);
}

/** Carry one digest through quote -> mandate -> capture. A later stage with a different non-null digest is refused. */
export function carryJourney(prior, next) {
  if (prior == null) return next ?? null;
  if (next == null || next === prior) return prior;
  throw new Error("JOURNEY-DIGEST-CONFLICT");
}
