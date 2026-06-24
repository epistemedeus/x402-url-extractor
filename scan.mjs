// scan.mjs — the differentiated paid service: static supply-chain SECURITY scan of a
// public GitHub repo, for an AI agent deciding whether to install/run/use it (a dep,
// a Claude/MCP skill, an MCP server). Zero deps. STATIC ONLY: reads files via the
// GitHub API + raw CDN, NEVER clones or runs the target code.
//
// Differentiated: no x402 competitor does pre-use supply-chain scanning. Plays to our
// security domain. DANGER requires a genuine exfil destination (low false positives).

const UA = 'SameDayDeskScanner/1.0 (+https://samedaydesk.com)';
const TIMEOUT = 12000;
const MAX_FILES = 40;
const MAX_BYTES_PER_FILE = 400_000;

// Genuine exfil sinks → DANGER. (NOT telegram/ngrok alone — those are dual-use.)
const EXFIL = [
  /webhook\.site/i, /pastebin\.com\/(raw|api)/i, /requestbin/i, /\brequestb\.in/i,
  /burpcollaborator\.net/i, /\.oast\.(fun|live|me|pro|site)/i, /\binteract\.sh/i,
  /pipedream\.net\/[a-z0-9]/i, /\bhookb\.in/i, /\bngrok-free\.app\/.+(env|token|secret|key)/i,
];
// Obfuscated-exec → DANGER (code hidden then run).
const OBFUSC = [
  /eval\s*\(\s*(atob|Buffer\.from|globalThis\.atob)/i,
  /new\s+Function\s*\(\s*(atob|Buffer\.from)/i,
  /exec(Sync)?\s*\([^)]*(atob|base64 -d|base64 --decode)/i,
  /child_process[\s\S]{0,80}(atob|Buffer\.from\([^)]*base64)/i,
];
// Reading CREDENTIAL FILES (private keys / cloud creds) → WARN (not normal app behavior).
const CRED_FILE = [/\.ssh\/id_(rsa|ed25519|dsa)/, /\.aws\/credentials/, /\/etc\/(passwd|shadow)/, /(^|[^.\w])\.netrc/, /\.config\/gcloud/];
// Whole-env HARVEST (grab ALL env vars at once) — suspicious ONLY when paired with a network send.
const ENV_HARVEST = [
  /\{\s*\.\.\.process\.env\s*\}/, /JSON\.stringify\s*\(\s*process\.env\b/, /Object\.(entries|values|assign|keys)\s*\(\s*process\.env\s*\)/,
  /os\.environ\.copy\(\)/, /dict\s*\(\s*os\.environ\s*\)/, /\bos\.environ\.items\(\)/,
];
const NET_SEND = /(fetch\s*\(|https?\.request|https?\.get\s*\(|axios|require\(['"]node:https?['"]|requests\.(post|get)|urllib|XMLHttpRequest|\.write\s*\(|net\.connect)/i;
// Install-time network execution → WARN.
const INSTALL_EXEC = [/curl[^\n|]*\|\s*(sudo\s+)?(ba)?sh/i, /wget[^\n|]*\|\s*(ba)?sh/i, /\bnode\s+-e\b[\s\S]{0,80}(https?:\/\/|require\(['"]node:https?)/i];

const SCAN_EXT = /\.(js|mjs|cjs|ts|mts|cts|py|sh|bash|rb|ps1)$/i;
const ALSO = /(^|\/)(package\.json|setup\.py|pyproject\.toml|install\.sh|postinstall\.js|\.npmrc|SKILL\.md)$/i;

function parseRepo(input) {
  let s = String(input || '').trim();
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/, '').replace(/\/$/, '');
  const m = s.match(/^([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/([\w.\/-]+))?/);
  if (!m) throw new Error('provide a public GitHub repo, e.g. owner/name or https://github.com/owner/name');
  return { owner: m[1], repo: m[2], ref: m[3] || null };
}

async function gh(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/vnd.github+json' }, signal: ctrl.signal });
    if (r.status === 403) throw new Error('github rate limit (unauthenticated) — try again shortly');
    if (r.status === 404) throw new Error('repo not found or private');
    if (!r.ok) throw new Error('github api ' + r.status);
    return r.json();
  } finally { clearTimeout(t); }
}

async function rawFile(owner, repo, ref, path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) return '';
    const buf = await r.arrayBuffer();
    return new TextDecoder().decode(buf.slice(0, MAX_BYTES_PER_FILE));
  } catch { return ''; } finally { clearTimeout(t); }
}

function scanText(path, text) {
  const findings = [];
  const add = (severity, why) => findings.push({ file: path, severity, why });
  for (const re of EXFIL) if (re.test(text)) { add('danger', `exfil sink: ${re.source}`); break; }
  for (const re of OBFUSC) if (re.test(text)) { add('danger', `obfuscated code execution: ${re.source}`); break; }
  for (const re of INSTALL_EXEC) if (re.test(text)) { add('warn', `install/runtime network exec: ${re.source}`); break; }
  for (const re of CRED_FILE) if (re.test(text)) { add('warn', `reads credential file: ${re.source}`); break; }
  // env-harvest is only suspicious when the same file also makes a network call (exfil shape)
  if (ENV_HARVEST.some(re => re.test(text)) && NET_SEND.test(text)) add('warn', 'harvests all env vars AND makes network calls (possible secret exfil)');
  if (/api\.telegram\.org\/bot/i.test(text) && ENV_HARVEST.some(re => re.test(text))) add('warn', 'telegram bot + full env harvest (possible exfil, dual-use)');
  return findings;
}

export async function scanRepo(input) {
  const { owner, repo, ref } = parseRepo(input);
  const meta = await gh(`https://api.github.com/repos/${owner}/${repo}`);
  const branch = ref || meta.default_branch || 'main';
  const tree = await gh(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const paths = (tree.tree || [])
    .filter(n => n.type === 'blob' && (SCAN_EXT.test(n.path) || ALSO.test(n.path)) && (n.size == null || n.size < MAX_BYTES_PER_FILE))
    .slice(0, MAX_FILES)
    .map(n => n.path);
  const texts = await Promise.all(paths.map(p => rawFile(owner, repo, branch, p).then(t => [p, t])));
  let findings = [];
  for (const [p, t] of texts) if (t) findings = findings.concat(scanText(p, t));
  const danger = findings.filter(f => f.severity === 'danger');
  const warn = findings.filter(f => f.severity === 'warn');
  const risk = danger.length ? 'dangerous' : warn.length ? 'suspicious' : 'clean';
  return {
    ok: true,
    repo: `${owner}/${repo}`,
    branch,
    filesScanned: paths.length,
    risk,                                  // clean | suspicious | dangerous
    summary: risk === 'dangerous'
      ? `DANGER: ${danger.length} high-severity finding(s) (exfil/obfuscation). Do NOT install/run without manual review.`
      : risk === 'suspicious'
      ? `CAUTION: ${warn.length} dual-use pattern(s) (secret/env reads, install-time exec). Review before trusting.`
      : `No known malware/exfil/obfuscation patterns found in ${paths.length} scanned files. (Static triage, not a guarantee.)`,
    findings: findings.slice(0, 50),
    disclaimer: 'Static heuristic triage of a public repo. Absence of findings is not proof of safety; presence is not proof of malice. For high-stakes decisions, get a manual review.',
    scannedAt: new Date().toISOString(),
  };
}

// CLI: node scan.mjs owner/repo
if (import.meta.url === `file://${process.argv[1]}`) {
  scanRepo(process.argv[2] || 'epistemedeus/ai-readiness').then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error('ERR', e.message); process.exit(1); });
}
