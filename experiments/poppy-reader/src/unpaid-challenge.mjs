// Unpaid challenge for the hidden paid-read guard.
// Reuses @x402/express paymentMiddleware and the merchant price, recipient, and network.
// Payment headers are removed before the middleware so verify and settle are not called.
// Bazaar, builder code, and commerce-trust extensions stay on the merchant. They are not copied.

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
  paymentIdentifierResourceServerExtension,
} from "@x402/extensions/payment-identifier";
import {
  DEFAULT_NETWORK,
  DEFAULT_PAY_TO,
  DEFAULT_READ_PRICE,
  PAID_READ_GUARD_PATH,
  PAYMENT_HEADER_NAMES,
} from "./constants.mjs";

export function stripPaymentHeaders(req) {
  for (const name of PAYMENT_HEADER_NAMES) delete req.headers[name];
}

export function createUnpaidReadChallenge({
  origin,
  facilitatorUrl,
  payTo = DEFAULT_PAY_TO,
  network = DEFAULT_NETWORK,
  readPrice = DEFAULT_READ_PRICE,
} = {}) {
  if (typeof facilitatorUrl !== "string" || !facilitatorUrl.startsWith("http://127.0.0.1:")) {
    throw new Error("paid guard requires an injected local facilitator URL");
  }
  const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl }))
    .register(network, new ExactEvmScheme());
  resourceServer.registerExtension(paymentIdentifierResourceServerExtension);
  const middleware = paymentMiddleware({
    [`GET ${PAID_READ_GUARD_PATH}`]: {
      resource: `${origin}${PAID_READ_GUARD_PATH}`,
      accepts: [{ scheme: "exact", price: readPrice, network, payTo }],
      description: "Existing unpaid x402 challenge for a paid markdown read. A Poppy session does not settle this guard or return Markdown.",
      mimeType: "application/json",
      extensions: {
        [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(false),
      },
    },
  }, resourceServer);
  return { middleware, payTo, network, readPrice };
}
