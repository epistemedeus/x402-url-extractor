import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PLUGIN_ROOT, "../..");
const PLUGIN_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
).version;
const LOCAL_VERSION = JSON.parse(
  readFileSync(join(PLUGIN_ROOT, "plugin.json"), "utf8"),
).version;
const EXPECTED_LIVE_VERSION = process.env.SAMEDAYDESK_EXPECTED_LIVE_VERSION ?? null;
if (EXPECTED_LIVE_VERSION !== null && !VERSION_PATTERN.test(EXPECTED_LIVE_VERSION)) {
  throw new Error("SAMEDAYDESK_EXPECTED_LIVE_VERSION must be a non-empty x.y.z version");
}
const liveTest = EXPECTED_LIVE_VERSION === null ? test.skip : test;
const SOURCE_HEADER = "X-SameDayDesk-Agent-Source";
const SOURCE_VALUE = "agent-plugins-v1";
const PRODUCT_SKILL_SHA256 = "594a745ae7442ce013fb0013e289247e583850ade75c56bce453e48e668a47a0";
const PLUGIN_SCHEMA_SHA256 = "0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883";
const MCP_SCHEMA_SHA256 = "6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb";
const NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SKILL_NAME_PATTERN = /^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLUGIN_TOP_LEVEL = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);
const EXPECTED_TOOLS = [
  "extract",
  "read",
  "scan",
  "schemaforge",
  "enrich",
  "wallet_enrich",
  "deep_audit",
  "morpho_position",
  "morpho_protection",
  "morpho_market_underwrite",
  "morpho_preliquidation_replay",
  "opportunity_preflight",
  "agent_discoverability_audit",
  "payment_offer_preflight",
  "seller_integrity_audit",
  "monitor",
  "contract_qualified_search",
  "agent_surface_budget_audit",
  "settlement_proof",
  "transaction_receipt",
  "solana_transaction_receipt",
  "wallet_policy_conformance",
  "stateful_wallet_policy_conformance",
];
const FORBIDDEN_SUBSTRINGS = [
  "2026-07-28",
  "Mcp-Method",
  "Authorization",
  "X-PAYMENT",
  "PAYMENT-SIGNATURE",
  "Bearer ",
  "api_key",
  "api-key",
  "plugin_asdk_app",
  "awesome-copilot",
];
const CREDENTIAL_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-api-token",
  "api-key",
  "x-payment",
  "payment-signature",
  "x-payment-signature",
]);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readJson(name) {
  const text = readFileSync(join(PLUGIN_ROOT, name), "utf8");
  assert.equal(text.includes("\uFEFF"), false, `${name} must not have a BOM`);
  const value = JSON.parse(text);
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value;
}

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const resolved = resolve(full);
      assert.ok(resolved === root || resolved.startsWith(root + sep), `path escaped plugin root: ${full}`);
      if (entry.isSymbolicLink()) {
        throw new Error(`symlink not allowed in plugin package: ${relative(root, full)}`);
      }
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files;
}

function parseSkill(markdown) {
  assert.ok(markdown.startsWith("---\n"), "SKILL.md must start with YAML frontmatter");
  const end = markdown.indexOf("\n---\n", 4);
  assert.ok(end > 0, "SKILL.md frontmatter must close");
  const frontmatter = markdown.slice(4, end);
  const body = markdown.slice(end + 5);
  const fields = {};
  for (const line of frontmatter.split("\n")) {
    const match = /^(name|description|license):\s*(.*)$/.exec(line);
    assert.ok(match, `unexpected frontmatter line: ${line}`);
    fields[match[1]] = match[2];
  }
  return { fields, body, frontmatter };
}

function assertHttpsUrl(value, label) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:", `${label} must be HTTPS`);
  assert.equal(url.username, "", `${label} must not contain userinfo`);
  assert.equal(url.password, "", `${label} must not contain userinfo`);
  assert.equal(url.hash, "", `${label} must not contain a fragment`);
  return url;
}

