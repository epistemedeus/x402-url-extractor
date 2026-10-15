import { readFileSync } from "node:fs";

// Cold MCP and A2A clients probe these paths before the well-known card.
// Express's default HTML 404 hides the registry descriptor that already
// lives in server.json and the agent card served at the well-known path.
export const MCP_REGISTRY_PATHS = Object.freeze([
  "/server.json",
  "/.well-known/mcp/server.json",
]);
export const AGENT_CARD_ALIAS_PATH = "/agent-card.json";

export function readMcpRegistryDescriptor(text) {
  const descriptor = JSON.parse(text);
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new Error("mcp registry descriptor must be an object");
  }
  if (typeof descriptor.name !== "string" || descriptor.name.length === 0) {
    throw new Error("mcp registry descriptor is missing name");
  }
  if (!Array.isArray(descriptor.remotes) || descriptor.remotes.length === 0) {
    throw new Error("mcp registry descriptor is missing remotes");
  }
  for (const remote of descriptor.remotes) {
    if (remote?.type !== "streamable-http" || typeof remote.url !== "string" || !remote.url.startsWith("https://")) {
      throw new Error("mcp registry remote must be an https streamable-http url");
    }
  }
  return descriptor;
}

export function loadMcpRegistryDescriptor(url) {
  return readMcpRegistryDescriptor(readFileSync(url, "utf8"));
}

export function mountPublicDiscoveryAliases(app, { descriptor, agentCard }) {
  const card = readMcpRegistryDescriptor(JSON.stringify(descriptor));
  app.get(MCP_REGISTRY_PATHS, (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.type("application/json");
    return res.send(JSON.stringify(card));
  });
  app.get(AGENT_CARD_ALIAS_PATH, (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    return res.json(typeof agentCard === "function" ? agentCard() : agentCard);
  });
}
