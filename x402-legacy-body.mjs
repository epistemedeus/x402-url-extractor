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
      const field = definition && typeof definition === "object" ? structuredClone(definition) : {};
      const example = examples && typeof examples === "object" ? examples[name] : undefined;
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

// x402 v2 uses the Payment-Required header and intentionally emits `{}` as
// the HTTP body. Some live registries still index only the legacy JSON body.
// Preserve the canonical v2 header while mirroring its public offer data into
// the otherwise-empty body, including v1 field aliases those indexers expect.
export function legacyCompatibleX402Body(_req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function compatibleJson(body) {
    if (
      res.statusCode === 402 &&
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0
    ) {
      const header = res.getHeader("payment-required");
      const compatible = buildLegacyCompatiblePaymentRequired(
        Array.isArray(header) ? header[0] : header,
      );
      if (compatible) return originalJson(compatible);
    }
    return originalJson(body);
  };
  return next();
}
