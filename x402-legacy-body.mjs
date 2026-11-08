import { decodePaymentRequiredHeader, encodePaymentRequiredHeader } from "@x402/core/http";
import { PaymentRequiredV2Schema } from "@x402/core/schemas";
import { x402HTTPResourceServer } from "@x402/core/server";

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
  const { info, schema } = decoded.extensions?.bazaar || {};
  const outputProperties = schema?.properties?.output?.properties;
  if (info?.output?.type !== "json" || Object.hasOwn(info.output, "example")
      || !outputProperties || !Object.hasOwn(outputProperties, "example")) {
    return { ...response, body: compatible };
  }

  // An explicitly omitted example has no value to validate in the header.
  // Keep its full schema in the legacy body and in the route declaration.
  const quote = structuredClone(decoded);
  delete quote.extensions.bazaar.schema.properties.output.properties.example;
  return {
    ...response,
    headers: { ...headers, "PAYMENT-REQUIRED": encodePaymentRequiredHeader(quote) },
    body: compatible,
  };
}

export class LegacyBodyX402HTTPResourceServer extends x402HTTPResourceServer {
  async processHTTPRequest(context, paywallConfig) {
    const result = await super.processHTTPRequest(context, paywallConfig);
    if (context.paymentHeader || result.type !== "payment-error") return result;
    return { ...result, response: mirrorLegacyX402Body(result.response) };
  }
}
