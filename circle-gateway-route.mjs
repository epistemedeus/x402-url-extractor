import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
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

export function buildCircleGatewayRoute({
  sellerAddress,
  price = "$0.005",
  enabled = true,
  facilitatorUrl = CIRCLE_GATEWAY_FACILITATOR,
  description = "Compare x402 and MPP payment offers before buyer authorization.",
  middlewareFactory = createGatewayMiddleware,
} = {}) {
  const seller = normalizeSellerAddress(sellerAddress);
  const normalizedPrice = normalizePrice(price);
  const base = CHAIN_CONFIGS.base;
  const resource = {
    urlPath: CIRCLE_GATEWAY_PATH,
    amount: normalizedPrice.atomic,
    description,
    mimeType: "application/json",
    accepts: [{
      scheme: "exact",
      network: `eip155:${base.chain.id}`,
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
  };

  if (!enabled) return { enabled: false, middleware: null, resource, facilitatorUrl };
  if (typeof middlewareFactory !== "function") throw new Error("Circle Gateway middleware factory is required");
  const gateway = middlewareFactory({
    sellerAddress: seller,
    facilitatorUrl,
    description,
  });
  if (!gateway || typeof gateway.require !== "function") {
    throw new Error("Circle Gateway middleware factory returned an invalid gateway");
  }
  return {
    enabled: true,
    middleware: gateway.require(normalizedPrice.display),
    resource,
    facilitatorUrl,
  };
}

