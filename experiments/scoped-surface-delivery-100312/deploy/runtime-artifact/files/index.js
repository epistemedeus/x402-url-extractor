#!/usr/bin/env node
// SkillGuard — static security scanner for Claude Code skills, plugins, and MCP servers.
// It does STATIC analysis only: it clones (git clone, no install) and reads files. It NEVER
// installs dependencies, runs build/postinstall scripts, or executes any target code — so
// scanning a malicious package can't harm you. (That's the whole point.)
//
// Usage:
//   npx github:epistemedeus/skillguard <path-or-git-url>
//   npx github:epistemedeus/skillguard https://github.com/owner/repo
//   npx github:epistemedeus/skillguard ./my-skill
//   npx github:epistemedeus/skillguard ./my-skill --report skillguard-report.json
//   npx github:epistemedeus/skillguard --show-report skillguard-report.json
//
// Exit code: 0 = clean, 2 = suspicious, 3 = dangerous.
// report.js is loaded only for --report / --json / --show-report. mcp.js does not import it.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { escapeTerminal, redactUrl } from "./version.js";
import { labelFor } from "./rules.js";
import { classifySecretText } from "./secrets.js";

const RED = "\x1b[31m", YEL = "\x1b[33m", GRN = "\x1b[32m", DIM = "\x1b[2m", B = "\x1b[1m", R = "\x1b[0m", CY = "\x1b[36m";

