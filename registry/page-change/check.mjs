// Offline publisher check for the free page-change Registry descriptor.
// It does not log in, publish, or call a hosted tool.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

export const REGISTRY_SCHEMA_URL = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
export const REGISTRY_SCHEMA_SHA256 = "3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0";
export const DESCRIPTOR_VERSION = "1.0.0";
export const DESCRIPTOR_NAME = "io.github.epistemedeus/page-change";
export const DESCRIPTOR_NAMESPACE = "io.github.epistemedeus";
export const DESCRIPTOR_TITLE = "Page Change";
export const DESCRIPTOR_DESCRIPTION = "Free compare_page_observations for two held JSON pages. No fetch, wallet, or payment.";
export const PAID_NAME = "io.github.epistemedeus/x402-data-gateway";
export const PAID_REMOTE = "https://agents.samedaydesk.com/mcp";
export const PUBLIC_ORIGIN = "https://agents.samedaydesk.com";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function schemaDocument() {
  const bytes = readFileSync(path.join(here, "server.schema.json"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== REGISTRY_SCHEMA_SHA256) fail("schema_drift", `vendored schema sha256 ${sha256}`);
  const schema = JSON.parse(bytes.toString("utf8"));
  if (schema.$id !== REGISTRY_SCHEMA_URL) fail("schema_drift", `schema $id ${schema.$id}`);
  return schema;
}

function exportedString(source, name) {
  const match = new RegExp(`export const ${name} = "([^"]*)";`).exec(source);
  if (!match) fail("source_contract", `missing ${name}`);
  return match[1];
}

export function profileContract() {
  const source = readFileSync(path.join(repoRoot, "page-change-mcp.mjs"), "utf8");
  const route = exportedString(source, "PAGE_CHANGE_MCP_PATH");
  const tool = exportedString(source, "PAGE_CHANGE_MCP_TOOL");
  const serverName = exportedString(source, "PAGE_CHANGE_MCP_SERVER_NAME");
  const instructions = exportedString(source, "PAGE_CHANGE_MCP_INSTRUCTIONS");
  if (route !== "/mcp/page-change") fail("source_contract", `route ${route}`);
  if (tool !== "compare_page_observations") fail("source_contract", `tool ${tool}`);
  if (serverName !== "samedaydesk-page-compare") fail("source_contract", `server name ${serverName}`);
  if (!instructions.includes(tool) || !instructions.includes("Do not fetch") || !instructions.includes("take payment")) {
    fail("source_contract", "instructions no longer state the single free tool");
  }
  if (!source.includes("version: SERVICE_VERSION")) fail("source_contract", "initialize version is not SERVICE_VERSION");
  const plugin = readJson(path.join(repoRoot, "plugins/samedaydesk-page-compare/mcp.json"));
  const remote = plugin.mcpServers?.["page-compare"];
  const url = `${PUBLIC_ORIGIN}${route}`;
  if (!remote || remote.type !== "streamable-http" || remote.url !== url) {
    fail("source_contract", "draft plugin remote does not match the hosted free profile");
  }
  return { route, tool, serverName, instructions, url };
}

export function buildDescriptor() {
  const contract = profileContract();
  return {
    $schema: REGISTRY_SCHEMA_URL,
    name: DESCRIPTOR_NAME,
    title: DESCRIPTOR_TITLE,
    description: DESCRIPTOR_DESCRIPTION,
    version: DESCRIPTOR_VERSION,
    websiteUrl: `${PUBLIC_ORIGIN}/`,
    repository: {
      url: "https://github.com/epistemedeus/x402-url-extractor",
      source: "github",
    },
    remotes: [
      {
        type: "streamable-http",
        url: contract.url,
      },
    ],
  };
}

function schemaRules(schema) {
  const detail = schema.definitions.ServerDetail.properties;
  const remote = schema.definitions.StreamableHttpTransport.properties;
  return {
    required: schema.definitions.ServerDetail.required,
    descriptionMin: detail.description.minLength,
    descriptionMax: detail.description.maxLength,
    namePattern: new RegExp(detail.name.pattern),
    nameMin: detail.name.minLength,
    nameMax: detail.name.maxLength,
    titleMax: detail.title.maxLength,
    versionMax: detail.version.maxLength,
    urlPattern: new RegExp(remote.url.pattern),
    transportEnum: remote.type.enum,
  };
}

function pathname(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "";
  }
}

