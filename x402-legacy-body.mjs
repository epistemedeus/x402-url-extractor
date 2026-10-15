function decodePaymentRequired(value) {
  if (typeof value !== "string" || !value || value.length > 131_072) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (decoded?.x402Version !== 2 || !Array.isArray(decoded.accepts)) return null;
    return decoded;
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
  if (!decoded) return null;

  const resource = decoded.resource && typeof decoded.resource === "object"
    ? decoded.resource
    : {};
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

function paymentRequiredHeader(res) {
  const header = res.getHeader("payment-required");
  return Array.isArray(header) ? header[0] : header;
}

export function isEmptyPaymentRequiredBody(body) {
  if (body == null || typeof body === "function") return false;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return isEmptyPaymentRequiredBody(Buffer.from(body).toString("utf8"));
  }
  if (typeof body === "string") return body.trim() === "{}";
  return typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0;
}

// x402 v2 uses the Payment-Required header and intentionally emits `{}` as
// the HTTP body. Some live registries still index only the legacy JSON body.
// Preserve the canonical v2 header while mirroring its public offer data into
// the otherwise-empty body, including v1 field aliases those indexers expect.
// Circle Gateway (and any other middleware that calls res.end("{}") instead of
// res.json({})) must take the same path: the header is already set, and a cold
// client that reads only the body otherwise sees no price, network, asset, or payTo.
export function legacyCompatibleX402Body(_req, res, next) {
  const originalJson = res.json.bind(res);
  const originalEnd = res.end.bind(res);
  let replaced = false;

  function mirroredBody() {
    if (res.statusCode !== 402) return null;
    return buildLegacyCompatiblePaymentRequired(paymentRequiredHeader(res));
  }

  res.json = function compatibleJson(body) {
    if (!replaced && isEmptyPaymentRequiredBody(body)) {
      const compatible = mirroredBody();
      if (compatible) {
        replaced = true;
        return originalJson(compatible);
      }
    }
    return originalJson(body);
  };

  res.end = function compatibleEnd(chunk, encoding, callback) {
    if (!replaced && isEmptyPaymentRequiredBody(chunk)) {
      const compatible = mirroredBody();
      if (compatible) {
        replaced = true;
        const payload = JSON.stringify(compatible);
        if (res.getHeader("content-length") != null) {
          res.setHeader("content-length", Buffer.byteLength(payload));
        }
        return originalEnd(payload, encoding, callback);
      }
    }
    return originalEnd(chunk, encoding, callback);
  };
  return next();
}