function parseSseJson(text, label) {
  const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const raw = dataLines.length ? dataLines.at(-1).slice(6) : text;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${label} did not return JSON or JSON SSE data`);
  }
  if (payload?.error) {
    throw new Error(`${label} JSON-RPC error ${payload.error.code}: ${payload.error.message}`);
  }
  return payload;
}

async function postRpc(method, params, id) {
  const response = await fetch(LIVE_MCP_URL, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "user-agent": `samedaydesk-x402-plugin-test/${LOCAL_VERSION}`,
      [SOURCE_HEADER]: SOURCE_VALUE,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert.equal(response.ok, true, `${method} HTTP ${response.status}`);
  const text = await response.text();
  assert.ok(Buffer.byteLength(text, "utf8") <= 1_000_000, `${method} response too large`);
  return { response, payload: parseSseJson(text, method) };
}

test("plugin.json matches Agent Plugins 1.0 closed manifest", () => {
  const manifest = readJson("plugin.json");
  for (const key of Object.keys(manifest)) {
    assert.ok(PLUGIN_TOP_LEVEL.has(key), `unknown plugin.json field: ${key}`);
  }
  assert.equal(manifest.$schema, PLUGIN_SCHEMA_ID);
  assert.equal(manifest.name, "samedaydesk-x402");
  assert.ok(manifest.name.length >= 1 && manifest.name.length <= 64);
  assert.match(manifest.name, NAME_PATTERN);
  assert.match(manifest.version, VERSION_PATTERN);
  assert.equal(manifest.version, PACKAGE_VERSION);
  assert.equal(typeof manifest.description, "string");
  assert.ok(manifest.description.length > 0);
  assert.equal(manifest.homepage, "https://agents.samedaydesk.com/");
  assert.equal(manifest.repository, "https://github.com/epistemedeus/x402-url-extractor");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.author, undefined);
  assert.equal(manifest.keywords, undefined);
  assert.equal(manifest.extensions, undefined);
  assertHttpsUrl(manifest.homepage, "homepage");
  assertHttpsUrl(manifest.repository, "repository");
});

test("mcp.json pins live streamable-http SameDayDesk without credentials", () => {
  const config = readJson("mcp.json");
  assert.deepEqual(Object.keys(config).sort(), ["$schema", "mcpServers"]);
  assert.equal(config.$schema, MCP_SCHEMA_ID);
  assert.deepEqual(Object.keys(config.mcpServers), ["samedaydesk"]);
  const server = config.mcpServers.samedaydesk;
  assert.deepEqual(Object.keys(server).sort(), ["headers", "type", "url"]);
  assert.equal(server.type, "streamable-http");
  assert.equal(server.url, LIVE_MCP_URL);
  const url = assertHttpsUrl(server.url, "mcp url");
  assert.equal(url.pathname, "/mcp");
  assert.equal(url.hostname, "agents.samedaydesk.com");
  const headerNames = Object.keys(server.headers);
  assert.deepEqual(headerNames, [SOURCE_HEADER]);
  assert.equal(server.headers[SOURCE_HEADER], SOURCE_VALUE);
  const seen = new Set();
  for (const name of headerNames) {
    const folded = name.toLowerCase();
    assert.equal(seen.has(folded), false, `duplicate header ${name}`);
    seen.add(folded);
    assert.equal(CREDENTIAL_HEADER_NAMES.has(folded), false, `credential header ${name}`);
    assert.match(name, /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/);
    assert.equal(typeof server.headers[name], "string");
    assert.ok(server.headers[name].length > 0);
    assert.equal(/\r|\n/.test(server.headers[name]), false);
  }
  assert.equal("command" in server, false);
  assert.equal("env" in server, false);
  assert.equal("oauth" in server, false);
  assert.equal("protocolVersion" in server, false);
});

test("official 1.0.0 schemas are vendored with pinned hashes", () => {
  const pluginSchema = readFileSync(join(PLUGIN_ROOT, "test/official-schemas/plugin.schema.json"));
  const mcpSchema = readFileSync(join(PLUGIN_ROOT, "test/official-schemas/mcp.schema.json"));
  assert.equal(sha256(pluginSchema), PLUGIN_SCHEMA_SHA256);
  assert.equal(sha256(mcpSchema), MCP_SCHEMA_SHA256);
  assert.equal(JSON.parse(pluginSchema).$id, PLUGIN_SCHEMA_ID);
  assert.equal(JSON.parse(mcpSchema).$id, MCP_SCHEMA_ID);
  const sums = readFileSync(join(PLUGIN_ROOT, "test/official-schemas/SHA256SUMS"), "utf8");
  assert.match(sums, new RegExp(`${PLUGIN_SCHEMA_SHA256}  plugin\\.schema\\.json`));
  assert.match(sums, new RegExp(`${MCP_SCHEMA_SHA256}  mcp\\.schema\\.json`));
});

test("web-extract skill is the product skill and stays constructible", () => {
  const skillPath = join(PLUGIN_ROOT, "skills/web-extract/SKILL.md");
  const markdown = readFileSync(skillPath, "utf8");
  assert.equal(sha256(markdown), PRODUCT_SKILL_SHA256);
  const { fields, body } = parseSkill(markdown);
  assert.equal(fields.name, "web-extract");
  assert.match(fields.name, SKILL_NAME_PATTERN);
  assert.ok(fields.description.length <= 1024);
  assert.match(fields.description, /credential-free public webpage/);
  assert.match(body, /https:\/\/agents\.samedaydesk\.com\/extract\?url=/);
  assert.match(body, /https:\/\/agents\.samedaydesk\.com\/read\?url=/);
  assert.doesNotMatch(body, /Authorization:|X-PAYMENT|Bearer |api[_-]key/i);
  assert.doesNotMatch(markdown, /allowed-tools/);
  assert.doesNotMatch(markdown, /2026-07-28/);
});

test("package files stay inside the plugin root and omit secrets or 2026-07-28 claims", () => {
  const files = walkFiles(PLUGIN_ROOT);
  const relativeFiles = files.map((file) => relative(PLUGIN_ROOT, file).split(sep).join("/")).sort();
  assert.ok(relativeFiles.includes("plugin.json"));
  assert.ok(relativeFiles.includes("mcp.json"));
  assert.ok(relativeFiles.includes("skills/web-extract/SKILL.md"));
  assert.ok(relativeFiles.includes("README.md"));
  assert.ok(relativeFiles.includes("LICENSE"));
  const portable = ["plugin.json", "mcp.json", "skills/web-extract/SKILL.md", "LICENSE"];
  for (const name of portable) {
    const text = readFileSync(join(PLUGIN_ROOT, name), "utf8");
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      assert.equal(text.includes(needle), false, `${name} contains ${needle}`);
    }
  }
  const readme = readFileSync(join(PLUGIN_ROOT, "README.md"), "utf8");
  const repositoryReadme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  assert.match(readme, /Not submitted to Awesome Copilot/);
  assert.match(readme, /Not dual-stack MCP `2026-07-28`/);
  assert.match(readme, /Do not send `Mcp-Method`/);
  assert.match(readme, /## Install from the default branch/);
  assert.match(readme, /git clone https:\/\/github\.com\/epistemedeus\/x402-url-extractor\.git/);
  assert.match(readme, /copilot plugin install epistemedeus\/x402-url-extractor:plugins\/samedaydesk-x402/);
  for (const stale of ["recut/", "--branch", "Default master does not", "on this branch"]) {
    assert.equal(readme.includes(stale), false, `plugin README contains stale landing copy: ${stale}`);
    assert.equal(repositoryReadme.includes(stale), false, `repository README contains stale landing copy: ${stale}`);
  }
  assert.doesNotMatch(readme, /plugin_asdk_app/);
  const stats = statSync(join(PLUGIN_ROOT, "plugin.json"));
  assert.equal(stats.isFile(), true);
  assert.equal(statSync(join(PLUGIN_ROOT, "mcp.json")).isFile(), true);
  assert.equal(statSync(join(PLUGIN_ROOT, "skills")).isDirectory(), true);
});

liveTest("unpaid initialize-era initialize and tools/list return 23 live tools", async () => {
  const initialize = await postRpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "samedaydesk-x402-plugin-test", version: EXPECTED_LIVE_VERSION },
  }, 1);
  const result = initialize.payload.result;
  assert.equal(result.protocolVersion, "2025-11-25");
  assert.equal(result.serverInfo.name, "x402-data-gateway");
  assert.equal(result.serverInfo.version, EXPECTED_LIVE_VERSION);
  assert.notEqual(result.protocolVersion, "2026-07-28");

  const listed = await postRpc("tools/list", {}, 2);
  const tools = listed.payload.result.tools;
  assert.equal(Array.isArray(tools), true);
  const names = tools.map((tool) => tool.name);
  assert.equal(names.length, 23);
  assert.deepEqual(names, EXPECTED_TOOLS);
  assert.ok(names.includes("extract"));
});