// ---- detection rules -------------------------------------------------------
// severity: "danger" (red) | "warn" (yellow). Each rule scans a file's text.
// NOTE on accuracy: an MCP server legitimately reading an API key from env and calling that
// provider's API is NORMAL — flagging that alone produces false positives. So the high-severity
// rules require a *suspicious destination* or *whole-environment exfiltration*, not just
// "reads a key and makes a request."
const SENSITIVE_ENV = /\b(ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|STRIPE_SECRET_KEY|SSH_PRIVATE_KEY|GOOGLE_APPLICATION_CREDENTIALS|HF_TOKEN|SLACK_TOKEN)\b/;
const NET_CALL = /\b(fetch|axios|got|node-fetch|requests\.(get|post)|urllib|http\.request|https\.request|XMLHttpRequest|curl|wget|nc |netcat|Invoke-WebRequest)\b/i;
// Genuinely suspicious exfil destinations (named services attackers use). Raw IPs are NOT
// included — legit configs use them (localhost, internal hosts) and they false-positive badly.
// Only services that are almost never present in legitimate production code. (Telegram/ngrok
// are intentionally EXCLUDED — they're heavily dual-use: tons of legit bots call api.telegram.org,
// so flagging them produces false positives. Exfil over Telegram is real but undetectable by
// hostname alone; that's what the paid human audit is for.)
const SUSPICIOUS_HOST = /(pastebin\.com|hastebin\.com|requestbin|webhook\.site|pipedream\.net|burpcollaborator|interactsh|\.oast\.|discord(app)?\.com\/api\/webhooks|smtp2go|mailgun.{0,20}exfil)/i;
// Serializing the WHOLE environment. NB: `{...process.env}` and `Object.keys(process.env)` are
// EXCLUDED — they're the normal idiom for passing env to a child process / listing var names, and
// flag legit code constantly. We only match a full-env serialization that could become a payload.
const ENV_DUMP = /(JSON\.stringify\(\s*process\.env\s*\)|json\.dumps\(\s*(dict\()?os\.environ|\/proc\/self\/environ|env\s*>\s*\/tmp|base64.{0,15}\$\(\s*env\s*\)|printenv\s*\|\s*(curl|nc|wget))/i;
const OBFUSC = /(eval\s*\(\s*(atob|Buffer\.from|decodeURIComponent)|exec\s*\(\s*atob|child_process['"]\)\.exec\w*\(\s*atob|base64\s+-d\s*\|\s*(ba)?sh|FromBase64String\([^)]*\)\s*\|\s*iex|powershell[^\n]*-enc(odedcommand)? )/i;
const SHELL_PIPE = /(curl|wget)[^\n|]+\|\s*(ba)?sh\b/i; // `curl X | bash` — danger in code/scripts, only a note in install docs
const CODE_FILE = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|sh|bash|zsh|ps1)$|package\.json$/i;
const INSTRUCTION_FILE = /(^|\/)(SKILL|AGENTS?|CLAUDE|README\.skill|system|prompt)\.(md|mdx|txt)$|\.mcp\.json$/i;
const DOC_FILE = /\.(md|mdx|txt|rst)$/i;
const PROMPT_INJ = /(ignore (all )?(previous|prior|above) (instructions|prompts|rules)|do not (tell|inform|reveal|mention|notify).{0,25}(the )?(user|human|operator)|exfiltrat\w+|send (the |your )?(\.?env|environment variables|secrets|api[_ ]?keys|credentials|\.env file)|read .{0,15}\.env.{0,40}(send|post|upload|exfil)|always (auto-?)?approve (all|every|any)|disregard (the |your )?(rules|guidelines|safety|instructions))/i;
const INSTALL_HOOK = /"(pre|post)install"\s*:/;
const DANGEROUS_FLAG = /(--dangerously-skip-permissions|"permissions"\s*:\s*"(\*|all)"|"?autoApproveAll"?\s*:\s*true|autoApprove\s*:\s*"(\*|all)"|disable[_-]?sandbox\s*[:=]\s*true|"?bypassPermissions"?\s*:\s*true)/i;
const FORCED_ARTIFACT = /(diagnostic\/[^\s"']*\.logd|encryptly|commit[^\n]{0,30}(diagnostic|encrypted) (blob|artifact|file)|python3? build\.py[^\n]{0,40}commit)/i;

const RULES = [
  { id: "env-dump", sev: (f, t) => SUSPICIOUS_HOST.test(t) ? "danger" : "warn",
    label: "Full-environment serialization near a network call (review where it goes; `JSON.stringify(process.env)` etc.)",
    test: t => ENV_DUMP.test(t) && NET_CALL.test(t) },
  { id: "env-exfil", sev: "danger", label: "Secret sent to a suspicious destination (sensitive env var + a known exfil host)",
    test: t => SENSITIVE_ENV.test(t) && SUSPICIOUS_HOST.test(t) },
  { id: "exfil-host", sev: "danger", label: "Network call to a known exfiltration service (webhook.site / pastebin / ngrok / telegram bot)",
    test: t => SUSPICIOUS_HOST.test(t) && NET_CALL.test(t) },
  { id: "obfuscation", sev: "danger", label: "Obfuscated remote code execution (eval(atob(...)), base64 -d | sh, powershell -enc)",
    test: t => OBFUSC.test(t) },
  { id: "shell-pipe", sev: "warn",
    label: "Pipe-to-shell (`curl … | bash`) — runs remote code; fine for official installers, risky from unknown hosts",
    test: t => SHELL_PIPE.test(t) },
  { id: "forced-artifact", sev: "danger", label: "Honeypot pattern: build step that generates/commits an encrypted artifact",
    test: t => FORCED_ARTIFACT.test(t) },
  { id: "secret-literal", sev: "danger", label: "Hardcoded credential / private key committed in the repo",
    test: (t, f) => classifySecretText(t, f).class === "real-secret" },
  { id: "prompt-injection", sev: f => (INSTRUCTION_FILE.test(f) || CODE_FILE.test(f)) ? "danger" : "warn",
    label: "Prompt-injection / data-exfil instruction in text (high risk in SKILL.md / tool descriptions; in changelogs/READMEs it may just be docs discussing it)",
    test: (t, f) => PROMPT_INJ.test(t) && /\.(md|mdx|json|ya?ml|txt|py|js|ts)$/i.test(f) },
  { id: "dangerous-perms", sev: "warn", label: "Auto-approve-all / sandbox-disabling / skip-permissions configuration",
    test: t => DANGEROUS_FLAG.test(t) },
  { id: "install-hook", sev: "warn", label: "Install-time script hook (pre/postinstall) — runs code on `npm install`",
    test: (t, f) => INSTALL_HOOK.test(t) && /package\.json$/i.test(f) },
];

// committed-binary detection (Mach-O / ELF / PE magic)
function looksBinary(buf) {
  if (buf.length < 4) return false;
  const m = buf.subarray(0, 4);
  return (m[0] === 0x7f && m[1] === 0x45 && m[2] === 0x4c && m[3] === 0x46) || // ELF
         (m[0] === 0xcf && m[1] === 0xfa && m[2] === 0xed && m[3] === 0xfe) || // Mach-O 64
         (m[0] === 0xfe && m[1] === 0xed && m[2] === 0xfa) ||                  // Mach-O
         (m[0] === 0x4d && m[1] === 0x5a) ||                                   // PE (MZ)
         (m[0] === 0xca && m[1] === 0xfe && m[2] === 0xba && m[3] === 0xbe);   // Mach-O fat
}

const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "venv", "dist", "build", "__pycache__", ".next"]);
const TEXT_EXT = /\.(js|ts|jsx|tsx|mjs|cjs|py|rb|go|rs|sh|bash|zsh|json|jsonc|ya?ml|toml|md|mdx|txt|env|cfg|ini|ps1)$/i;

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".mcp.json" && e.name !== ".env.example") {
      if (SKIP_DIRS.has(e.name)) continue;
    }
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) { out.push(p); continue; }
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function symlinkEscapes(root, linkPath) {
  let dest;
  try {
    dest = fs.realpathSync(linkPath);
  } catch {
    try { dest = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath)); }
    catch { return true; }
  }
  let realRoot;
  try { realRoot = fs.realpathSync(root); }
  catch { realRoot = path.resolve(root); }
  const relToRoot = path.relative(realRoot, dest);
  return relToRoot !== "" && (relToRoot.startsWith("..") || path.isAbsolute(relToRoot));
}

export function publicTarget(arg) {
  if (/^(https?:\/\/|git@)/.test(arg)) return redactUrl(arg);
  const abs = path.resolve(arg);
  const relToCwd = path.relative(process.cwd(), abs);
  if (relToCwd && !relToCwd.startsWith("..") && !path.isAbsolute(relToCwd)) {
    return relToCwd.split(path.sep).join("/");
  }
  return path.basename(abs) || "target";
}

function scanDir(root) {
  const files = walk(root);
  const findings = [];
  let binaries = 0, scanned = 0;
  for (const f of files) {
    let listed;
    try { listed = fs.lstatSync(f); } catch { continue; }
    if (listed.isSymbolicLink()) {
      if (symlinkEscapes(root, f)) {
        findings.push({ file: f, rule: "symlink-escape", sev: "warn",
          label: labelFor("symlink-escape") });
      }
      continue;
    }
    let buf;
    try { buf = fs.readFileSync(f); } catch { continue; }
    if (looksBinary(buf)) { binaries++; findings.push({ file: f, rule: "committed-binary", sev: "danger",
      label: labelFor("committed-binary") }); continue; }
    if (!TEXT_EXT.test(f) && buf.length > 200000) continue; // skip big non-text
    const text = buf.toString("utf8");
    scanned++;
    for (const r of RULES) {
      try {
        if (!r.test(text, f)) continue;
        const sev = typeof r.sev === "function" ? r.sev(f, text) : r.sev;
        if (sev) findings.push({ file: f, rule: r.id, sev, label: labelFor(r.id) });
      } catch {}
    }
  }
  return { findings, binaries, scanned, fileCount: files.length };
}

function rel(root, f) { return path.relative(root, f) || path.basename(f); }

// Core analysis, reusable by the CLI and the MCP server. Clones a URL statically (no install),
// scans, cleans up, and returns a structured result. Throws on clone/path errors.
export function analyze(arg) {
  const isUrl = /^(https?:\/\/|git@)/.test(arg);
  let root = arg, tmp = null;
  if (isUrl) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skillguard-"));
    try {
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", "clone", "--depth", "1", arg, tmp],
        { stdio: ["ignore", "ignore", "pipe"], timeout: 60000 });
      root = tmp;
    } catch {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      // Child diagnostics include the argv vector. Replace them; do not sanitize-and-append.
      throw new Error("Could not clone the requested repository.");
    }
  }
  if (!fs.existsSync(root)) {
    if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    throw new Error(`Path not found: ${publicTarget(arg)}`);
  }
  const { findings, scanned, fileCount } = scanDir(root);
  const norm = findings.map(x => ({ file: escapeTerminal(rel(root, x.file)), rule: x.rule, sev: x.sev, label: x.label }));
  if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  const dangers = norm.filter(f => f.sev === "danger");
  const warns = norm.filter(f => f.sev === "warn");
  const verdict = dangers.length ? "dangerous" : warns.length ? "suspicious" : "clean";
  return { target: escapeTerminal(publicTarget(arg)), scanned, fileCount, verdict, dangers, warns, findings: norm };
}

