import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { declarePaymentIdentifierExtension } from "@x402/extensions/payment-identifier";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { LIVE_NETWORK, OUTCOMES } from "./constants.mjs";
import { normalizeAuthorization } from "./authorization.mjs";
import { runAuthorizedPurchase } from "./purchase.mjs";
import {
  canonicalSellerAuditUrl,
  normalizeSellerAuditInput,
  sellerAuditTerms,
} from "./seller-audit.mjs";

const BOUNDARY = Object.freeze({
  credentialsUsed: false,
  targetPaymentSigned: false,
  targetPaymentSent: false,
  targetRequestSent: false,
  redirectsFollowed: false,
  responseBodyRead: false,
  schemaRetained: false,
  queryValuesRetained: false,
});

function completeBody(query) {
  return {
    ok: true,
    product: "samedaydesk-seller-integrity-audit",
    version: "1.3.0",
    checkedAt: "2026-08-12T07:50:00.000Z",
    decision: "machine_buyable",
    request: {
      origin: query.origin,
      route: query.route,
      method: query.method,
      requiredPaths: [...query.requiredPaths],
      requireBazaar: query.requireBazaar,
      referral: query.referral,
    },
    report: {
      auditCompleted: true,
      failureCode: null,
      responseContract: { decision: "admissible", requiredPaths: [...query.requiredPaths] },
      repairPlan: { guaranteedPaths: [] },
    },
    nextActions: [],
    boundary: { ...BOUNDARY },
  };
}

/**
 * One local paid send through the official client. Generates an ephemeral key
 * and never reads the environment or a live facilitator.
 */
export async function runSellerAuditSelfCheck() {
  const query = normalizeSellerAuditInput({
    origin: "https://seller.example",
    route: "/extract",
    method: "GET",
  });
  const authorization = normalizeAuthorization(sellerAuditTerms(
    canonicalSellerAuditUrl("https://agents.samedaydesk.com", query),
  ));
  const challenge = {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: authorization.url,
      description: "Fixture seller-integrity audit",
      mimeType: "application/json",
    },
    accepts: [{
      scheme: "exact",
      network: authorization.network,
      amount: authorization.amountCapAtomic,
      asset: authorization.asset,
      payTo: authorization.recipient,
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    }],
    extensions: {
      "payment-identifier": declarePaymentIdentifierExtension(false),
    },
  };
  let paidSends = 0;
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const paid = request.headers.has("payment-signature") || request.headers.has("PAYMENT-SIGNATURE");
    if (!paid) {
      return new Response(JSON.stringify(challenge), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge),
        },
      });
    }
    paidSends += 1;
    return new Response(JSON.stringify(completeBody(query)), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "PAYMENT-RESPONSE": encodePaymentResponseHeader({
          success: true,
          transaction: `0x${"ab".repeat(32)}`,
          network: LIVE_NETWORK,
        }),
      },
    });
  };
  const account = privateKeyToAccount(generatePrivateKey());
  const result = await runAuthorizedPurchase({
    authorization,
    account,
    fetchImpl,
    approve: true,
  });
  return {
    ok: result.outcome === OUTCOMES.VALID_DELIVERED && paidSends === 1 && result.paymentSent === true,
    outcome: result.outcome,
    paidSends,
    walletAccessed: result.walletAccessed === true,
    paymentSigned: result.paymentSigned === true,
    paymentSent: result.paymentSent === true,
    liveNetwork: false,
    feedbackRequired: false,
    callerResultFeedbackAvailable: result.callerResultFeedback?.available === true,
  };
}
