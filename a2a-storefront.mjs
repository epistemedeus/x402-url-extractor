import { randomUUID } from "node:crypto";

const A2A_VERSION = "1.0";

export function buildAgentCard({ publicUrl, serviceVersion = "1.2.0" }) {
  return {
    name: "SameDayDesk machine commerce storefront",
    description: "Discovers exact-price x402 data and risk actions that settle USDC on Base.",
    supportedInterfaces: [
      {
        url: `${publicUrl}/a2a`,
        protocolBinding: "HTTP+JSON",
        protocolVersion: A2A_VERSION,
      },
    ],
    provider: {
      organization: "Neomorphic LLC",
      url: "https://samedaydesk.com",
    },
    version: serviceVersion,
    documentationUrl: `${publicUrl}/skill.md`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "discover-x402-paid-actions",
        name: "Discover x402 paid actions",
        description: "Returns the current machine-action catalog with exact USDC prices, input URLs, settlement network, and payment instructions.",
        tags: ["x402", "payments", "Base", "USDC", "data", "risk"],
        examples: [
          "List the paid actions this service offers.",
          "Find the Morpho borrower-risk action and its exact USDC price.",
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["application/json"],
      },
    ],
  };
}

export function validateA2aMessage(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }
  const message = body.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return "message is required.";
  }
  if (!Array.isArray(message.parts) || message.parts.length === 0) {
    return "message.parts must contain at least one part.";
  }
  return null;
}

export function buildCatalogMessage({ request, catalog }) {
  const requestedContext = request?.message?.contextId;
  return {
    message: {
      role: "ROLE_AGENT",
      messageId: randomUUID(),
      contextId: requestedContext || randomUUID(),
      parts: [
        {
          data: catalog,
          mediaType: "application/json",
        },
      ],
    },
  };
}

export function versionProblem(requestedVersion) {
  return {
    type: "https://a2a-protocol.org/errors/version-not-supported",
    title: "Protocol Version Not Supported",
    status: 400,
    detail: `The requested A2A protocol version ${requestedVersion} is not supported by this agent.`,
    supportedVersions: [A2A_VERSION],
  };
}

export function validationProblem(detail) {
  return {
    type: "https://a2a-protocol.org/errors/invalid-request",
    title: "Invalid A2A Request",
    status: 400,
    detail,
  };
}

export { A2A_VERSION };