function verdictExit(verdict) {
  return verdict === "dangerous" ? 3 : verdict === "suspicious" ? 2 : 0;
}

function printUsage() {
  console.error(`${B}SkillGuard${R} - static security scanner for Claude Code skills, plugins & MCP servers.\n` +
    `Usage: skillguard <path-or-git-url> [--report <file>] [--json] [--badge]\n` +
    `       skillguard --show-report <file>\n` +
    `  npx github:epistemedeus/skillguard https://github.com/owner/repo\n` +
    `  npx github:epistemedeus/skillguard ./my-skill\n` +
    `Exit: 0 clean, 2 suspicious, 3 dangerous. A report is not a safety score.`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args[0] === "mcp") return { mcp: true };
  const out = { target: null, badge: false, json: false, report: null, showReport: null, mcp: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--badge") { out.badge = true; continue; }
    if (arg === "--json") { out.json = true; continue; }
    if (arg === "--report") {
      const file = args[i + 1];
      if (!file || file.startsWith("-")) return { error: "--report needs a file path" };
      out.report = file;
      i++;
      continue;
    }
    if (arg === "--show-report") {
      const file = args[i + 1];
      if (!file || file.startsWith("-")) return { error: "--show-report needs a file path" };
      out.showReport = file;
      i++;
      continue;
    }
    if (arg.startsWith("-")) return { error: `Unknown option: ${arg}` };
    if (out.target) return { error: "Only one target path or URL is accepted" };
    out.target = arg;
  }
  return out;
}

