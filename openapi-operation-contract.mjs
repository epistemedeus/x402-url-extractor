const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

export function validateOpenApiOperationIds(document) {
  if (!document?.paths || typeof document.paths !== "object" || Array.isArray(document.paths)) {
    throw new Error("OpenAPI document is missing paths");
  }
  const operations = [];
  for (const [route, pathItem] of Object.entries(document.paths)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
      const operationId = operation.operationId;
      if (typeof operationId !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(operationId)) {
        throw new Error(`OpenAPI operation ${method.toUpperCase()} ${route} is missing a stable operationId`);
      }
      operations.push({ method: method.toUpperCase(), route, operationId });
    }
  }
  const seen = new Set();
  for (const operation of operations) {
    if (seen.has(operation.operationId)) throw new Error(`Duplicate OpenAPI operationId: ${operation.operationId}`);
    seen.add(operation.operationId);
  }
  return { operationCount: operations.length, uniqueOperationIds: seen.size };
}
