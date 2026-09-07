import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "samedaydesk-extract");
const AGENT_PLUGIN_ROOT = join(REPO_ROOT, "plugins", "samedaydesk-x402");
const MARKETPLACE_NAME = "samedaydesk-claude";
const PLUGIN_NAME = "samedaydesk-extract";
const PLUGIN_VERSION = "0.1.0";
const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
const LIVE_EXTRACT_URL = "https://agents.samedaydesk.com/extract";
const LIVE_HOMEPAGE = "https://agents.samedaydesk.com/";
const SOURCE_HEADER = "X-SameDayDesk-Agent-Source";
const CLAIMED_SOURCE_VALUE = "claude-code-marketplace-v1";
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PORTABLE_PLUGIN_FILES = [
  ".claude-plugin/plugin.json",
  ".mcp.json",
  "skills/web-extract/SKILL.md",
  "README.md",
  "LICENSE",
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
  "private key",
  "wallet seed",
  "headersHelper",
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
const RESERVED_MARKETPLACE_NAMES = [
  "claude-code-marketplace",
  "claude-code-plugins",
  "claude-plugins-official",
  "claude-plugins-community",
  "claude-community",
  "anthropic-marketplace",
  "anthropic-plugins",
  "agent-skills",
  "anthropic-agent-skills",
  "knowledge-work-plugins",
  "life-sciences",
  "claude-for-legal",
  "claude-for-financial-services",
  "financial-services-plugins",
  "first-party-plugins",
  "healthcare",
];

function readUtf8(path) {
  const text = readFileSync(path, "utf8");
  assert.equal(text.includes("\uFEFF"), false, `${path} must not have a BOM`);
  return text;
}

function readJson(path) {
  return JSON.parse(readUtf8(path));
}

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const resolved = resolve(full);
      assert.ok(resolved === root || resolved.startsWith(root + sep), `path escaped root: ${full}`);
      if (entry.isSymbolicLink()) throw new Error(`symlink not allowed: ${relative(root, full)}`);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files.sort();
}

function posixRel(root, file) {
  return relative(root, file).split(sep).join("/");
}

function parseSkill(markdown) {
  assert.ok(markdown.startsWith("---\n"), "SKILL.md must start with YAML frontmatter");
  const end = markdown.indexOf("\n---\n", 4);
  assert.ok(end > 0, "SKILL.md frontmatter must close");
  const frontmatter = markdown.slice(4, end);
  const body = markdown.slice(end + 5);
  const fields = {};
  for (const line of frontmatter.split("\n")) {
    if (!line) continue;
    const match = /^(name|description):\s*(.*)$/.exec(line);
    assert.ok(match, `unexpected frontmatter line: ${line}`);
    fields[match[1]] = match[2];
  }
  return { fields, body };
}

function assertHttpsUrl(value, label) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:", `${label} must be HTTPS`);
  assert.equal(url.username, "", `${label} must not contain userinfo`);
  assert.equal(url.password, "", `${label} must not contain userinfo`);
  assert.equal(url.hash, "", `${label} must not contain a fragment`);
  return url;
}

