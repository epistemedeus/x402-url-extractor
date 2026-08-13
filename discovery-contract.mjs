import {
  declareDiscoveryExtension,
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
} from "@x402/extensions/bazaar";

const outputContracts = new Map();
const requestContracts = new Map();

/**
 * Preserve the local explicit `outputSchema` authoring shape while adapting it
 * to the Bazaar v2 contract, which expects the JSON Schema at
 * `output.schema`. Keeping this at one boundary prevents response contracts
 * from silently degrading to an untyped example object.
 */
export function declareDiscoveryContract(config = {}) {
  const { output, outputSchema, routeKey, ...rest } = config;
  let routeMethod;
  if (routeKey !== undefined) {
    const match = /^(GET|POST) \/[^?#]+$/.exec(routeKey);
    if (!match) throw new Error(`Invalid discovery route key: ${routeKey}`);
    routeMethod = match[1];
    if (!output?.example || !outputSchema) throw new Error(`Discovery route ${routeKey} requires an example and output schema`);
    if (outputContracts.has(routeKey)) throw new Error(`Duplicate discovery route key: ${routeKey}`);
    outputContracts.set(routeKey, structuredClone({ example: output.example, schema: outputSchema }));
  }
  const declared = declareDiscoveryExtension({
    ...rest,
    ...(output ? {
      output: {
        ...output,
        ...(outputSchema ? { schema: outputSchema } : {}),
      },
    } : {}),
  });
  if (routeKey !== undefined) {
    const extension = structuredClone(declared.bazaar);
    extension.info.input.method = routeMethod;
    const schemaResult = validateDiscoveryExtension(extension);
    const specResult = validateDiscoveryExtensionSpec(extension);
    const errors = [...(schemaResult.errors || []), ...(specResult.errors || [])];
    if (!schemaResult.valid || !specResult.valid) {
      outputContracts.delete(routeKey);
      throw new Error(`Invalid Bazaar discovery contract for ${routeKey}: ${errors.join("; ")}`);
    }
    requestContracts.set(routeKey, structuredClone({
      example: extension.info.input,
      schema: extension.schema.properties.input,
    }));
  }
  return declared;
}

export function getDiscoveryRequestContract(routeKey) {
  const contract = requestContracts.get(routeKey);
  return contract ? structuredClone(contract) : null;
}

export function projectDiscoveryRequest(resourceUrl, method, contract) {
  if (!contract) return null;
  const url = new URL(resourceUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Discovery resource URL must be credential-free HTTPS");
  }
  const normalizedMethod = String(method || "GET").toUpperCase();
  const request = {
    method: normalizedMethod,
    url: url.href,
    example: structuredClone(contract.example),
    schema: structuredClone(contract.schema),
  };
  const queryParams = contract.example?.queryParams;
  if (normalizedMethod === "GET" && queryParams && typeof queryParams === "object" && !Array.isArray(queryParams)) {
    for (const [name, value] of Object.entries(queryParams).sort(([left], [right]) => left.localeCompare(right))) {
      if (!["string", "number", "boolean"].includes(typeof value)) {
        throw new Error(`Discovery query example for ${url.href} has non-scalar ${name}`);
      }
      url.searchParams.set(name, String(value));
    }
    request.exampleUrl = url.href;
  }
  return request;
}

export function getDiscoveryOutputContract(routeKey) {
  const contract = outputContracts.get(routeKey);
  return contract ? structuredClone(contract) : null;
}
