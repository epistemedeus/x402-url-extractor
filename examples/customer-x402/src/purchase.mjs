import { ExactEvmScheme } from "@x402/evm";
import {
  PAYMENT_IDENTIFIER,
  appendPaymentIdentifierToExtensions,
} from "@x402/extensions/payment-identifier";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { OUTCOMES } from "./constants.mjs";
import {
  AttemptReceiptError,
  RECEIPT_STAGES,
  SETTLEMENT_STATES,
  buildAttemptReceipt,
  safeAttemptJson,
  unsignedIdentityFromPaymentPayload,
  updateAttemptReceipt,
  writeAttemptReceipt,
} from "./attempt-receipt.mjs";
import { AuthorizationRefusal, assertAcceptMatchesAuthorization, assertRequestMatchesAuthorization,
  normalizeAuthorization } from "./authorization.mjs";
import { assertPurchaseReady } from "./request-construction.mjs";
import { assertChallengeResource, decodeChallengeFromResponse, selectExactAccept } from "./challenge.mjs";
import { classifyPaidResponse } from "./outcome.mjs";
import { resolveBuyerAccount } from "./wallet.mjs";
import { redactValue, safeJson } from "./redact.mjs";
import { boundedFetch } from "./transport.mjs";

/** Official 2.16.0 client enrichment: echo seller payment-identifier with a generated id. */
export function paymentIdentifierClientExtension() {
  return {
    key: PAYMENT_IDENTIFIER,
    async enrichPaymentPayload(paymentPayload) {
      const extensions = paymentPayload.extensions
        ? structuredClone(paymentPayload.extensions)
        : {};
      appendPaymentIdentifierToExtensions(extensions);
      return { ...paymentPayload, extensions };
    },
  };
}

/** Compose the stock ExactEvmScheme client used by the example purchase path. */
export function createCustomerX402Client({ network, signer, authorizationFilter = null } = {}) {
  const client = new x402Client()
    .register(network, new ExactEvmScheme(signer))
    .registerExtension(paymentIdentifierClientExtension());
  if (authorizationFilter) client.registerPolicy(authorizationFilter);
  return client;
}

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

function preserveReceiptStage(attemptReceiptPath, stage, settlementState = SETTLEMENT_STATES.UNKNOWN) {
  if (!attemptReceiptPath) return;
  try {
    updateAttemptReceipt(attemptReceiptPath, { stage, settlementState });
  } catch {
    // Never erase identity on update failure; the durable pre-send receipt remains.
  }
}

/** One EIP-3009 signature and at most one paid send, using the official client. */
export async function runAuthorizedPurchase({ authorization, url, account = null, privateKey = null,
  loadAccount = null, fetchImpl = globalThis.fetch, approve = false, timeoutMs = 15_000,
  attemptReceiptPath = null } = {}) {
  const state = {
    walletAccessed: false,
    paymentSigned: false,
    paymentSent: false,
    attemptReceiptPath: attemptReceiptPath || null,
    attemptReceiptWritten: false,
  };
  let signStarted = false;
  let matched;
  let receiptPersisted = false;
  let receiptFailure = null;
  try {
    if (!approve) throw new AuthorizationRefusal("purchase requires explicit approve=true");
    const auth = normalizeAuthorization(authorization);
    assertPurchaseReady(auth.url, {
      method: auth.method,
      body: auth.method === "POST" ? auth.bodyRaw : null,
    });
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
    const client = createCustomerX402Client({
      network: matched.network,
      signer,
      authorizationFilter: (version, requirements) => version === 2 ? requirements.filter(entry => {
        try { assertAcceptMatchesAuthorization(entry, matched); return true; } catch { return false; }
      }) : [],
    });

    if (attemptReceiptPath) {
      client.onAfterPaymentCreation(async (ctx) => {
        try {
          const extracted = unsignedIdentityFromPaymentPayload(ctx.paymentPayload, {
            matchedAuthorization: matched,
          });
          if (!extracted.ok) {
            throw new AttemptReceiptError(
              extracted.message || "payment identity unsupported for attempt receipt",
              { code: extracted.reason || "unsupported_payload" },
            );
          }
          // Durable identity must exist before any paid network transmission.
          writeAttemptReceipt(attemptReceiptPath, buildAttemptReceipt({
            identity: extracted.identity,
            request: {
              method: matched.method,
              url: matched.url,
              bodyDigest: matched.bodyDigest,
            },
            stage: RECEIPT_STAGES.READY_BEFORE_SEND,
            settlementState: SETTLEMENT_STATES.UNKNOWN,
          }));
          receiptPersisted = true;
          state.attemptReceiptWritten = true;
        } catch (error) {
          receiptFailure = error instanceof AttemptReceiptError
            ? error
            : new AttemptReceiptError(
              error instanceof Error ? error.message : String(error),
              { code: "receipt_write_failed" },
            );
          throw receiptFailure;
        }
      });
    }

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
      if (attemptReceiptPath) {
        if (!receiptPersisted) {
          throw new AttemptReceiptError(
            "attempt receipt was not persisted before paid send",
            { code: "receipt_missing_before_send" },
          );
        }
        // Stage update before transport; identity remains if this update fails.
        try {
          updateAttemptReceipt(attemptReceiptPath, {
            stage: RECEIPT_STAGES.PAID_SEND_DISPATCHED,
            settlementState: SETTLEMENT_STATES.UNKNOWN,
          });
        } catch (error) {
          throw new AttemptReceiptError(
            `attempt receipt stage update failed before paid send: ${error instanceof Error ? error.message : String(error)}`,
            { code: "receipt_write_failed" },
          );
        }
      }
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
    if (receiptPersisted) {
      preserveReceiptStage(
        attemptReceiptPath,
        RECEIPT_STAGES.PAID_RESPONSE_OBSERVED,
        SETTLEMENT_STATES.OBSERVED_HTTP,
      );
    }
    return {
      ...classified,
      ...state,
      matched: redactValue(matched),
      boundary: attemptReceiptPath
        ? "One in-process attempt with optional customer-owned unsigned attempt receipt. No durable budget, automatic paid replay, or implied retry from chain usage."
        : "One in-process attempt only. Without --attempt-receipt, unsigned EIP-3009 nonce/validBefore are not retained for reconciliation. No durable budget, chain settlement verification, or automatic paid replay.",
    };
  } catch (error) {
    if (receiptPersisted) {
      preserveReceiptStage(
        attemptReceiptPath,
        state.paymentSent ? RECEIPT_STAGES.PAID_SEND_DISPATCHED : RECEIPT_STAGES.FAILED_AFTER_IDENTITY,
        SETTLEMENT_STATES.UNKNOWN,
      );
    }
    const receiptError = receiptFailure || (error instanceof AttemptReceiptError ? error : null) ||
      (error instanceof Error && /attempt receipt|receipt_write_failed|persist attempt receipt|receipt_missing_before_send/i.test(error.message)
        ? new AttemptReceiptError(error.message, { code: "receipt_write_failed" })
        : null);
    if (receiptError && !state.paymentSent) {
      return {
        outcome: OUTCOMES.UNKNOWN,
        message: `attempt receipt failed before paid send: ${receiptError.message}`,
        ...state,
        paymentSigned: signStarted && !state.paymentSigned ? null : state.paymentSigned,
        field: receiptError.field,
        evidence: {
          settlementVerification: "absent",
          failureStage: "attempt_receipt",
          receiptCode: receiptError.code,
          bodyDigest: matched?.bodyDigest ?? null,
        },
      };
    }
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
export function printAttemptArtifact(value) { console.log(safeAttemptJson(value)); }
