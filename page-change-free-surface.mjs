// Already-live free profile, shared by llms.txt, the served page-change skill,
// and the agent card. Not a new route, catalog entry, or paid offer.
// Kept out of page-change-input-contract.mjs so a historical checkout of that
// contract can still load the current machine-surface and agent-card modules.

import { pageChangeRequestExample } from "./page-change-input-contract.mjs";

export const FREE_PAGE_COMPARE_ROUTE = "/mcp/page-change";
export const FREE_PAGE_COMPARE_TOOL = "compare_page_observations";
export const FREE_PAGE_COMPARE_SKILL_ID = "compare-held-page-observations";

export function freePageCompareFacts(origin) {
  const publicOrigin = new URL(origin).origin;
  return {
    method: "POST",
    route: FREE_PAGE_COMPARE_ROUTE,
    url: `${publicOrigin}${FREE_PAGE_COMPARE_ROUTE}`,
    tool: FREE_PAGE_COMPARE_TOOL,
    charged: false,
    paymentRequired: false,
    fetchesUrls: false,
    inputRequired: ["before", "after", "fields"],
    example: pageChangeRequestExample(),
  };
}

export function renderFreePageCompareLlmsSection(origin) {
  const facts = freePageCompareFacts(origin);
  return [
    "",
    "## Free comparison",
    `POST ${facts.route} is the free-only Streamable HTTP MCP profile at ${facts.url}. Tool ${facts.tool}. charged: false. paymentRequired: false. This profile does not fetch URLs, take payment, or schedule a later observation. It is not the mixed catalog POST /mcp. Caller-held input stays separate from any optional paid observation. The example URL string is synthetic and is never fetched.`,
    `Input example: ${JSON.stringify(facts.example)}`,
  ].join("\n") + "\n";
}

export function omitFreePageCompareLlmsSection(text) {
  // The section ends with its own newline. Leave the next heading's newline in place.
  return String(text).replace(/\n## Free comparison\n[\s\S]*?\n(?=## )/, "");
}

export function renderFreePageCompareSkillAppendix(origin) {
  const facts = freePageCompareFacts(origin);
  return [
    "",
    "## Live free comparison",
    "",
    `POST ${facts.url} is the already-live free-only Streamable HTTP profile.`,
    `Tool: ${facts.tool}.`,
    "charged: false. paymentRequired: false.",
    "This profile does not fetch URLs, take payment, or schedule a later observation.",
    "The offline recipe above remains a separate caller-held path. This section does not replace it and does not require payment.",
    "The example URL string below is synthetic and is never fetched.",
    "",
    "Input example:",
    "",
    "```json",
    JSON.stringify(facts.example, null, 2),
    "```",
    "",
  ].join("\n");
}

export function freePageCompareAgentSkill(origin) {
  const facts = freePageCompareFacts(origin);
  return {
    id: FREE_PAGE_COMPARE_SKILL_ID,
    name: "Compare held page observations",
    description: `Free-only Streamable HTTP MCP ${facts.method} ${facts.url}. Tool ${facts.tool}. charged is false. paymentRequired is false. It does not fetch URLs, take payment, or schedule a later observation. It is not the mixed catalog POST /mcp. Caller-held JSON input is separate from any optional paid observation. The example URL string is synthetic and is never fetched. Input example: ${JSON.stringify(facts.example)}`,
    tags: ["free", "page-change", "no-payment", "no-fetch"],
    examples: [`Call ${facts.tool} on ${facts.method} ${facts.url} with the shared held-observation input. charged is false. No fetch and no payment.`],
    inputModes: ["application/json"],
    outputModes: ["application/json"],
  };
}

export function omitFreePageCompareAgentSkill(card) {
  if (!card || typeof card !== "object" || !Array.isArray(card.skills)) return card;
  return { ...card, skills: card.skills.filter((skill) => skill?.id !== FREE_PAGE_COMPARE_SKILL_ID) };
}