export function refuseEquivalentRemotes(candidate) {
  const remotes = Array.isArray(candidate?.remotes) ? candidate.remotes : [];
  const urls = remotes.map((remote) => remote?.url).filter((url) => typeof url === "string");
  const hasPaid = urls.includes(PAID_REMOTE) || urls.some((url) => pathname(url) === "/mcp");
  const hasFree = urls.some((url) => pathname(url) === "/mcp/page-change");
  if (hasPaid && hasFree) {
    fail("equivalent_remotes", "paid /mcp and free /mcp/page-change expose different tool sets and cannot be remotes of one server");
  }
  if (candidate?.name === PAID_NAME && hasFree) {
    fail("equivalent_remotes", "the paid server name cannot advertise the free profile");
  }
  if (candidate?.name === DESCRIPTOR_NAME && hasPaid) {
    fail("equivalent_remotes", "the free server name cannot advertise the paid catalog");
  }
}

export function assertFreeDescriptor(descriptor, { serviceVersion, schema = schemaDocument(), contract = profileContract() } = {}) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) fail("descriptor", "not an object");
  if ("packages" in descriptor) fail("packages", "this profile is remote-only");
  if ("icons" in descriptor || "_meta" in descriptor) fail("extra", "smallest descriptor omits icons and _meta");
  const keys = Object.keys(descriptor);
  if (keys.slice().sort().join(",") !== "$schema,description,name,remotes,repository,title,version,websiteUrl") {
    fail("descriptor_keys", keys.join(","));
  }
  const rules = schemaRules(schema);
  if (descriptor.$schema !== REGISTRY_SCHEMA_URL) fail("schema_url", String(descriptor.$schema));
  for (const key of rules.required) {
    if (typeof descriptor[key] !== "string" || descriptor[key].length === 0) fail("required", key);
  }
  if (
    typeof descriptor.name !== "string"
    || descriptor.name.length < rules.nameMin
    || descriptor.name.length > rules.nameMax
    || !rules.namePattern.test(descriptor.name)
  ) fail("name", String(descriptor.name));
  if (!descriptor.name.startsWith(`${DESCRIPTOR_NAMESPACE}/`)) fail("namespace", descriptor.name);
  if (descriptor.name === PAID_NAME) fail("paid_identity", "free profile reused the paid server name");
  if (descriptor.name !== DESCRIPTOR_NAME) fail("name", descriptor.name);
  if (typeof descriptor.title !== "string" || descriptor.title.length < 1 || descriptor.title.length > rules.titleMax) {
    fail("title", String(descriptor.title));
  }
  if (descriptor.title !== DESCRIPTOR_TITLE) fail("title", descriptor.title);
  if (typeof descriptor.description !== "string") fail("description", "missing");
  if (descriptor.description.length < rules.descriptionMin || descriptor.description.length > rules.descriptionMax) {
    fail("description_length", String(descriptor.description.length));
  }
  if (/\b(usdc|x402|extract|trial_read|paid|wallet required|payment required)\b/i.test(descriptor.description)) {
    fail("paid_claim", descriptor.description);
  }
  if (!descriptor.description.includes(contract.tool) || !/\bfree\b/i.test(descriptor.description) || !/\bno\b[\s\S]*payment/i.test(descriptor.description)) {
    fail("free_scope", descriptor.description);
  }
  if (descriptor.description !== DESCRIPTOR_DESCRIPTION) fail("description", "description drifted");
  if (typeof descriptor.version !== "string" || descriptor.version.length > rules.versionMax) fail("descriptor_version", String(descriptor.version));
  if (/[\^~><*]|\blatest\b|\d+\.x\b/i.test(descriptor.version)) fail("version_range", descriptor.version);
  if (descriptor.version !== DESCRIPTOR_VERSION) fail("descriptor_version", descriptor.version);
  if (descriptor.websiteUrl !== `${PUBLIC_ORIGIN}/`) fail("website", String(descriptor.websiteUrl));
  const repository = descriptor.repository;
  if (!repository || typeof repository !== "object" || Object.keys(repository).sort().join(",") !== "source,url") {
    fail("repository", "expected url and source only");
  }
  if (repository.url !== "https://github.com/epistemedeus/x402-url-extractor" || repository.source !== "github") {
    fail("repository", "repository identity drifted");
  }
  if (!Array.isArray(descriptor.remotes) || descriptor.remotes.length !== 1) fail("remotes", "exactly one remote");
  const remote = descriptor.remotes[0];
  if (!remote || typeof remote !== "object") fail("remote", "missing");
  if (remote.headers || remote.variables) fail("remote_auth", "free profile publishes no headers or URL variables");
  if (Object.keys(remote).sort().join(",") !== "type,url") fail("remote_keys", Object.keys(remote).join(","));
  if (remote.type !== "streamable-http" || !rules.transportEnum.includes(remote.type)) fail("transport", String(remote.type));
  if (typeof remote.url !== "string" || !rules.urlPattern.test(remote.url)) fail("url_pattern", String(remote.url));
  let parsed;
  try {
    parsed = new URL(remote.url);
  } catch {
    fail("url", String(remote.url));
  }
  if (parsed.protocol !== "https:") fail("https", remote.url);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) fail("url_parts", remote.url);
  if (remote.url === PAID_REMOTE || pathname(remote.url) === "/mcp") fail("paid_remote", remote.url);
  if (remote.url !== contract.url) fail("profile_url", remote.url);
  refuseEquivalentRemotes(descriptor);
  return descriptor;
}

