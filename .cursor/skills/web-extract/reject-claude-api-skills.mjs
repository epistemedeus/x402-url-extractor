#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(dir, "SKILL.md"), "utf8");
const runtime = JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8"));
const mcp = JSON.parse(readFileSync(join(dir, "mcp.json"), "utf8"));
const target = String(process.argv[2] || "claude-api-skills");

const claimsClaudeApiSkills = [
  /Claude API Skills/i,
  /container\.skills/,
  /Messages API Skills/i,
].some((pattern) => pattern.test(skill));
if (claimsClaudeApiSkills) {
  console.error("SKILL.md must not claim Claude API Skills can run network tools");
  process.exit(2);
}

const mcpUrl = mcp?.mcpServers?.samedaydesk?.url;
if (mcpUrl !== runtime.mcp.url) {
  console.error(`mcp.json url ${mcpUrl} does not match runtime.mcp.url ${runtime.mcp.url}`);
  process.exit(2);
}

const rejected = (runtime.rejectedRuntimes || []).find((entry) => entry.id === target);
if (rejected) {
  console.error(`rejected runtime ${target}: ${rejected.reason}`);
  process.exit(1);
}

if ((runtime.supportedRuntimes || []).includes(target)) {
  console.log(`supported runtime ${target}; mcp ${runtime.mcp.url}`);
  process.exit(0);
}

console.error(`unknown runtime ${target}`);
process.exit(2);
