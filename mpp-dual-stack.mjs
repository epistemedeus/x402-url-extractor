import { Credential } from "mppx";
import { evm, Mppx } from "mppx/server";

const X402_PAYMENT_HEADERS = ["payment-signature", "x-payment", "x-payment-signature"];
const SUPPORTED_ASSETS = new Map([
  ["eip155:8453", evm.assets.base.USDC],
  ["eip155:84532", evm.assets.baseSepolia.USDC],
]);

function headerValue(headers, name) {
  if (headers instanceof Headers) return headers.get(name) || "";
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value.join(",") : String(value || "");
}

function toHeaders(headers) {
  const result = new Headers();
  if (headers instanceof Headers) return new Headers(headers);
  for (const [name, value] of Object.entries(headers || {})) {
    if (value == null) continue;
    result.set(name, Array.isArray(value) ? value.join(",") : String(value));
  }
  return result;
}

function hasX402Credential(headers) {
  return X402_PAYMENT_HEADERS.some((name) => Boolean(headerValue(headers, name)));
}

function paymentAuthorization(headers) {
  return Credential.extractPaymentScheme(headerValue(headers, "authorization"));
}

export function hasMppPaymentAuthorizationForPreflight(headers) {
  return Boolean(paymentAuthorization(headers));
}

function normalizeAmount(value) {
  const amount = String(value || "").trim().replace(/^\$/, "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error(`Invalid MPP display-unit amount: ${value}`);
  }
  return amount;
}

function normalizeRoutes(routes) {
  const normalized = new Map();
  for (const route of routes || []) {
    const method = String(route?.method || "GET").toUpperCase();
    const path = String(route?.path || "");
    if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
      throw new Error(`Invalid MPP route path: ${path}`);
    }
    const key = `${method} ${path}`;
    if (normalized.has(key)) throw new Error(`Duplicate MPP route: ${key}`);
    normalized.set(key, Object.freeze({
      amount: normalizeAmount(route.amount),
      description: String(route.description || "Paid machine capability"),
      key,
      method,
      path,
    }));
  }
  return normalized;
}

function canonicalPublicRequest(input, publicUrl) {
  const source = input instanceof Request ? input : null;
  const rawUrl = source?.url || input?.url || input?.originalUrl || input?.path || "/";
  const url = new URL(rawUrl, publicUrl);
  const base = new URL(publicUrl);
  url.protocol = base.protocol;
  url.host = base.host;
  url.hash = "";
  url.searchParams.sort();
  const method = String(source?.method || input?.method || "GET").toUpperCase();
  const headers = toHeaders(source?.headers || input?.headers);
  return new Request(url, { method, headers });
}

function routeScope(request) {
  const url = new URL(request.url);
  return `${request.method.toUpperCase()} ${url.pathname}${url.search}`;
}

function routeKey(request) {
  const url = new URL(request.url);
  return `${request.method.toUpperCase()} ${url.pathname}`;
}

function copyHeaders(response, res, allow = null) {
  for (const [name, value] of response.headers) {
    if (allow && !allow.has(name.toLowerCase())) continue;
    res.setHeader(name, value);
  }
}

/**
 * Adds native MPP Payment-auth to existing x402-protected GET routes without
 * replacing the existing x402 middleware. Initial requests receive an MPP
 * challenge here, then continue into the extension-rich x402 paywall. Native
 * MPP credentials settle here and bypass only the duplicate x402 gate.
 */
export function createMppDualStack({
  facilitatorClient,
  network,
  payTo,
  publicUrl,
  realm = new URL(publicUrl).hostname,
  routes,
  secretKey,
  logger = console,
} = {}) {
  const routeMap = normalizeRoutes(routes);
  const asset = SUPPORTED_ASSETS.get(network);
  if (!secretKey) {
    return {
      enabled: false,
      reason: "MPP_SECRET_KEY is not configured",
      realm,
      routeCount: routeMap.size,
      middleware(_req, _res, next) {
        return next();
      },
      async authorize(input) {
        return { kind: "disabled" };
      },
    };
  }
  if (!asset) throw new Error(`MPP EVM charge is not configured for network ${network}`);
  if (!facilitatorClient?.verify || !facilitatorClient?.settle) {
    throw new Error("MPP dual-stack requires an x402 facilitator client");
  }

  const mppx = Mppx.create({
    methods: [
      evm({
        currency: asset,
        recipient: payTo,
        x402: { facilitator: facilitatorClient },
      }),
    ],
    realm,
    secretKey,
  });

  async function authorize(input) {
    const request = canonicalPublicRequest(input, publicUrl);
    const route = routeMap.get(routeKey(request));
    if (!route) return { kind: "not_protected" };
    if (hasX402Credential(request.headers)) return { kind: "x402" };

    const hasMppCredential = Boolean(paymentAuthorization(request.headers));
    const result = await mppx.evm.charge({
      amount: route.amount,
      description: route.description,
      scope: routeScope(request),
    })(request);

    if (result.status === 402) {
      return {
        challenge: result.challenge,
        kind: hasMppCredential ? "rejected" : "challenge",
        route,
      };
    }

    const receiptResponse = result.withReceipt(new Response(null, { status: 200 }));
    return {
      kind: "paid",
      receipt: receiptResponse,
      route,
    };
  }

  async function middleware(req, res, next) {
    const hasMppCredential = Boolean(paymentAuthorization(req.headers));
    try {
      const result = await authorize(req);
      if (result.kind === "not_protected" || result.kind === "x402") return next();
      if (result.kind === "challenge") {
        const challengeHeader = result.challenge.headers.get("WWW-Authenticate");
        if (challengeHeader) res.setHeader("WWW-Authenticate", challengeHeader);
        res.setHeader("Cache-Control", "no-store");
        return next();
      }
      if (result.kind === "rejected") {
        copyHeaders(result.challenge, res);
        const body = await result.challenge.text();
        return res.status(result.challenge.status).send(body || undefined);
      }
      if (result.kind === "paid") {
        copyHeaders(result.receipt, res, new Set(["payment-receipt"]));
        res.locals = res.locals || {};
        res.locals.samedaydeskPayment = Object.freeze({ protocol: "mpp" });
        return next();
      }
      return next();
    } catch (error) {
      logger.error?.(`MPP dual-stack ${hasMppCredential ? "authorization" : "challenge"} failed: ${error?.message || error}`);
      if (!hasMppCredential) return next();
      res.setHeader("Cache-Control", "no-store");
      return res.status(503).json({
        ok: false,
        error: "mpp_payment_temporarily_unavailable",
        charged: false,
      });
    }
  }

  return {
    authorize,
    enabled: true,
    middleware,
    realm,
    routeCount: routeMap.size,
  };
}

export function mppAssetForNetwork(network) {
  return SUPPORTED_ASSETS.get(network) || null;
}
