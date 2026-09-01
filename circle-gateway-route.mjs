import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { sanitizeResourceServiceMetadata } from "@x402/extensions";
import {
  CHAIN_CONFIGS,
  GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
} from "@circle-fin/x402-batching/client";

export const CIRCLE_GATEWAY_FACILITATOR = "https://gateway-api.circle.com";
export const CIRCLE_GATEWAY_PATH = "/gateway/commerce/payment-offer-preflight";
export const CIRCLE_GATEWAY_NAME = "GatewayWalletBatched";
export const CIRCLE_GATEWAY_VERSION = "1";

function normalizePrice(price) {
  const match = /^\$(\d+)(?:\.(\d{1,6}))?$/.exec(String(price || ""));
  if (!match) throw new Error("Circle Gateway price must be a positive USD amount with at most six decimals");
  const amount = BigInt(match[1]) * 1_000_000n
    + BigInt((match[2] || "").padEnd(6, "0") || "0");
  if (amount <= 0n) throw new Error("Circle Gateway price must be positive");
  return { display: String(price), atomic: amount.toString() };
}

function normalizeSellerAddress(value) {
  const address = String(value || "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error("Circle Gateway sellerAddress must be a 20-byte EVM address");
  }
  return address;
}

function normalizeResourceMetadata(value = {}) {
  const normalized = sanitizeResourceServiceMetadata(value);
  for (const field of ["serviceName", "tags", "iconUrl"]) {
    if (value[field] !== undefined && JSON.stringify(normalized[field]) !== JSON.stringify(value[field])) {
      throw new Error(`Circle Gateway ${field} is invalid`);
    }
  }
  return normalized;
}

function withPaymentRequiredPayloadPatch(middleware, { resourceMetadata = {}, extensions = {} } = {}) {
  if (Object.keys(resourceMetadata).length === 0 && Object.keys(extensions).length === 0) return middleware;
  return function paymentRequiredPayloadPatch(req, res, next) {
    const setHeader = res.setHeader;
    res.setHeader = function setHeaderWithPayloadPatch(name, value) {
      if (String(name).toLowerCase() === "payment-required") {
        if (typeof value !== "string") throw new Error("Circle Gateway PAYMENT-REQUIRED header is invalid");
        const payload = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
        if (payload?.x402Version !== 2 || !payload.resource || typeof payload.resource !== "object") {
          throw new Error("Circle Gateway PAYMENT-REQUIRED payload is invalid");
        }
        value = Buffer.from(JSON.stringify({
          ...payload,
          resource: { ...payload.resource, ...resourceMetadata },
          ...(Object.keys(extensions).length > 0 ? {
            extensions: { ...(payload.extensions || {}), ...extensions },
          } : {}),
        })).toString("base64");
      }
      return setHeader.call(this, name, value);
    };
    return middleware(req, res, next);
  };
}

export function buildCircleGatewayRoute({
  sellerAddress,
  price = "$0.005",
  enabled = true,
  facilitatorUrl = CIRCLE_GATEWAY_FACILITATOR,
  description = "Compare x402 and MPP payment offers before buyer authorization.",
  resourceMetadata = {},
  extensions = {},
  middlewareFactory = createGatewayMiddleware,
} = {}) {
  const seller = normalizeSellerAddress(sellerAddress);
  const normalizedPrice = normalizePrice(price);
  const base = CHAIN_CONFIGS.base;
  const network = `eip155:${base.chain.id}`;
  const normalizedResourceMetadata = normalizeResourceMetadata(resourceMetadata);
  const resource = {
    urlPath: CIRCLE_GATEWAY_PATH,
    amount: normalizedPrice.atomic,
    description,
    mimeType: "application/json",
    accepts: [{
      scheme: "exact",
      network,
      asset: base.usdc,
      amount: normalizedPrice.atomic,
      payTo: seller,
      maxTimeoutSeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
      extra: {
        name: CIRCLE_GATEWAY_NAME,
        version: CIRCLE_GATEWAY_VERSION,
        verifyingContract: base.gatewayWallet,
      },
    }],
    ...normalizedResourceMetadata,
  };

  if (!enabled) return { enabled: false, middleware: null, resource, facilitatorUrl };
  if (typeof middlewareFactory !== "function") throw new Error("Circle Gateway middleware factory is required");
  const gateway = middlewareFactory({
    sellerAddress: seller,
    networks: [network],
    facilitatorUrl,
    description,
  });
  if (!gateway || typeof gateway.require !== "function") {
    throw new Error("Circle Gateway middleware factory returned an invalid gateway");
  }
  return {
    enabled: true,
    middleware: withPaymentRequiredPayloadPatch(
      gateway.require(normalizedPrice.display),
      { resourceMetadata: normalizedResourceMetadata, extensions },
    ),
    resource,
    facilitatorUrl,
  };
}
