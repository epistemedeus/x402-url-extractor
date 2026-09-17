#!/usr/bin/env node
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
const SOURCE_HEADER = "X-SameDayDesk-Agent-Source";
const SOURCE_VALUE = "agent-skills-v1";
const MCP_TYPE = "http";
const MCP_PROTOCOL = "2025-11-25";

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function readRegularFile(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    fail(`cannot open ${path}: ${error.message}`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) fail(`${path} must be a regular file`);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function parseObject(path, bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be a JSON object`);
  }
  return value;
}

function headerMap(value, label) {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const out = {};
  const folded = new Set();
  for (const [name, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string" || headerValue.length === 0) {
      fail(`${label} ${name} must be a non-empty string`);
    }
    if (/\r|\n/.test(name) || /\r|\n/.test(headerValue)) {
      fail(`${label} ${name} must not contain CR or LF`);
    }
    const lower = name.toLowerCase();
    if (folded.has(lower)) fail(`${label} duplicate header ${name}`);
    folded.add(lower);
    if (CREDENTIAL_HEADER_NAMES.has(lower)) fail(`${label} forbids credential header ${name}`);
    out[name] = headerValue;
  }
  return out;
}

function sameHeaders(left, right) {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) && left[key] === right[key]);
}

function assertPinnedMcpUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} is not a URL`);
  }
  if (url.protocol !== "https:") fail(`${label} must be HTTPS`);
  if (url.username || url.password) fail(`${label} must not contain userinfo`);
  if (url.hash) fail(`${label} must not contain a fragment`);
  if (url.search) fail(`${label} must not contain a query`);
  if (url.hostname !== "agents.samedaydesk.com" || url.pathname !== "/mcp") {
    fail(`${label} must be ${LIVE_MCP_URL}`);
  }
  return LIVE_MCP_URL;
}

const dir = dirname(fileURLToPath(import.meta.url));
const skillPath = join(dir, "SKILL.md");
const runtimePath = join(dir, "runtime.json");
const mcpPath = join(dir, "mcp.json");
const skillBytes = readRegularFile(skillPath);
const skill = skillBytes.toString("utf8");
if (skill.includes("\uFEFF")) fail("SKILL.md must not have a BOM");
const runtime = parseObject(runtimePath, readRegularFile(runtimePath));
const mcp = parseObject(mcpPath, readRegularFile(mcpPath));
const target = process.argv.length >= 3 ? String(process.argv[2]) : "claude-api-skills";
if (/[\r\n]/.test(target)) fail("runtime id must be a single line");

const digest = createHash("sha256").update(skillBytes).digest("hex");
if (runtime.liveSkillSha256 !== digest) {
  fail(`SKILL.md sha256 ${digest} does not match runtime.liveSkillSha256 ${runtime.liveSkillSha256}`);
}

const claimsClaudeApiSkills = [
  /Claude API Skills/i,
  /container\.skills/,
  /Messages API Skills/i,
].some((pattern) => pattern.test(skill));
if (claimsClaudeApiSkills) {
  fail("SKILL.md must not claim Claude API Skills can run network tools");
}

if (/Authorization:|X-PAYMENT|PAYMENT-SIGNATURE|Bearer |api[_-]key/i.test(skill)) {
  fail("SKILL.md must not embed payment or credential headers");
}
if (skill.includes("2026-07-28") || skill.includes("Mcp-Method")) {
  fail("SKILL.md must not claim MCP 2026-07-28 transport");
}

const server = mcp.mcpServers?.samedaydesk;
if (server === null || typeof server !== "object" || Array.isArray(server)) {
  fail("mcp.json missing mcpServers.samedaydesk");
}
const runtimeMcp = runtime.mcp;
if (runtimeMcp === null || typeof runtimeMcp !== "object" || Array.isArray(runtimeMcp)) {
  fail("runtime.json missing mcp object");
}
if (server.type !== MCP_TYPE || runtimeMcp.type !== MCP_TYPE) {
  fail(`mcp type must be ${MCP_TYPE}, got mcp.json=${server.type} runtime=${runtimeMcp.type}`);
}
if (runtimeMcp.protocolVersion !== MCP_PROTOCOL) {
  fail(`runtime.mcp.protocolVersion must be ${MCP_PROTOCOL}, got ${runtimeMcp.protocolVersion}`);
}

const mcpUrl = assertPinnedMcpUrl(server.url, "mcp.json url");
const runtimeUrl = assertPinnedMcpUrl(runtimeMcp.url, "runtime.mcp.url");
if (mcpUrl !== runtimeUrl) {
  fail(`mcp.json url ${mcpUrl} does not match runtime.mcp.url ${runtimeUrl}`);
}

const mcpHeaders = headerMap(server.headers, "mcp.json headers");
const runtimeHeaders = headerMap(runtimeMcp.headers, "runtime.mcp.headers");
if (!sameHeaders(mcpHeaders, runtimeHeaders)) {
  fail("mcp.json headers do not match runtime.mcp.headers");
}
if (mcpHeaders[SOURCE_HEADER] !== SOURCE_VALUE) {
  fail(`source header must be ${SOURCE_VALUE}`);
}

const rejected = (Array.isArray(runtime.rejectedRuntimes) ? runtime.rejectedRuntimes : [])
  .find((entry) => entry && entry.id === target);
if (rejected) {
  console.error(`rejected runtime ${target}: ${rejected.reason}`);
  process.exit(1);
}

if ((Array.isArray(runtime.supportedRuntimes) ? runtime.supportedRuntimes : []).includes(target)) {
  console.log(`supported runtime ${target}; mcp ${runtimeUrl}`);
  process.exit(0);
}

fail(`unknown runtime ${target}`);
