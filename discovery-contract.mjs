import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const outputContracts = new Map();

/**
 * Preserve the local explicit `outputSchema` authoring shape while adapting it
 * to the Bazaar v2 contract, which expects the JSON Schema at
 * `output.schema`. Keeping this at one boundary prevents response contracts
 * from silently degrading to an untyped example object.
 */
export function declareDiscoveryContract(config = {}) {
  const { output, outputSchema, routeKey, ...rest } = config;
  if (routeKey !== undefined) {
    if (!/^GET \/[^?#]+$/.test(routeKey)) throw new Error(`Invalid discovery route key: ${routeKey}`);
    if (!output?.example || !outputSchema) throw new Error(`Discovery route ${routeKey} requires an example and output schema`);
    if (outputContracts.has(routeKey)) throw new Error(`Duplicate discovery route key: ${routeKey}`);
    outputContracts.set(routeKey, structuredClone({ example: output.example, schema: outputSchema }));
  }
  return declareDiscoveryExtension({
    ...rest,
    ...(output ? {
      output: {
        ...output,
        ...(outputSchema ? { schema: outputSchema } : {}),
      },
    } : {}),
  });
}

export function getDiscoveryOutputContract(routeKey) {
  const contract = outputContracts.get(routeKey);
  return contract ? structuredClone(contract) : null;
}