export function assertPaidIdentity(serviceVersion, {
  paid = readJson(path.join(repoRoot, "server.json")),
  lock = readJson(path.join(repoRoot, "package-lock.json")),
} = {}) {
  if (paid.name !== PAID_NAME) fail("paid_name", paid.name);
  if (paid.version !== serviceVersion) fail("paid_version", `${paid.version} != ${serviceVersion}`);
  if (!Array.isArray(paid.remotes) || paid.remotes.length !== 1 || paid.remotes[0].url !== PAID_REMOTE) {
    fail("paid_remote", "paid listing remote drifted");
  }
  refuseEquivalentRemotes(paid);
  if (lock.version !== serviceVersion || lock.packages?.[""]?.version !== serviceVersion) {
    fail("lock_version", "package lock version drifted");
  }
}

export function canonicalDescriptorText() {
  return `${JSON.stringify(buildDescriptor(), null, 2)}\n`;
}

export function checkAll() {
  const schema = schemaDocument();
  const serviceVersion = readJson(path.join(repoRoot, "package.json")).version;
  if (typeof serviceVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(serviceVersion)) {
    fail("runtime_version", "package.json version is not a runtime version");
  }
  assertPaidIdentity(serviceVersion);
  const contract = profileContract();
  const committedText = readFileSync(path.join(here, "server.json"), "utf8");
  if (committedText !== canonicalDescriptorText()) fail("recovery", "committed server.json is not the source builder output");
  const committed = JSON.parse(committedText);
  assertFreeDescriptor(committed, { serviceVersion, schema, contract });
  return {
    ok: true,
    name: committed.name,
    descriptorVersion: committed.version,
    runtimeVersion: serviceVersion,
    remote: contract.url,
    tool: contract.tool,
    schema: REGISTRY_SCHEMA_URL,
    schemaSha256: REGISTRY_SCHEMA_SHA256,
  };
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  try {
    const result = checkAll();
    process.stdout.write(`ok name=${result.name} descriptor=${result.descriptorVersion} runtime=${result.runtimeVersion} remote=${result.remote} tool=${result.tool}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || "check_failed"} ${error.message}\n`);
    process.exit(1);
  }
}
