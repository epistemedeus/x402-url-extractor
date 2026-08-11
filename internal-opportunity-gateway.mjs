import { timingSafeEqual } from "node:crypto";

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : "";
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export function internalGatewayAuthorized(headers, expectedToken) {
  const expected = String(expectedToken || "");
  if (expected.length < 32) return false;
  const supplied = headerValue(headers, "x-samedaydesk-internal");
  const left = Buffer.from(supplied, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createInternalOpportunityPreflightHandler({
  token,
  getPlatformHealthCard,
  opportunityPreflight,
}) {
  if (typeof getPlatformHealthCard !== "function") throw new TypeError("getPlatformHealthCard is required");
  if (typeof opportunityPreflight !== "function") throw new TypeError("opportunityPreflight is required");

  return async function internalOpportunityPreflight(req, res, next) {
    if (!internalGatewayAuthorized(req.headers, token)) return next();

    try {
      const platform = typeof req.query.platform === "string"
        ? req.query.platform.trim().toLowerCase()
        : null;
      const platformCard = platform ? getPlatformHealthCard(platform) : null;
      const result = opportunityPreflight(req.query, { platformCard });
      res.set("Cache-Control", "no-store");
      res.set("X-Robots-Tag", "noindex, nofollow");
      return res.json({
        ...result,
        delivery: {
          transport: "pay-solana-gateway",
          upstreamAuthenticated: true,
          paymentEvidenceBoundary:
            "The external gateway owns payment verification and settlement. This response proves authenticated internal delivery only.",
        },
      });
    } catch (error) {
      return res.status(503).json({
        ok: false,
        error: String(error?.message || error),
        boundary: "No source-platform account, claim, bid, payment, or submission was touched.",
      });
    }
  };
}

export function createInternalPaymentOfferPreflightHandler({
  token,
  paymentOfferPreflight,
}) {
  if (typeof paymentOfferPreflight !== "function") throw new TypeError("paymentOfferPreflight is required");

  return async function internalPaymentOfferPreflight(req, res, next) {
    if (!internalGatewayAuthorized(req.headers, token)) return next();

    try {
      const result = await paymentOfferPreflight({ url: req.query.url });
      res.set("Cache-Control", "no-store");
      res.set("X-Robots-Tag", "noindex, nofollow");
      return res.json({
        ...result,
        delivery: {
          transport: "pay-solana-gateway",
          upstreamAuthenticated: true,
          paymentEvidenceBoundary:
            "The external gateway owns payment verification and settlement. This response proves authenticated internal delivery only.",
        },
      });
    } catch (error) {
      const status = Math.max(400, Math.min(599, Number(error?.statusCode) || 503));
      return res.status(status).json({
        ok: false,
        product: "samedaydesk-payment-offer-preflight",
        code: error?.code || "preflight_failed",
        error: String(error?.message || error),
        boundary: {
          targetCredentialsUsed: false,
          targetPaymentSigned: false,
          targetPaymentSent: false,
          targetResponseBodyRead: false,
          targetRedirectsFollowed: false,
          gatewayPayment:
            "The Solana gateway owns any buyer payment evidence; this internal service does not verify or restate it.",
        },
      });
    }
  };
}