function containsForbidden(text) {
  return FORBIDDEN_SUBSTRINGS.filter((needle) => text.includes(needle));
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

test("marketplace.json is at the repository-discoverable root", () => {
  const path = join(REPO_ROOT, ".claude-plugin", "marketplace.json");
  const catalog = readJson(path);
  assert.equal(catalog.name, MARKETPLACE_NAME);
  assert.match(catalog.name, NAME_PATTERN);
  assert.equal(RESERVED_MARKETPLACE_NAMES.includes(catalog.name), false);
  assert.equal(catalog.version, PLUGIN_VERSION);
  assert.equal(catalog.owner.name, "SameDayDesk");
  assert.equal(catalog.owner.email, "contact@samedaydesk.com");
  assertHttpsUrl(catalog.owner.url, "owner.url");
  assert.equal(catalog.plugins.length, 1);
  const entry = catalog.plugins[0];
  assert.equal(entry.name, PLUGIN_NAME);
  assert.equal(entry.source, "./plugins/samedaydesk-extract");
  assert.equal(entry.source.startsWith("./"), true);
  assert.equal(entry.source.includes(".."), false);
  assert.equal(entry.version, PLUGIN_VERSION);
  assert.equal(entry.strict, true);
  assert.equal(entry.mcpServers, "./.mcp.json");
  assert.equal(entry.homepage, LIVE_HOMEPAGE);
  assert.equal(entry.repository, "https://github.com/epistemedeus/x402-url-extractor");
  assertHttpsUrl(entry.homepage, "plugin homepage");
  assertHttpsUrl(entry.repository, "plugin repository");
  assert.equal("hooks" in entry, false);
  assert.equal("headersHelper" in entry, false);
  assert.equal(isFile(join(REPO_ROOT, "plugin.json")), false);
  assert.equal(isDir(join(REPO_ROOT, ".claude-plugin", "skills")), false);
  assert.ok(readFileSync(path).byteLength < 16_384);
});

test("plugin.json is a Claude Code manifest, not Agent Plugins 1.0", () => {
  const manifest = readJson(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"));
  assert.equal(manifest.name, PLUGIN_NAME);
  assert.equal(manifest.version, PLUGIN_VERSION);
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.$schema, "https://json.schemastore.org/claude-code-plugin-manifest.json");
  assert.equal(manifest.repository, "https://github.com/epistemedeus/x402-url-extractor");
  assert.equal("mcpServers" in manifest, false);
  assert.equal("hooks" in manifest, false);
  assert.equal("userConfig" in manifest, false);
  assert.equal("bin" in manifest, false);
  assert.equal(manifest.homepage, LIVE_HOMEPAGE);
  assert.doesNotMatch(JSON.stringify(manifest), /agent-plugins\.org/);
  assert.equal(isFile(join(PLUGIN_ROOT, "plugin.json")), false);
  assert.equal(isFile(join(PLUGIN_ROOT, "mcp.json")), false);
});

test("Agent Plugins 1.0 package remains a separate schema", () => {
  const manifest = readJson(join(AGENT_PLUGIN_ROOT, "plugin.json"));
  const mcp = readJson(join(AGENT_PLUGIN_ROOT, "mcp.json"));
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(manifest.name, "samedaydesk-x402");
  assert.equal(mcp.mcpServers.samedaydesk.type, "streamable-http");
  assert.equal(mcp.mcpServers.samedaydesk.headers[SOURCE_HEADER], "agent-plugins-v1");
  assert.equal(isFile(join(AGENT_PLUGIN_ROOT, ".claude-plugin", "plugin.json")), false);
  assert.equal(isFile(join(AGENT_PLUGIN_ROOT, ".mcp.json")), false);
});

test("plugin MCP config points at the canonical merchant without credentials", () => {
  const config = readJson(join(PLUGIN_ROOT, ".mcp.json"));
  assert.deepEqual(Object.keys(config), ["mcpServers"]);
  assert.deepEqual(Object.keys(config.mcpServers), ["samedaydesk"]);
  const server = config.mcpServers.samedaydesk;
  assert.equal(server.type, "http");
  assert.equal(server.url, LIVE_MCP_URL);
  const url = assertHttpsUrl(server.url, "mcp url");
  assert.equal(url.hostname, "agents.samedaydesk.com");
  assert.equal(url.pathname, "/mcp");
  assert.deepEqual(Object.keys(server.headers), [SOURCE_HEADER]);
  assert.equal(server.headers[SOURCE_HEADER], CLAIMED_SOURCE_VALUE);
  for (const name of Object.keys(server.headers)) {
    assert.equal(CREDENTIAL_HEADER_NAMES.has(name.toLowerCase()), false, name);
  }
  assert.equal("command" in server, false);
  assert.equal("env" in server, false);
  assert.equal("oauth" in server, false);
  assert.equal("headersHelper" in server, false);
});

test("web-extract skill keeps exact inputs, unpaid discovery, and separate payment authorization", () => {
  const markdown = readUtf8(join(PLUGIN_ROOT, "skills", "web-extract", "SKILL.md"));
  const { fields, body } = parseSkill(markdown);
  assert.equal(fields.name, "web-extract");
  assert.ok(fields.description.length > 0);
  assert.ok(fields.description.length <= 1024);
  assert.match(body, /Exact inputs/);
  assert.match(body, /Free discovery \(no payment\)/);
  assert.match(body, /Buyer payment authorization \(separate\)/);
  assert.match(body, new RegExp(`${LIVE_EXTRACT_URL}\\?url=`));
  assert.match(body, /openapi\.json/);
  assert.match(body, /tools\/list/);
  assert.match(body, /Do not hardcode a price/);
  assert.match(body, /explicitly authorizes/);
  assert.match(body, /pre-existing buyer-approved wallet policy/);
  assert.match(body, /do not ask the operator to approve/);
  assert.match(body, /Unknown payment outcomes require reconciliation/);
  assert.match(body, new RegExp(CLAIMED_SOURCE_VALUE));
  assert.match(body, /Do not assert that the\s+merchant allowlists/);
  assert.doesNotMatch(markdown, /0\.005/);
  assert.doesNotMatch(markdown, /allowed-tools/);
  assert.doesNotMatch(markdown, /X-PAYMENT|PAYMENT-SIGNATURE|Bearer |wallet seed/);
});

test("plugin is self-contained: five portable files and no extra components", () => {
  assert.equal(isDir(join(PLUGIN_ROOT, "hooks")), false);
  assert.equal(isDir(join(PLUGIN_ROOT, "agents")), false);
  assert.equal(isDir(join(PLUGIN_ROOT, "bin")), false);
  assert.equal(isFile(join(PLUGIN_ROOT, "settings.json")), false);
  const relativeFiles = walkFiles(PLUGIN_ROOT).map((file) => posixRel(PLUGIN_ROOT, file)).sort();
  assert.deepEqual(relativeFiles, [...PORTABLE_PLUGIN_FILES].sort());
  for (const name of [".claude-plugin/plugin.json", ".mcp.json", "LICENSE"]) {
    const text = readUtf8(join(PLUGIN_ROOT, name));
    assert.equal(containsForbidden(text).join(","), "", `${name} has forbidden substring`);
    assert.equal(text.includes("../"), false, `${name} has parent path`);
  }
  const skillText = readUtf8(join(PLUGIN_ROOT, "skills/web-extract/SKILL.md"));
  assert.equal(skillText.includes("../"), false);
  const mcp = readUtf8(join(PLUGIN_ROOT, ".mcp.json"));
  assert.equal(mcp.includes("${CLAUDE_PLUGIN_ROOT}"), false);
});

test("copy forbids a second paywall, global installer, and official-directory submission", () => {
  const rootReadme = readUtf8(join(REPO_ROOT, "README.md"));
  const pluginReadme = readUtf8(join(PLUGIN_ROOT, "README.md"));
  const claudeHeading = rootReadme.indexOf("## Claude Code marketplace");
  assert.ok(claudeHeading >= 0, "root README missing Claude Code marketplace section");
  const claudeSection = rootReadme.slice(claudeHeading);
  assert.match(rootReadme, /\/plugin marketplace add epistemedeus\/x402-url-extractor/);
  assert.match(rootReadme, /\/plugin install samedaydesk-extract@samedaydesk-claude/);
  assert.match(rootReadme, /npm run test:claude-marketplace/);
  assert.match(pluginReadme, /not a submission to `claude-plugins-official`/i);
  assert.match(pluginReadme, /https:\/\/agents\.samedaydesk\.com\/mcp/);
  assert.match(pluginReadme, /marketplace add "\$PWD" --scope user/);
  assert.match(pluginReadme, /unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN CLAUDE_API_KEY/);
  assert.match(pluginReadme, /install samedaydesk-extract@samedaydesk-claude --scope user --yes/);
  for (const text of [claudeSection, pluginReadme]) {
    assert.match(text, /CLAUDE_CONFIG_DIR=.*mktemp -d/);
    assert.match(text, /CLAUDE_CODE_PLUGIN_CACHE_DIR="\$CLAUDE_CONFIG_DIR\/plugins"/);
    assert.match(text, /unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN CLAUDE_API_KEY/);
  }
  for (const text of [claudeSection, pluginReadme]) {
    assert.doesNotMatch(text, /claude\.ai\/admin-settings\/directory\/submissions/);
    assert.doesNotMatch(text, /npx .*install/i);
    assert.doesNotMatch(text, /X-PAYMENT|PAYMENT-SIGNATURE|Bearer |wallet seed|headersHelper/);
    assert.doesNotMatch(text, /npm install -g |install.*global CLI/i);
  }
  const pkg = readJson(join(REPO_ROOT, "package.json"));
  assert.equal(pkg.scripts["test:claude-marketplace"], "node --test claude-code-marketplace.test.mjs");
  assert.equal(pkg.scripts["test:claude-marketplace:live"], "node --test claude-code-marketplace.live.test.mjs");
  assert.match(pkg.scripts.test, /claude-code-marketplace\.test\.mjs/);
  assert.doesNotMatch(pkg.scripts.test, /claude-code-marketplace\.live\.test\.mjs/);
});

test("claimed source is labeled claimed-only and is not an allowlist edit", () => {
  const catalog = readJson(join(REPO_ROOT, ".claude-plugin", "marketplace.json"));
  assert.equal(JSON.stringify(catalog).includes(CLAIMED_SOURCE_VALUE), false);
  const mcp = readJson(join(PLUGIN_ROOT, ".mcp.json"));
  assert.equal(mcp.mcpServers.samedaydesk.headers[SOURCE_HEADER], CLAIMED_SOURCE_VALUE);
  const skill = readUtf8(join(PLUGIN_ROOT, "skills/web-extract/SKILL.md"));
  const pluginReadme = readUtf8(join(PLUGIN_ROOT, "README.md"));
  for (const text of [skill, pluginReadme]) {
    assert.match(text, /claimed source/);
    assert.match(text, /not a credential|not authentication/i);
  }
  const telemetry = readUtf8(join(REPO_ROOT, "commerce-events.mjs"));
  assert.equal(telemetry.includes(CLAIMED_SOURCE_VALUE), false);
  assert.match(telemetry, /\["agent-skills-v1", "agent-skills"\]/);
  assert.doesNotMatch(telemetry, /claude-code-marketplace-v1/);
});

test("publication tree has no scratch, credentials, or extraKnownMarketplaces", () => {
  assert.equal(isDir(join(REPO_ROOT, ".scratch")), false);
  assert.equal(isFile(join(REPO_ROOT, ".claude", "settings.json")), false);
  assert.equal(isFile(join(REPO_ROOT, ".claude", "settings.local.json")), false);
  const gitignore = readUtf8(join(REPO_ROOT, ".gitignore"));
  assert.match(gitignore, /^\.scratch\/$/m);
  assert.match(gitignore, /^\.claude\/$/m);
  const npmignore = readUtf8(join(REPO_ROOT, ".npmignore"));
  assert.doesNotMatch(npmignore, /\.claude-plugin/);
  const dataDir = join(REPO_ROOT, "data");
  if (isDir(dataDir)) {
    const files = walkFiles(dataDir);
    assert.equal(files.length, 0, "merchant data/ must not ship files");
  }
});
