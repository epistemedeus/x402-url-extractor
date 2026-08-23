import {
  declareDiscoveryExtension,
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
} from "@x402/extensions/bazaar";

function createDiscoveryRegistry() {
  return {
    outputContracts: new Map(),
    requestContracts: new Map(),
  };
}

let activeRegistry = createDiscoveryRegistry();
let stagingRegistry = null;

function currentRegistry() {
  return stagingRegistry || activeRegistry;
}

function beginDiscoveryRegistryTransaction() {
  if (stagingRegistry) {
    throw new Error("Discovery registry transaction already open");
  }
  stagingRegistry = createDiscoveryRegistry();
}

function abortDiscoveryRegistryTransaction() {
  stagingRegistry = null;
}

function commitDiscoveryRegistryTransaction() {
  if (!stagingRegistry) {
    throw new Error("Discovery registry transaction is not open");
  }
  if (stagingRegistry.outputContracts.size === 0) {
    throw new Error("Refusing to commit an empty discovery registry");
  }
  if (stagingRegistry.outputContracts.size !== stagingRegistry.requestContracts.size) {
    throw new Error("Incomplete discovery registry");
  }
  for (const routeKey of stagingRegistry.outputContracts.keys()) {
    if (!stagingRegistry.requestContracts.has(routeKey)) {
      throw new Error("Incomplete discovery registry");
    }
  }
  for (const routeKey of stagingRegistry.requestContracts.keys()) {
    if (!stagingRegistry.outputContracts.has(routeKey)) {
      throw new Error("Incomplete discovery registry");
    }
  }
  activeRegistry = stagingRegistry;
  stagingRegistry = null;
}

/**
 * Compose a complete replacement registry. The active maps stay visible to
 * readers until `work` returns a complete pair of maps; a throw discards the
 * staging maps and leaves the previous complete registry unchanged.
 */
export function withReplacementDiscoveryRegistry(work) {
  beginDiscoveryRegistryTransaction();
  try {
    const result = work();
    commitDiscoveryRegistryTransaction();
    return result;
  } catch (error) {
    abortDiscoveryRegistryTransaction();
    throw error;
  }
}

function contractIdentityBytes(value) {
  return JSON.stringify(value);
}

/**
 * Preserve the local explicit `outputSchema` authoring shape while adapting it
 * to the Bazaar v2 contract, which expects the JSON Schema at
 * `output.schema`. Keeping this at one boundary prevents response contracts
 * from silently degrading to an untyped example object.
 */
export function declareDiscoveryContract(config = {}) {
  const { output, outputSchema, routeKey, ...rest } = config;
  const { outputContracts, requestContracts } = currentRegistry();
  let routeMethod;
  let nextOutput;
  if (routeKey !== undefined) {
    const match = /^(GET|POST) \/[^?#]+$/.exec(routeKey);
    if (!match) throw new Error(`Invalid discovery route key: ${routeKey}`);
    routeMethod = match[1];
    if (!output?.example || !outputSchema) throw new Error(`Discovery route ${routeKey} requires an example and output schema`);
    nextOutput = structuredClone({ example: output.example, schema: outputSchema });
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
      throw new Error(`Invalid Bazaar discovery contract for ${routeKey}: ${errors.join("; ")}`);
    }
    const nextRequest = structuredClone({
      example: extension.info.input,
      schema: extension.schema.properties.input,
    });
    const existingOutput = outputContracts.get(routeKey);
    const existingRequest = requestContracts.get(routeKey);
    if ((existingOutput && !existingRequest) || (!existingOutput && existingRequest)) {
      throw new Error(`Duplicate discovery route key: ${routeKey}`);
    }
    if (existingOutput && existingRequest) {
      const sameOutput = contractIdentityBytes(existingOutput) === contractIdentityBytes(nextOutput);
      const sameRequest = contractIdentityBytes(existingRequest) === contractIdentityBytes(nextRequest);
      if (!sameOutput || !sameRequest) {
        throw new Error(`Duplicate discovery route key: ${routeKey}`);
      }
      return declared;
    }
    outputContracts.set(routeKey, nextOutput);
    requestContracts.set(routeKey, nextRequest);
  }
  return declared;
}

export function getDiscoveryRequestContract(routeKey) {
  const contract = currentRegistry().requestContracts.get(routeKey);
  return contract ? structuredClone(contract) : null;
}

const SENSITIVE_INPUT_NAME = /(?:^|[-_.])(auth|authorization|bearer|cookie|credential|jwt|key|otp|pass(?:word)?|secret|session|signature|token)(?:$|[-_.])/i;
const SENSITIVE_INPUT_NAME_COLLAPSED = /(?:api|access|auth|authorization|bearer|client|cookie|credential|private|session)?(?:jwt|key|otp|pass|password|secret|signature|token)$/i;

/**
 * Classify whether a runtime GET request carries every required, non-secret
 * query key from its canonical Bazaar request contract. This is intentionally
 * narrower than general request validation: it never evaluates values, never
 * claims runtime validity, and leaves body, path, header, and cookie contracts
 * unmeasured until the telemetry layer can observe them safely.
 */
export function classifyDiscoveryRequestConstruction(routeKey, queryInput = []) {
  const contract = currentRegistry().requestContracts.get(routeKey);
  if (!contract) return { status: "undeclared", requiredKeyCount: 0 };
  const method = String(contract.example?.method || "").toUpperCase();
  const querySchema = contract.schema?.properties?.queryParams;
  const required = Array.isArray(querySchema?.required) ? querySchema.required : [];
  const unsupportedExampleFields = ["body", "pathParams", "headers", "cookies"]
    .some((name) => contract.example?.[name] !== undefined);
  const safeRequired = required.every((name) => (
    typeof name === "string"
    && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name)
    && !SENSITIVE_INPUT_NAME.test(name)
    && !SENSITIVE_INPUT_NAME_COLLAPSED.test(name.replaceAll(/[-_.]/g, ""))
  ));
  if (method !== "GET" || unsupportedExampleFields || required.length === 0 || !safeRequired) {
    return { status: "not_measured", requiredKeyCount: 0 };
  }
  const query = queryInput && typeof queryInput === "object" && !Array.isArray(queryInput)
    ? queryInput
    : Object.fromEntries((Array.isArray(queryInput) ? queryInput : [])
      .filter((name) => typeof name === "string")
      .map((name) => [name, true]));
  const scalarNonEmpty = (value) => {
    if (typeof value === "string") return value.trim().length > 0;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "boolean") return true;
    if (Array.isArray(value)) return value.some(scalarNonEmpty);
    return false;
  };
  const complete = required.every((name) => scalarNonEmpty(query[name]));
  return {
    status: complete ? "constructed" : "missing_required_input",
    requiredKeyCount: required.length,
  };
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
  const contract = currentRegistry().outputContracts.get(routeKey);
  return contract ? structuredClone(contract) : null;
}
