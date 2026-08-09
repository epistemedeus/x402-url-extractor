import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

/**
 * Preserve the local explicit `outputSchema` authoring shape while adapting it
 * to the Bazaar v2 contract, which expects the JSON Schema at
 * `output.schema`. Keeping this at one boundary prevents response contracts
 * from silently degrading to an untyped example object.
 */
export function declareDiscoveryContract(config = {}) {
  const { output, outputSchema, ...rest } = config;
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
