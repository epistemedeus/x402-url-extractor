import { randomUUID } from "node:crypto";
import { operationIdentityFromAction } from "./operation-identity.mjs";
import { FREE_PAGE_COMPARE_ROUTE, FREE_PAGE_COMPARE_TOOL, freePageCompareAgentSkill } from "./page-change-free-surface.mjs";
import { PAGE_CHANGE_CONTINUATION_META } from "./page-change-continuation.mjs";

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
    const method = String(action.method || "").toUpperCase();
    const route = String(action.route || "");
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(method) || !route.startsWith("/")) {
      throw new Error(`paid action ${slug} needs its declared HTTP method and path`);
    }
    const routeLabel = `${method} ${route}`;
    const price = String(action.priceAtomicUsdc || "");
    const exampleUrl = typeof action?.request?.exampleUrl === "string" ? action.request.exampleUrl : null;
    const identity = operationIdentityFromAction(action);
    return {
      id,
      operation: identity,
      name: `Discover paid action ${routeLabel}`,
      description: `Discover the direct ${routeLabel} machine-paid action, its ${price || "current"} atomic USDC price, and ${identity.supportedRails.join("/")} invocation contract. Discovery only; invoke the returned exact request directly.${exampleUrl ? ` Complete example: ${exampleUrl}` : ""}`,
      tags: [...new Set([...identity.supportedRails, "paid-action", "discovery", ...(action.tags || []).filter((tag) => tag !== "mpp" || identity.supportedRails.includes("mpp"))])],
      examples: [exampleUrl
        ? `Find the ${routeLabel} paid action, then call ${exampleUrl}`
        : `Find the ${routeLabel} paid action and its exact current price.`],
      inputModes: ["text/plain", "application/json"],
      outputModes: ["application/json"],
    };
  });
}

// Machine recipe for continuing a free comparison from A2A. Not added to the
// agent card. A2A terminal tasks are immutable: a continuation is a NEW task in
// the same contextId that references the completed one. The caller keeps the
// accepted artifact lineage and the bearer token; this server stores neither.
export const FREE_PAGE_COMPARE_CONTINUATION_RECIPE_ID = "continue-held-page-observations";
const A2A_TERMINAL_STATES = new Set(["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"]);

export function freePageCompareContinuationRecipe(publicUrl) {
  const url = `${new URL(publicUrl).origin}${FREE_PAGE_COMPARE_ROUTE}`;
  return {
    id: FREE_PAGE_COMPARE_CONTINUATION_RECIPE_ID,
    charged: false,
    paymentRequired: false,
    endpoint: { method: "POST", url, tool: FREE_PAGE_COMPARE_TOOL, meta: PAGE_CHANGE_CONTINUATION_META },
    steps: [
      { step: "save", send: "tools/call with before, after, fields and _meta {save:true}", keep: ["continuation.token", "continuation.correlationId", "after"] },
      { step: "continue", send: "tools/call with before=kept after, a new after, the same fields and _meta {token}", keep: ["continuation.token", "continuation.correlationId", "after"] },
    ],
    a2a: {
      contextId: "reuse",
      taskId: "new_per_step",
      referenceTaskIds: "previous_task",
      completedTask: "immutable",
      artifactLineage: "client_side",
    },
    fields: {
      correlationId: "non-authorizing chain id for measurement",
      token: "bearer capability, never log or share",
      discovery: "observed | declared | unknown, never read from the token",
    },
  };
}

function frozenCopy(value) {
  if (!value || typeof value !== "object") return value;
  const copy = Array.isArray(value) ? value.map(frozenCopy) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, frozenCopy(child)]));
  return Object.freeze(copy);
}

/**
 * Client-side follow-up message for a terminal A2A task. Never mutates the
 * completed task; returns a new taskId in the same contextId.
 */
export function buildFreeCompareContinuationTask(priorTask, { data, taskId = randomUUID(), messageId = randomUUID() } = {}) {
  if (!priorTask || typeof priorTask !== "object" || typeof priorTask.id !== "string" || typeof priorTask.contextId !== "string") {
    throw new Error("prior task needs id and contextId");
  }
  if (!A2A_TERMINAL_STATES.has(priorTask.status?.state)) throw new Error("prior task is not terminal");
  if (taskId === priorTask.id) throw new Error("continuation needs a new taskId");
  return frozenCopy({
    taskId,
    contextId: priorTask.contextId,
    message: {
      role: "ROLE_USER",
      messageId,
      contextId: priorTask.contextId,
      referenceTaskIds: [priorTask.id],
      parts: [{ data: data ?? null, mediaType: "application/json" }],
    },
  });
}

export function buildAgentCard({ publicUrl, serviceVersion, actions = [], extractionTrialDiscovery = null, freePageCompare = false }) {
  if (!serviceVersion) throw new Error("serviceVersion is required");
  return {
    name: "SameDayDesk machine commerce storefront",
    description: "Discovers exact-price x402 data and risk actions that settle USDC on Base."
      + (extractionTrialDiscovery ? ` Walletless extraction trial contract (current availability, request and limits): ${extractionTrialDiscovery}` : ""),
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
      ...(freePageCompare ? [freePageCompareAgentSkill(publicUrl)] : []),
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