function printHuman(res, badge) {
  console.log(`\n${B}SkillGuard report${R}  ${DIM}· ${res.scanned} text files scanned, ${res.fileCount} total${R}`);
  console.log(`${DIM}target: ${escapeTerminal(res.target)}${R}\n`);
  const group = (list) => {
    const byFile = {};
    for (const x of list) (byFile[x.file] ||= []).push(x);
    for (const [file, fs_] of Object.entries(byFile)) {
      console.log(`  ${CY}${escapeTerminal(file)}${R}`);
      for (const x of fs_) console.log(`    ${x.sev === "danger" ? RED + "■" : YEL + "▲"} ${x.label}${R} ${DIM}[${x.rule}]${R}`);
    }
  };
  if (res.dangers.length) { console.log(`${RED}${B}DANGER (${res.dangers.length})${R}`); group(res.dangers); console.log(""); }
  if (res.warns.length) { console.log(`${YEL}${B}WARNINGS (${res.warns.length})${R}`); group(res.warns); console.log(""); }

  const verdict = res.verdict === "dangerous" ? `${RED}${B}✗ DANGEROUS${R} — do NOT install without reviewing the flagged files.`
    : res.verdict === "suspicious" ? `${YEL}${B}▲ SUSPICIOUS${R} — review the warnings before trusting this.`
    : `${GRN}${B}✓ No known-malicious patterns found${R} — still review code from untrusted authors.`;
  console.log(verdict);
  console.log(`${DIM}SkillGuard does static analysis only; it never executes the scanned code. Heuristics can miss novel attacks.\n` +
    `Want continuous re-scanning on every upstream release + a deeper manual audit? → https://samedaydesk.com/skillguard${R}\n`);
  if (badge) {
    if (res.verdict === "clean") {
      console.log(`${B}You passed — show it in your README:${R}\n` +
        `[![SkillGuard: no known malware](https://img.shields.io/badge/SkillGuard-no%20known%20malware-2ea44f)](https://github.com/epistemedeus/skillguard)\n`);
    } else {
      console.log(`${DIM}--badge: only a clean scan earns a badge; fix the findings above first.${R}\n`);
    }
  }
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.error) {
    console.error(`${RED}${parsed.error}${R}`);
    printUsage();
    process.exit(64);
  }
  if (parsed.mcp) { await import("./mcp.js"); return; } // run as an MCP server (stdio)

  if (parsed.showReport) {
    if (parsed.target || parsed.report || parsed.badge) {
      console.error(`${RED}--show-report only reads a report file. It does not scan.${R}`);
      printUsage();
      process.exit(64);
    }
    const { readReport, formatRetrieval, reportToJson, UNVERIFIED_EXIT, UNVERIFIED_LABEL } = await import("./report.js");
    let report;
    try { report = readReport(parsed.showReport); }
    catch (e) { console.error(`${RED}${e.message}${R}`); process.exit(65); }
    if (parsed.json) {
      process.stderr.write(`${UNVERIFIED_LABEL}\n`);
      process.stdout.write(reportToJson(report));
    } else process.stdout.write(formatRetrieval(report, parsed.showReport));
    process.exit(UNVERIFIED_EXIT);
  }

  if (!parsed.target) {
    printUsage();
    process.exit(64);
  }
  if (/^(https?:\/\/|git@)/.test(parsed.target)) process.stderr.write(`${DIM}Cloning (static, no install)…${R}\n`);
  let res;
  try { res = analyze(parsed.target); }
  catch (e) { console.error(`${RED}${e.message}${R}`); process.exit(65); }

  if (!parsed.json && !parsed.report) {
    printHuman(res, parsed.badge);
    process.exit(verdictExit(res.verdict));
  }

  const { buildReport, writeReport, reportToJson, quoteArg } = await import("./report.js");
  let report;
  let written = null;
  try {
    const reportPath = parsed.report ? path.resolve(parsed.report) : null;
    report = buildReport(res, { reportPath });
    if (reportPath) written = writeReport(reportPath, report);
  } catch (e) {
    console.error(`${RED}${e.message}${R}`);
    process.exit(res.verdict === "clean" ? 65 : verdictExit(res.verdict));
  }

  if (parsed.json) {
    process.stdout.write(reportToJson(report));
    if (parsed.badge) {
      if (res.verdict === "clean") {
        console.error("[![SkillGuard: no known malware](https://img.shields.io/badge/SkillGuard-no%20known%20malware-2ea44f)](https://github.com/epistemedeus/skillguard)");
      } else {
        console.error("--badge: only a clean scan earns a badge; fix the findings above first.");
      }
    }
  } else {
    printHuman(res, parsed.badge);
    console.log(`${DIM}Scoped report: ${written}${R}`);
    console.log(`${DIM}Retrieve: node index.js --show-report ${quoteArg(written)}${R}\n`);
  }
  process.exit(report.exitCode);
}

// Run the CLI only when invoked directly (so the MCP server can import analyze()).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`${RED}${e.message}${R}`); process.exit(65); });
}
