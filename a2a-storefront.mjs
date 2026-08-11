import { randomUUID } from "node:crypto";

const A2A_VERSION = "1.0";
const A2A_CATALOG_SKILL_ID = "discover-x402-paid-actions";

const skillSlug = (action) => String(action?.name || action?.route || "")
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 80);

export function buildPaidActionSkills(actions = []) {
  if (!Array.isArray(actions)) throw new Error("actions must be an array");
  const seen = new Set();
  return actions.map((action) => {
    const slug = skillSlug(action);
    if (!slug) throw new Error("paid action needs a stable name or route");
    const id = `discover-paid-action-${slug}`;
    if (seen.has(id)) throw new Error(`duplicate paid action skill: ${id}`);
    seen.add(id);
    const route = String(action.route || "");
    const price = String(action.priceAtomicUsdc || "");
    return {
      id,
      name: `Discover paid action ${route || slug}`,
      description: `Discover the direct ${route || slug} machine-paid action, its ${price || "current"} atomic USDC price, and x402/MPP invocation URL. Discovery only; invoke and pay the returned action URL directly.`,
      tags: [...new Set(["x402", "mpp", "paid-action", "discovery", ...(action.tags || [])])],
      examples: [`Find the ${route || slug} paid action and its exact current price.`],
      inputModes: ["text/plain", "application/json"],
      outputModes: ["application/json"],
    };
  });
}

export function buildAgentCard({ publicUrl, serviceVersion, actions = [] }) {
  if (!serviceVersion) throw new Error("serviceVersion is required");
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
        id: A2A_CATALOG_SKILL_ID,
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
      ...buildPaidActionSkills(actions),
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
  if (typeof message.messageId !== "string" || !message.messageId.trim()) {
    return "message.messageId is required.";
  }
  if (message.role !== "ROLE_USER") {
    return "message.role must be ROLE_USER.";
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

export { A2A_CATALOG_SKILL_ID, A2A_VERSION };
