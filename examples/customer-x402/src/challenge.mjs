import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { AuthorizationRefusal, assertRequestMatchesAuthorization } from "./authorization.mjs";

export function assertChallengeResource(challenge, authorization) {
  if (challenge?.x402Version !== 2) throw new AuthorizationRefusal("only x402 v2 is supported");
  // Resource URL binding only; POST body bytes are checked on the actual request.
  assertRequestMatchesAuthorization(challenge.resource?.url, authorization, {
    method: authorization.method,
  });
}

export function fail(message, code = "challenge_error") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function decodeChallengeFromResponse(response, bodyText = null) {
  const header = response.headers.get("payment-required") || response.headers.get("PAYMENT-REQUIRED");
  if (header) {
    try {
      return decodePaymentRequiredHeader(header);
    } catch (error) {
      fail(`payment-required header is malformed: ${error.message}`, "malformed_challenge");
    }
  }
  if (bodyText) {
    try {
      const body = JSON.parse(bodyText);
      if (body?.x402Version && Array.isArray(body.accepts)) return body;
    } catch {
      /* fall through */
    }
  }
  fail("response is missing a parseable x402 payment-required challenge", "malformed_challenge");
}

export function decodeSettlementHeader(response) {
  const header =
    response.headers.get("payment-response") ||
    response.headers.get("PAYMENT-RESPONSE") ||
    response.headers.get("x-payment-response") ||
    response.headers.get("X-PAYMENT-RESPONSE");
  if (!header) return { present: false, decoded: null, raw: null };
  try {
    return {
      present: true,
      decoded: decodePaymentResponseHeader(header),
      raw: header,
    };
  } catch (error) {
    return {
      present: true,
      decoded: null,
      raw: header,
      parseError: error.message,
    };
  }
}

export function selectExactAccept(challenge, { network } = {}) {
  const accepts = Array.isArray(challenge?.accepts) ? challenge.accepts : [];
  const exact = accepts.filter((entry) => entry?.scheme === "exact");
  if (!exact.length) fail("challenge has no exact accept option", "no_compatible_accept");
  if (network) {
    const matched = exact.filter((entry) => entry.network === network);
    if (!matched.length) fail(`challenge has no exact accept on ${network}`, "no_compatible_accept");
    return matched[0];
  }
  return exact[0];
}
