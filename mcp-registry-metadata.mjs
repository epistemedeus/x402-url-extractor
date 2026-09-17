import { readFileSync } from "node:fs";

export const MCP_REGISTRY_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
export const MCP_REGISTRY_SERVER_NAME = "io.github.epistemedeus/x402-data-gateway";
export const MCP_REGISTRY_TITLE = "SameDayDesk";
export const MCP_REGISTRY_BRAND_SEARCH = "samedaydesk";
export const MCP_REGISTRY_NAME_SEARCH = "x402-data-gateway";
export const MCP_REGISTRY_REMOTE_URL = "https://agents.samedaydesk.com/mcp";
export const MCP_REGISTRY_DESCRIPTION_MAX = 100;
export const MCP_REGISTRY_WORKER_PUBLISH_FORBIDDEN =
  "workers must not call mcp-publisher publish; Root publishes";

const DEFAULT_MANIFEST_URL = new URL("./server.json", import.meta.url);
const PACKET_MANIFEST_URL = new URL(
  "./experiments/w5-request-construction/registration/server.json",
  import.meta.url,
);

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

export function loadOfficialRegistryManifest(url = DEFAULT_MANIFEST_URL) {
  const manifest = readJson(url);
  if (manifest.$schema !== MCP_REGISTRY_SCHEMA) {
    throw new Error("MCP registry manifest schema URI is not the official 2025-12-11 server schema");
  }
  if (manifest.name !== MCP_REGISTRY_SERVER_NAME) {
    throw new Error(`MCP registry manifest name must remain ${MCP_REGISTRY_SERVER_NAME}`);
  }
  if (manifest.title !== MCP_REGISTRY_TITLE) {
    throw new Error(`MCP registry manifest title must be ${MCP_REGISTRY_TITLE}`);
  }
  const description = String(manifest.description || "");
  if (description.length < 1 || description.length > MCP_REGISTRY_DESCRIPTION_MAX) {
    throw new Error(`MCP registry description must be 1 to ${MCP_REGISTRY_DESCRIPTION_MAX} characters`);
  }
  if (!description.includes("SameDayDesk") || !description.includes("samedaydesk")) {
    throw new Error("MCP registry description must include SameDayDesk and samedaydesk brand tokens");
  }
  const remote = manifest.remotes?.[0];
  if (remote?.type !== "streamable-http" || remote?.url !== MCP_REGISTRY_REMOTE_URL) {
    throw new Error(`MCP registry remotes must keep streamable-http ${MCP_REGISTRY_REMOTE_URL}`);
  }
  return manifest;
}

export function loadPacketRegistryManifest() {
  return loadOfficialRegistryManifest(PACKET_MANIFEST_URL);
}

export function namedServerFromLatest(namedLatest) {
  const server = namedLatest?.server;
  if (!server || typeof server !== "object") return null;
  if (server.name !== MCP_REGISTRY_SERVER_NAME) return null;
  if (!server.version) return null;
  return { name: server.name, version: String(server.version), title: server.title ?? null };
}

export function brandSearchCount(brandSearch) {
  const count = brandSearch?.metadata?.count;
  return Number.isFinite(Number(count)) ? Number(count) : 0;
}

export function refuseLivePublisherCommand(command) {
  const text = String(command || "").trim();
  if (/\bmcp-publisher\s+publish\b/.test(text) || /\b\/v0\.1\/publish\b/.test(text)) {
    throw new Error(MCP_REGISTRY_WORKER_PUBLISH_FORBIDDEN);
  }
  return { publish: false, reason: MCP_REGISTRY_WORKER_PUBLISH_FORBIDDEN };
}

export function planRegistryPublish({
  brandSearch,
  namedLatest,
  proposedName,
  command,
} = {}) {
  refuseLivePublisherCommand(command);
  const existing = namedServerFromLatest(namedLatest);
  const count = brandSearchCount(brandSearch);
  const proposed = proposedName == null || proposedName === "" ? MCP_REGISTRY_SERVER_NAME : String(proposedName);

  if (existing) {
    if (proposed !== existing.name) {
      throw new Error(
        `duplicate-publish refused: treating search=${MCP_REGISTRY_BRAND_SEARCH} count:${count} as not listed would create ${proposed} beside existing ${existing.name}@${existing.version}`,
      );
    }
    return Object.freeze({
      action: "already-listed",
      publish: false,
      reason: MCP_REGISTRY_WORKER_PUBLISH_FORBIDDEN,
      existingName: existing.name,
      existingVersion: existing.version,
      brandSearchCount: count,
      note: `search=${MCP_REGISTRY_BRAND_SEARCH} count:${count} is not unlisted; keep ${existing.name} and let Root publish title/description on a new immutable version`,
    });
  }

  return Object.freeze({
    action: "not-listed",
    publish: false,
    reason: MCP_REGISTRY_WORKER_PUBLISH_FORBIDDEN,
    brandSearchCount: count,
  });
}
