#!/usr/bin/env node
// SkillGuard MCP server — exposes the scanner as an MCP tool so any agent (Claude, etc.) can
// vet a skill/plugin/MCP server before installing it. Zero-dependency: minimal JSON-RPC 2.0
// over stdio (newline-delimited). Static-only — never executes the scanned code.
//
//   Claude Code / client config:
//   { "mcpServers": { "skillguard": { "command": "npx", "args": ["-y", "github:epistemedeus/skillguard", "mcp"] } } }
//   (or run the `skillguard-mcp` bin directly)

import { analyze } from "./index.js";
import { scannerVersion } from "./version.js";
import readline from "node:readline";

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const ok = (id, r) => send({ jsonrpc: "2.0", id, result: r });
const err = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

const TOOL = {
  name: "scan_skill",
  description: "Statically scan a Claude Code skill, plugin, or MCP server (a local path or a git/GitHub URL) for malware patterns BEFORE installing it: secret/env exfiltration to suspicious hosts, install-time (pre/postinstall) hooks, obfuscated remote execution (eval(atob), base64|sh), prompt injection in tool descriptions/SKILL.md, committed binaries, and auto-approve/skip-permission configs. Static-only — it clones and reads files, never executes the target code, so scanning something malicious is safe. Returns a verdict (clean/suspicious/dangerous) with the flagged files.",
  inputSchema: {
    type: "object",
    properties: { target: { type: "string", description: "A local path or a git/GitHub URL to scan, e.g. https://github.com/owner/repo or ./my-skill" } },
    required: ["target"],
  },
};

const rl = readline.createInterface({ input: process.stdin });
rl.on("close", () => process.exit(0));
rl.on("line", (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: (params && params.protocolVersion) || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "skillguard", version: scannerVersion() },
      instructions: "Use scan_skill to vet a Claude Code skill, plugin, or MCP server before installing it.",
    });
  }
  if (method && method.startsWith("notifications/")) return; // notifications take no reply
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: [TOOL] });

  if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (name !== "scan_skill" && name !== "scan") return err(id, -32602, `Unknown tool: ${name}`);
    const target = args.target;
    if (!target || typeof target !== "string") return err(id, -32602, "Missing required 'target' (a local path or git URL)");
    try {
      const r = analyze(target);
      const out = [`SkillGuard verdict: ${r.verdict.toUpperCase()} — ${r.scanned} files scanned.`];
      if (r.dangers.length) { out.push("", `DANGER (${r.dangers.length}):`); for (const d of r.dangers) out.push(`  - [${d.rule}] ${d.file}: ${d.label}`); }
      if (r.warns.length) { out.push("", `REVIEW (${r.warns.length}):`); for (const w of r.warns) out.push(`  - [${w.rule}] ${w.file}: ${w.label}`); }
      if (!r.dangers.length && !r.warns.length) out.push("No known-malicious patterns found. Still review code from untrusted authors.");
      out.push("", "Static analysis only; heuristics can miss novel attacks. Deeper human audit at https://samedaydesk.com/skillguard");
      return ok(id, {
        content: [{ type: "text", text: out.join("\n") }],
        structuredContent: { verdict: r.verdict, scanned: r.scanned, dangers: r.dangers, warns: r.warns },
        isError: false,
      });
    } catch (e) {
      return ok(id, { content: [{ type: "text", text: `Scan failed: ${e.message}` }], isError: true });
    }
  }

  if (id !== undefined && id !== null) err(id, -32601, `Method not found: ${method}`);
});
