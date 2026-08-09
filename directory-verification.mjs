const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GLAMA_CONNECTOR_SCHEMA = "https://glama.ai/mcp/schemas/connector.json";

export function glamaConnectorVerification({ maintainerEmail = "contact@samedaydesk.com" } = {}) {
  const email = String(maintainerEmail || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("Glama maintainer email is invalid");
  return {
    $schema: GLAMA_CONNECTOR_SCHEMA,
    maintainers: [{ email }],
  };
}
