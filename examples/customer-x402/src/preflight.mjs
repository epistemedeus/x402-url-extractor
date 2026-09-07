import { OUTCOMES } from "./constants.mjs";
import { decodeChallengeFromResponse, selectExactAccept } from "./challenge.mjs";
import { assertAcceptMatchesAuthorization, assertRequestMatchesAuthorization } from "./authorization.mjs";
import { safeJson } from "./redact.mjs";

/**
 * Credential-free unpaid preflight. Never looks up wallet keys, signs, or
 * sends payment headers.
 */
export async function runPreflight({
  url,
  authorization = null,
  fetchImpl = globalThis.fetch,
  method = "GET",
} = {}) {
  if (!url) throw new Error("preflight url is required");
  if (String(url).startsWith("mcp://")) {
    throw new Error("preflight refuses mcp:// resources; use HTTPS extract only");
  }

  let bound = null;
  if (authorization) {
    bound = assertRequestMatchesAuthorization(url, authorization, { method, body: null });
  }

  const response = await fetchImpl(url, {
    method,
    redirect: "error",
    headers: { accept: "application/json" },
  });

  const bodyText = await response.text();
  if (response.status !== 402) {
    return {
      outcome: OUTCOMES.UNKNOWN,
      httpStatus: response.status,
      message: `expected HTTP 402 unpaid challenge, received ${response.status}`,
      bodyPreviewBytes: Buffer.byteLength(bodyText),
      walletAccessed: false,
      paymentSigned: false,
      paymentSent: false,
    };
  }

  const challenge = decodeChallengeFromResponse(response, bodyText);
  const accept = selectExactAccept(challenge, { network: bound?.network });
  let matched = null;
  if (bound) {
    matched = assertAcceptMatchesAuthorization(accept, bound);
  }

  return {
    outcome: OUTCOMES.PREFLIGHT_OK,
    httpStatus: 402,
    method,
    url,
    offer: {
      scheme: accept.scheme,
      network: accept.network,
      asset: accept.asset,
      recipient: accept.payTo,
      amountAtomic: String(accept.amount ?? accept.maxAmountRequired),
      maxTimeoutSeconds: accept.maxTimeoutSeconds ?? null,
    },
    resourceUrl: challenge.resource?.url ?? null,
    matchedAuthorization: matched,
    walletAccessed: false,
    paymentSigned: false,
    paymentSent: false,
    boundary:
      "Unpaid preflight only. This result is not authorization to spend and does not move funds.",
  };
}

export function printPreflight(result) {
  console.log(safeJson(result));
}
