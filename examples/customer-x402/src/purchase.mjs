import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { OUTCOMES } from "./constants.mjs";
import { AuthorizationRefusal, assertAcceptMatchesAuthorization, assertRequestMatchesAuthorization,
  normalizeAuthorization } from "./authorization.mjs";
import { assertChallengeResource, decodeChallengeFromResponse, selectExactAccept } from "./challenge.mjs";
import { classifyPaidResponse } from "./outcome.mjs";
import { resolveBuyerAccount } from "./wallet.mjs";
import { redactValue, safeJson } from "./redact.mjs";
import { boundedFetch } from "./transport.mjs";

function requestInitFor(auth) {
  if (auth.method === "POST") {
    return {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: auth.bodyRaw,
    };
  }
  return {
    method: "GET",
    redirect: "error",
    headers: { accept: "application/json" },
  };
}

/** One EIP-3009 signature and at most one paid send, using the official client. */
export async function runAuthorizedPurchase({ authorization, url, account = null, privateKey = null,
  loadAccount = null, fetchImpl = globalThis.fetch, approve = false, timeoutMs = 15_000 } = {}) {
  const state = { walletAccessed: false, paymentSigned: false, paymentSent: false };
  let signStarted = false;
  let matched;
  try {
    if (!approve) throw new AuthorizationRefusal("purchase requires explicit approve=true");
    const auth = normalizeAuthorization(authorization);
    assertRequestMatchesAuthorization(url ?? auth.url, auth, {
      method: auth.method,
      body: auth.method === "POST" ? auth.bodyRaw : null,
    });
    const unpaidInit = requestInitFor(auth);
    const unpaid = await boundedFetch(fetchImpl, auth.url, unpaidInit, 64_000, timeoutMs);
    if (unpaid.status !== 402) return {
      outcome: OUTCOMES.UNKNOWN, message: "expected unpaid HTTP 402 before purchase",
      ...state, evidence: { httpStatus: unpaid.status, bodyDigest: auth.bodyDigest },
    };
    const challenge = decodeChallengeFromResponse(unpaid, await unpaid.clone().text());
    assertChallengeResource(challenge, auth);
    let accept;
    try { accept = selectExactAccept(challenge, { network: auth.network }); }
    catch { accept = selectExactAccept(challenge); }
    matched = assertAcceptMatchesAuthorization(accept, auth);

    // This callback is the CLI's first credential read, after the full binding.
    state.walletAccessed = true;
    const buyer = loadAccount ? await loadAccount() : resolveBuyerAccount({ account, privateKey });
    const signer = {
      address: buyer.address,
      async signTypedData(value) {
        if (signStarted) throw new Error("second_signature_refused");
        signStarted = true;
        const signature = await buyer.signTypedData(value);
        state.paymentSigned = true;
        return signature;
      },
    };
    const client = new x402Client().register(matched.network, new ExactEvmScheme(signer))
      .registerPolicy((version, requirements) => version === 2 ? requirements.filter(entry => {
        try { assertAcceptMatchesAuthorization(entry, matched); return true; } catch { return false; }
      }) : []);

    // Supply the inspected challenge to the official wrapper. No second unpaid
    // discovery, recovery hook, alternative scheme, or RPC helper.
    let challengeSupplied = false;
    const transport = async (input, init) => {
      const request = input instanceof Request && init == null ? input : new Request(input, init);
      const bodyText = auth.method === "POST"
        ? await request.clone().text()
        : null;
      assertRequestMatchesAuthorization(request.url, auth, {
        method: request.method,
        body: auth.method === "POST" ? bodyText : request.body ? await request.clone().text() : null,
      });
      const paid = request.headers.has("payment-signature") || request.headers.has("PAYMENT-SIGNATURE");
      if (!challengeSupplied && !paid) { challengeSupplied = true; return unpaid; }
      if (!paid || !state.paymentSigned || state.paymentSent) throw new Error("unexpected_or_repeated_send");
      // Mark before transport: a rejection/timeout cannot prove nothing was sent.
      state.paymentSent = true;
      return boundedFetch(fetchImpl, request, {}, auth.requiredOutput.maxResponseBytes, timeoutMs);
    };
    const response = await wrapFetchWithPayment(transport, client)(auth.url, unpaidInit);
    let body = null;
    let bodyError = null;
    try { body = JSON.parse(await response.text()); }
    catch { bodyError = "response body is not JSON"; }
    const classified = classifyPaidResponse({ response, body, bodyError,
      requiredOutput: matched.requiredOutput, authorization: matched });
    return { ...classified, ...state, matched: redactValue(matched),
      boundary: "One in-process attempt only. No durable budget, chain settlement verification, or automatic paid replay." };
  } catch (error) {
    if (state.paymentSent && error.response && matched) {
      return { ...classifyPaidResponse({ response: error.response, body: null,
        bodyError: "response exceeds authorized byte limit", requiredOutput: matched.requiredOutput,
        authorization: matched }), ...state };
    }
    const refused = error instanceof AuthorizationRefusal && !signStarted && !state.paymentSent;
    return { outcome: refused ? OUTCOMES.AUTHORIZATION_REFUSED : OUTCOMES.UNKNOWN,
      message: refused ? error.message : "request/signing/response outcome unavailable; do not automatically retry",
      ...state, paymentSigned: signStarted && !state.paymentSigned ? null : state.paymentSigned,
      field: refused ? error.field : null,
      evidence: { settlementVerification: state.paymentSent ? "unknown" : "absent",
        failureStage: state.paymentSent ? "paid_transport_or_body" : signStarted ? "signing" : "pre_payment",
        bodyDigest: matched?.bodyDigest ?? null },
    };
  }
}

export function printPurchase(result) { console.log(safeJson(result)); }
