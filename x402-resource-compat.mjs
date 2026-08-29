export const CDP_RESOURCE_DESCRIPTION_MAX_CODE_POINTS = 500;

export function assertCdpResourceDescriptionCompatibility(resources) {
  if (!Array.isArray(resources)) {
    throw new TypeError("x402 resources must be an array");
  }

  for (const [index, resource] of resources.entries()) {
    const description = resource?.description;
    const label = typeof resource?.url === "string" ? resource.url : `resource[${index}]`;
    if (typeof description !== "string" || description.trim().length === 0) {
      throw new Error(`x402 resource description is missing for ${label}`);
    }

    const length = Array.from(description).length;
    if (length > CDP_RESOURCE_DESCRIPTION_MAX_CODE_POINTS) {
      throw new Error(
        `x402 resource description exceeds CDP's ${CDP_RESOURCE_DESCRIPTION_MAX_CODE_POINTS}-character limit for ${label}: ${length}`,
      );
    }
  }

  return {
    maxDescriptionCodePoints: CDP_RESOURCE_DESCRIPTION_MAX_CODE_POINTS,
    resourceCount: resources.length,
  };
}
