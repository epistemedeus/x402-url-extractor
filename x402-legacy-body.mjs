import { decodePaymentRequiredHeader, encodePaymentRequiredHeader } from "@x402/core/http";
import { PaymentRequiredV2Schema } from "@x402/core/schemas";
import { x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import { isDeepStrictEqual } from "node:util";
import { getDiscoveryQuoteOutput } from "./discovery-contract.mjs";

const UNPAID_ERROR = "Payment required";

function decodePaymentRequired(value) {
  if (typeof value !== "string" || !value || value.length > 131_072) return null;
  try {
    const decoded = decodePaymentRequiredHeader(value);
    return PaymentRequiredV2Schema.safeParse(decoded).success ? decoded : null;
  } catch {
    return null;
  }
}

function legacyInputFields(discovery, schema) {
  const input = discovery?.input;
  const inputSchema = schema?.properties?.input?.properties;
  if (!input || typeof input !== "object" || !inputSchema || typeof inputSchema !== "object") {
    return input;
  }

  const projectFields = (container, examples) => {
    if (!container || typeof container !== "object" || !container.properties || typeof container.properties !== "object") {
      return null;
    }
    const required = new Set(Array.isArray(container.required) ? container.required : []);
    return Object.fromEntries(Object.entries(container.properties).map(([name, definition]) => {
      const source = definition && typeof definition === "object" ? definition : {};
      const example = examples && typeof examples === "object" ? examples[name] : undefined;
      const field = {
        ...(typeof source.type === "string" ? { type: source.type } : {}),
        ...(typeof source.description === "string" ? { description: source.description } : {}),
        ...(Array.isArray(source.enum) ? { enum: structuredClone(source.enum) } : {}),
        ...(source.items && typeof source.items === "object" ? { items: structuredClone(source.items) } : {}),
        ...(["string", "number", "boolean"].includes(typeof source.default) ? { default: source.default } : {}),
      };
      return [name, {
        ...field,
        required: required.has(name),
        ...(["string", "number", "boolean"].includes(typeof example) ? { default: example } : {}),
      }];
    }));
  };

  const bodyFields = projectFields(inputSchema.body, input.body);
  const queryParams = projectFields(inputSchema.queryParams, input.queryParams);
  return {
    ...structuredClone(input),
    ...(bodyFields ? { bodyFields } : {}),
    ...(queryParams ? { queryParams } : {}),
  };
}

export function buildLegacyCompatiblePaymentRequired(value) {
  const decoded = decodePaymentRequired(value);
  return decoded ? legacyPaymentRequired(decoded) : null;
}

function legacyPaymentRequired(decoded) {
  const { resource } = decoded;
  const discovery = decoded.extensions?.bazaar?.info;
  const outputSchema = discovery && typeof discovery === "object"
    ? {
        ...structuredClone(discovery),
        input: legacyInputFields(discovery, decoded.extensions?.bazaar?.schema),
      }
    : undefined;

  return {
    ...decoded,
    accepts: decoded.accepts.map((accept) => ({
      ...accept,
      description: accept.description || resource.description,
      maxAmountRequired: accept.maxAmountRequired || accept.amount,
      mimeType: accept.mimeType || resource.mimeType,
      ...(outputSchema ? { outputSchema } : {}),
      extra: {
        ...(accept.extra || {}),
        ...(resource.serviceName ? { serviceName: resource.serviceName } : {}),
        ...(Array.isArray(resource.tags) ? { tags: resource.tags } : {}),
      },
    })),
  };
}

function projectBazaarQuote(quote) {
  const { info, schema } = quote.extensions?.bazaar || {};
  const properties = schema?.properties?.output?.properties;
  if (info?.output?.type !== "json" || !properties || !Object.hasOwn(properties, "example")) return quote;

  const hasExample = Object.hasOwn(info.output, "example");
  const partial = hasExample && getDiscoveryQuoteOutput(quote.resource.url, info.input?.method);
  if (hasExample && !partial) return quote;

  const projected = structuredClone(quote);
  const bazaar = projected.extensions.bazaar;
  if (partial) {
    bazaar.info.output = partial.info;
    bazaar.schema.properties.output.properties.example = partial.schema;
  } else {
    delete bazaar.schema.properties.output.properties.example;
  }
  return projected;
}

// Scope the legacy projection to the SDK's own unpaid response. Core 2.16
// used an empty body and 2.29 adds a single error field to the placeholder.
// Registry clients need the full body projection; the v2 header stays authoritative.
export function mirrorLegacyX402Body(response) {
  const { status, body, headers } = response;
  if (status !== 402 || headers?.["Content-Type"] !== "application/json"
      || !body || Object.getPrototypeOf(body) !== Object.prototype) return response;
  const keys = Object.keys(body);
  if (keys.length !== 0 && !(keys.length === 1 && keys[0] === "error" && body.error === UNPAID_ERROR)) return response;

  const decoded = decodePaymentRequired(headers["PAYMENT-REQUIRED"]);
  if (decoded?.error !== UNPAID_ERROR) return response;
  const compatible = legacyPaymentRequired(decoded);
  // Keep the full declaration in the legacy body. Clients echo the header's
  // Bazaar extension in PAYMENT-SIGNATURE, so this also bounds the retry.
  const quote = projectBazaarQuote(decoded);
  return {
    ...response,
    headers: quote === decoded ? headers : { ...headers, "PAYMENT-REQUIRED": encodePaymentRequiredHeader(quote) },
    body: compatible,
  };
}

export class QuoteX402ResourceServer extends x402ResourceServer {
  validateExtensions(paymentRequired, paymentPayload) {
    const result = super.validateExtensions(paymentRequired, paymentPayload);
    if (result.valid || result.extensionKey !== "bazaar") return result;

    // Accept either the original declaration or the exact partial example we
    // advertise. The SDK still checks the input and all other extension info.
    const projected = projectBazaarQuote(paymentRequired);
    const output = projected.extensions?.bazaar?.info?.output;
    if (projected === paymentRequired || output?.format !== "partial-example"
        || !isDeepStrictEqual(paymentPayload.extensions?.bazaar?.info?.output, output)) return result;
    return super.validateExtensions(projected, paymentPayload);
  }
}

export class LegacyBodyX402HTTPResourceServer extends x402HTTPResourceServer {
  async processHTTPRequest(context, paywallConfig) {
    const result = await super.processHTTPRequest(context, paywallConfig);
    if (context.paymentHeader || result.type !== "payment-error") return result;
    return { ...result, response: mirrorLegacyX402Body(result.response) };
  }
}
