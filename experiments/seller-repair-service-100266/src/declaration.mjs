const KEY = /^[A-Za-z0-9_-]+$/;

function walk(schema, prefix = "") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  const paths = [];
  for (const key of required) {
    if (typeof key !== "string" || !KEY.test(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    paths.push(...walk(properties[key], path));
  }
  return paths;
}

export function declaredRequiredPaths(document, route, method) {
  const operation = document?.paths?.[route]?.[String(method || "GET").toLowerCase()] || null;
  if (!operation || typeof operation !== "object") {
    return {
      present: false,
      requiredPaths: [],
      source: "openapi",
      provesExecution: false,
      provesUsefulEquivalence: false,
    };
  }
  const responses = operation.responses && typeof operation.responses === "object" ? operation.responses : {};
  const status = Object.keys(responses).filter((key) => /^2\d\d$/.test(key)).sort()[0];
  const content = responses[status]?.content && typeof responses[status].content === "object" ? responses[status].content : {};
  const mediaKey = Object.keys(content).find((key) => key.toLowerCase().split(";", 1)[0].trim() === "application/json");
  const schema = mediaKey ? content[mediaKey]?.schema : null;
  return {
    present: true,
    requiredPaths: [...new Set(walk(schema))].sort(),
    source: "openapi_required_array",
    provesExecution: false,
    provesUsefulEquivalence: false,
  };
}
