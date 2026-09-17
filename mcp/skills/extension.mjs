import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ErrorCode,
  PaginatedRequestSchema,
  RequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  SKILL_MD,
  SKILLS_EXTENSION_ID,
  getSkillEntry,
  listSkillEntries,
  loadSkillCatalog,
  protocolSkillEntry,
} from "./catalog.mjs";

export const SKILLS_LIST_METHOD = "skills/list";
export const SKILLS_GET_METHOD = "skills/get";
export const SKILLS_CACHE_SCOPE = "public";
export const SKILLS_TTL_MS = 3_600_000;

export const ListSkillsRequestSchema = PaginatedRequestSchema.extend({
  method: z.literal(SKILLS_LIST_METHOD),
});

export const GetSkillRequestSchema = RequestSchema.extend({
  method: z.literal(SKILLS_GET_METHOD),
});

export function skillsExtensionCapabilities({ directoryRead = false } = {}) {
  return {
    resources: {
      subscribe: false,
      listChanged: false,
    },
    extensions: {
      [SKILLS_EXTENSION_ID]: {
        directoryRead: directoryRead === true,
      },
    },
  };
}

function cacheableComplete(fields) {
  return {
    resultType: "complete",
    ttlMs: SKILLS_TTL_MS,
    cacheScope: SKILLS_CACHE_SCOPE,
    ...fields,
  };
}

function invalidParams(message) {
  const error = new Error(message);
  error.code = ErrorCode.InvalidParams;
  error.name = "McpInvalidParams";
  throw error;
}

function requestedUri(params) {
  const uri = params?.uri;
  if (typeof uri !== "string" || uri.length === 0) return null;
  return uri;
}

export function skillsListResult(catalog, params = {}, { pageSize } = {}) {
  const listed = listSkillEntries(catalog, { cursor: params?.cursor, pageSize });
  if (listed.error === "invalid_cursor") {
    invalidParams(`Invalid skills/list cursor: ${params?.cursor ?? ""}`);
  }
  return cacheableComplete({
    skills: listed.skills,
    ...(listed.nextCursor ? { nextCursor: listed.nextCursor } : {}),
  });
}

export function skillsGetResult(catalog, params = {}) {
  const uri = requestedUri(params);
  if (!uri) invalidParams("params.uri MUST be the URI of a skill's SKILL.md");
  const skill = getSkillEntry(catalog, uri);
  if (!skill) invalidParams(`No skill is served at ${uri}`);
  return cacheableComplete({
    skill: protocolSkillEntry(skill),
  });
}

function resourceName(skill, file) {
  if (file.relativePath === SKILL_MD) return skill.frontmatter.name;
  return `${skill.skillPath}/${file.relativePath}`;
}

export function attachSkillsExtension(mcpServer, catalog, { pageSize } = {}) {
  if (!mcpServer?.server) throw new Error("attachSkillsExtension requires an McpServer");
  mcpServer.server.registerCapabilities(skillsExtensionCapabilities());
  mcpServer.server.setRequestHandler(ListSkillsRequestSchema, (request) => (
    skillsListResult(catalog, request.params, { pageSize })
  ));
  mcpServer.server.setRequestHandler(GetSkillRequestSchema, (request) => (
    skillsGetResult(catalog, request.params)
  ));
  for (const skill of catalog.skills) {
    for (const file of skill.files) {
      mcpServer.registerResource(
        resourceName(skill, file),
        file.uri,
        {
          mimeType: file.mimeType,
          description: file.relativePath === SKILL_MD ? skill.frontmatter.description : undefined,
        },
        async (uri) => ({
          contents: [{
            uri: String(uri),
            mimeType: file.mimeType,
            text: file.text,
          }],
        }),
      );
    }
  }
  return mcpServer;
}

const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"),
).version;

export function defaultSkillsServerInfo() {
  return {
    name: "samedaydesk-skills",
    version: PACKAGE_VERSION,
  };
}

export function createSkillsMcpServer(catalog, {
  serverInfo = defaultSkillsServerInfo(),
  pageSize,
  instructions,
} = {}) {
  const names = catalog.names.join(", ");
  const uris = catalog.skills.map((skill) => skill.uri).join(", ");
  const server = new McpServer(serverInfo, {
    capabilities: skillsExtensionCapabilities(),
    instructions: instructions ?? [
      "SameDayDesk Agent Skills over MCP (SEP-2640).",
      "Discovery methods skills/list and skills/get are unpaid.",
      `Published skills: ${names}.`,
      `SKILL.md URIs: ${uris}.`,
      "Read file bytes with resources/read against a URI from a skill entry's resources set.",
    ].join(" "),
  });
  attachSkillsExtension(server, catalog, { pageSize });
  return server;
}

export function createSdsSkillsMcpServer(options = {}) {
  const catalog = options.catalog ?? loadSkillCatalog({
    skillsRoot: options.skillsRoot,
    names: options.names,
  });
  return {
    catalog,
    server: createSkillsMcpServer(catalog, options),
  };
}

export function applySdsSkillsExtension(mcpServer, options = {}) {
  const catalog = options.catalog ?? loadSkillCatalog({
    skillsRoot: options.skillsRoot,
    names: options.names,
  });
  attachSkillsExtension(mcpServer, catalog, { pageSize: options.pageSize });
  return catalog;
}
