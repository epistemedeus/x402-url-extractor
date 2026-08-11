const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GLAMA_CONNECTOR_SCHEMA = "https://glama.ai/mcp/schemas/connector.json";
export const X402_JOBS_VERIFICATION_CODE = "ac7a83614a55";

export function glamaConnectorVerification({ maintainerEmail = "contact@samedaydesk.com" } = {}) {
  const email = String(maintainerEmail || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("Glama maintainer email is invalid");
  return {
    $schema: GLAMA_CONNECTOR_SCHEMA,
    maintainers: [{ email }],
  };
}

export function x402JobsVerification({ code = X402_JOBS_VERIFICATION_CODE } = {}) {
  const normalized = String(code || "").trim().toLowerCase();
  if (!/^[a-f0-9]{12}$/.test(normalized)) {
    throw new Error("x402.jobs verification code is invalid");
  }
  return { x402: normalized };
}
