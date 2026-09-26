import { createServer } from "node:http";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";

import {
  loadEmptyAcceptsChallenge,
  loadSeededFailureChallenge,
} from "./throw.mjs";

export const FIXTURE_NETWORK = "eip155:8453";

export function emptyAcceptsChallenge({ url } = {}) {
  const challenge = loadEmptyAcceptsChallenge();
  if (url) challenge.resource = { ...challenge.resource, url };
  return challenge;
}

export function seededFailureChallenge({ url } = {}) {
  const challenge = loadSeededFailureChallenge();
  if (url) challenge.resource = { ...challenge.resource, url };
  return challenge;
}

export function hostileSettlementFrom(challenge = loadSeededFailureChallenge()) {
  return structuredClone(challenge.seededFailure.settlement);
}

function hasPaymentSignature(req) {
  return Boolean(
    req.headers["payment-signature"] ||
    req.headers["PAYMENT-SIGNATURE"] ||
    req.headers["x-payment"] ||
    req.headers["X-PAYMENT"],
  );
}

function write402(res, challenge, { settlement = null } = {}) {
  const headers = {
    "content-type": "application/json",
    "payment-required": encodePaymentRequiredHeader(challenge),
    "cache-control": "no-store",
  };
  if (settlement) {
    headers["payment-response"] = encodePaymentResponseHeader(settlement);
  }
  res.writeHead(402, headers);
  res.end(JSON.stringify(challenge));
}

/**
 * Loopback 402 fixture. Empty `accepts` on every path. A PAYMENT-SIGNATURE
 * never upgrades the response; there is no facilitator and no settle.
 */
export function startEmptyAcceptsServer() {
  const stats = {
    unpaid: 0,
    paidAttempts: 0,
    settleCalls: 0,
    responses: 0,
  };

  let origin = "http://127.0.0.1";

  const server = createServer((req, res) => {
    stats.responses += 1;
    const paid = hasPaymentSignature(req);
    if (paid) stats.paidAttempts += 1;
    else stats.unpaid += 1;

    const requestUrl = new URL(req.url || "/", origin);
    const resourceUrl = `${origin}${requestUrl.pathname}`;

    if (requestUrl.pathname === "/seeded-failure") {
      const challenge = seededFailureChallenge({ url: resourceUrl });
      write402(res, challenge, { settlement: hostileSettlementFrom(challenge) });
      return;
    }

    if (
      requestUrl.pathname === "/empty-accepts" ||
      requestUrl.pathname === "/"
    ) {
      write402(res, emptyAcceptsChallenge({ url: resourceUrl }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found", settled: false }));
  });

  const listen = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      origin = `http://127.0.0.1:${port}`;
      resolve({
        origin,
        url: `${origin}/empty-accepts`,
        seededUrl: `${origin}/seeded-failure`,
        stats,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });

  return listen;
}

export function createEmptyAcceptsFetch({
  challenge = emptyAcceptsChallenge(),
  settlement = null,
} = {}) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const hasPayment =
      request.headers.has("payment-signature") ||
      request.headers.has("PAYMENT-SIGNATURE") ||
      request.headers.has("x-payment") ||
      request.headers.has("X-PAYMENT");
    calls.push({
      url: request.url,
      method: request.method,
      hasPaymentSignature: hasPayment,
    });
    const headers = {
      "content-type": "application/json",
      "payment-required": encodePaymentRequiredHeader(challenge),
    };
    if (settlement) {
      headers["payment-response"] = encodePaymentResponseHeader(settlement);
    }
    return new Response(JSON.stringify(challenge), { status: 402, headers });
  };
  return { fetchImpl, calls, challenge };
}
