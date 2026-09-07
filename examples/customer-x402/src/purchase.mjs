import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";

import { OUTCOMES } from "./constants.mjs";
import {
  AuthorizationRefusal,
  assertAcceptMatchesAuthorization,
  assertRequestMatchesAuthorization,
  normalizeAuthorization,
} from "./authorization.mjs";
import { decodeChallengeFromResponse, selectExactAccept } from "./challenge.mjs";
import { classifyPaidResponse } from "./outcome.mjs";
import { resolveBuyerAccount } from "./wallet.mjs";
import { redactValue, safeJson } from "./redact.mjs";

/**
 * Explicitly authorized purchase through the maintained @x402/fetch client.
 * Authorization is checked against the unpaid challenge before any signer runs.
 * No application retry, timeout retry, or fallback provider payment.
 */
export async function runAuthorizedPurchase({
  authorization,
  account = null,
  privateKey = null,
  fetchImpl = globalThis.fetch,
  approve = false,
} = {}) {
  if (!approve) {
    throw new Error("purchase requires explicit approve=true; default commands never pay");
  }

  const auth = normalizeAuthorization(authorization);
  assertRequestMatchesAuthorization(auth.url, auth, { method: auth.method, body: null });

  // Unpaid challenge first, still without wallet access.
  const unpaid = await fetchImpl(auth.url, {
    method: auth.method,
    redirect: "error",
    headers: { accept: "application/json" },
  });
  const unpaidText = await unpaid.text();
  if (unpaid.status !== 402) {
    return {
      outcome: OUTCOMES.UNKNOWN,
      message: `expected unpaid HTTP 402 before purchase, received ${unpaid.status}`,
      walletAccessed: false,
      paymentSigned: false,
      paymentSent: false,
      evidence: { httpStatus: unpaid.status, bodyPreviewBytes: Buffer.byteLength(unpaidText) },
    };
  }

  let challenge;
  let matched;
  try {
    challenge = decodeChallengeFromResponse(unpaid, unpaidText);
    // Prefer an accept on the authorized network; otherwise take any exact
    // option and let assertAcceptMatchesAuthorization refuse the mismatch.
    let accept;
    try {
      accept = selectExactAccept(challenge, { network: auth.network });
    } catch (error) {
      if (error.code === "no_compatible_accept") accept = selectExactAccept(challenge);
      else throw error;
    }
    matched = assertAcceptMatchesAuthorization(accept, auth);
  } catch (error) {
    if (error instanceof AuthorizationRefusal || error.code === "authorization_refused") {
      return {
        outcome: OUTCOMES.AUTHORIZATION_REFUSED,
        message: error.message,
        field: error.field ?? null,
        walletAccessed: false,
        paymentSigned: false,
        paymentSent: false,
      };
    }
    throw error;
  }

  // Wallet / signer only after exact accept binding succeeds.
  const buyer = resolveBuyerAccount({ account, privateKey });
  const client = new x402Client()
    .register(matched.network, new ExactEvmScheme(buyer))
    .registerPolicy((_version, requirements) =>
      requirements.filter((entry) => {
        try {
          assertAcceptMatchesAuthorization(entry, matched);
          return true;
        } catch {
          return false;
        }
      }),
    );

  // Do not register recovery hooks: recovered:true would trigger another pay attempt.
  const paidFetch = wrapFetchWithPayment(fetchImpl, client);
  const response = await paidFetch(auth.url, {
    method: auth.method,
    redirect: "error",
    headers: { accept: "application/json" },
  });

  let body = null;
  let parseError = null;
  const text = await response.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    parseError = error.message;
    body = null;
  }

  if (parseError) {
    return {
      outcome: OUTCOMES.PAID_INVALID_OUTPUT,
      message: `paid response body is not JSON: ${parseError}`,
      walletAccessed: true,
      paymentSigned: true,
      paymentSent: true,
      evidence: {
        httpStatus: response.status,
        retainedBodyTextBytes: Buffer.byteLength(text),
        settlementVerification: "unverified",
      },
      buyerAddress: buyer.address,
      matched,
    };
  }

  const classified = classifyPaidResponse({
    response,
    body,
    requiredOutput: matched.requiredOutput,
    authorization: matched,
  });

  return {
    ...classified,
    walletAccessed: true,
    paymentSigned: true,
    paymentSent: true,
    buyerAddress: buyer.address,
    matched: redactValue(matched),
    boundary:
      "Transparent bounded @x402/fetch integration example. Not crash-safe cross-process accounting, not durable wallet enforcement, and not a replacement for a private durable-state buyer.",
  };
}

export function printPurchase(result) {
  console.log(safeJson(result));
}
