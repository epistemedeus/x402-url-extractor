export const CDP_X402_RESOURCE_DESCRIPTION_MAX_CHARS = 500;

export function assertCdpX402ResourceDescriptionCompatibility(resources) {
  if (!Array.isArray(resources)) throw new TypeError("x402 resources must be an array");
  for (const resource of resources) {
    const description = resource?.description;
    if (typeof description !== "string" || description.length === 0) {
      throw new TypeError(`x402 resource ${resource?.url || "<unknown>"} requires a description`);
    }
    const chars = [...description].length;
    if (chars > CDP_X402_RESOURCE_DESCRIPTION_MAX_CHARS) {
      throw new RangeError(
        `x402 resource ${resource?.url || "<unknown>"} description has ${chars} characters; CDP facilitator accepts at most ${CDP_X402_RESOURCE_DESCRIPTION_MAX_CHARS}`,
      );
    }
  }
  return resources;
}

