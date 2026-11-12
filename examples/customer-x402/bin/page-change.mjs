#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { main } from "../src/page-change/cli.mjs";

// Optional offline continuation. Without --continue or --save-continuation the
// command is exactly main(argv). With them, the held observation is checked by
// digest and source identity before the same offline compare runs. Nothing is
// fetched, paid, or sent. A server token found in a saved file is carried as an
// opaque string only for the next MCP step and is never printed.
const FILE_SCHEMA = "samedaydesk.free-page-change-continuation.v1";
const TOOL = "compare_page_observations";
const FILE_MAX_BYTES = 64 * 1024;
const SUBJECT_SCHEMA = "samedaydesk/page-change-subject/v1";
const CORRELATION_RE = /^ae:corr:v1:[A-Za-z0-9_-]{22}$/;
const DISCOVERY_SOURCES = new Set(["a2a", "mcp", "cli", "llms", "skill", "registry", "other"]);
const CREDENTIAL_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client[-_]?secret|api[-_]?key|access[-_]?token|refresh[-_]?token|bearer|private[-_]?key|seed[-_]?phrase|mnemonic|payment[-_]?signature|x[-_]payment)$/i;
const CREDENTIAL_VALUE = [
  /^(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}$/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/,
  /^gh[pousr]_[A-Za-z0-9]{20,}$/,
  /^xox[abprs]-[A-Za-z0-9-]{10,}$/,
  /^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/,
];
const NEXT = {
  continuation_file_invalid: "Save a continuation first with compare --save-continuation PATH.",
  continuation_expired: "Start a new chain with compare --save-continuation PATH.",
  continuation_observation_mismatch: "Keep the saved after observation unchanged, or start a new chain.",
  continuation_fields_mismatch: "Use the fields of the saved step.",
  continuation_subject_mismatch: "Use a new after observation for the same sources.",
  continuation_second_observation_incomplete: "Pass --after with a complete observation that has source identities.",
  continuation_credential_input: "Remove credentials, cookies, keys and payment signatures from the inputs.",
  continuation_invalid: "Use compare with --continue PATH or --save-continuation PATH.",
};

const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const refuse = (code) => { const error = new Error(code); error.code = code; throw error; };

// Same algorithm as page-change-continuation.mjs pageChangeSubjectDigest.
function subjectDigest(artifact) {
  const body = plain(artifact) && plain(artifact.body) && !Array.isArray(artifact.sources) && !Array.isArray(artifact.items) ? artifact.body : artifact;
  if (!plain(body) || body.missing === true) return null;
  const rows = Array.isArray(body.sources) ? body.sources : Array.isArray(body.items) ? body.items : null;
  if (!rows || rows.length === 0) return null;
  const keys = new Set();
  for (const row of rows) {
    if (!plain(row) || typeof row.source !== "string") continue;
    const text = row.source.trim();
    if (!text) continue;
    let key;
    try { const url = new URL(text); url.hash = ""; key = url.href; } catch { key = text.replace(/#.*$/, ""); }
    if (key) keys.add(key);
  }
  if (!keys.size) return null;
  return sha256(JSON.stringify([SUBJECT_SCHEMA, ...[...keys].sort()]));
}

function credentialLike(value) {
  const stack = [value];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop();
    if (++nodes > 50_000) return false;
    if (typeof item === "string") { if (item.length <= 8192 && CREDENTIAL_VALUE.some((pattern) => pattern.test(item))) return true; }
    else if (Array.isArray(item)) stack.push(...item);
    else if (plain(item)) for (const [key, child] of Object.entries(item)) { if (CREDENTIAL_KEY.test(key)) return true; stack.push(child); }
  }
  return false;
}

async function readJson(path, code) {
  try {
    const bytes = await readFile(path);
    if (bytes.length > 16 * 1024 * 1024) refuse(code);
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (error?.code?.startsWith?.("continuation_")) throw error;
    return refuse(code);
  }
}

async function loadSaved(path) {
  let bytes;
  try { bytes = await readFile(path); } catch { refuse("continuation_file_invalid"); }
  if (bytes.length > FILE_MAX_BYTES) refuse("continuation_file_invalid");
  let saved;
  try { saved = JSON.parse(bytes.toString("utf8")); } catch { refuse("continuation_file_invalid"); }
  if (!plain(saved) || saved.schema !== FILE_SCHEMA || saved.tool !== TOOL || !Array.isArray(saved.fields)
    || typeof saved.observationPath !== "string" || !/^[a-f0-9]{64}$/.test(saved.observationSha256 || "")) refuse("continuation_file_invalid");
  if (typeof saved.expiresAt === "string" && Date.parse(saved.expiresAt) <= Date.now()) refuse("continuation_expired");
  return saved;
}

async function writeSaved(path, saved) {
  const temp = `${path}.${process.pid}.tmp`;
  const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
  try { await handle.writeFile(`${JSON.stringify({ schema: FILE_SCHEMA, tool: TOOL, ...saved })}\n`); } finally { await handle.close(); }
  await rename(temp, path);
}

function take(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) refuse("continuation_invalid");
  argv.splice(index, 2);
  return value;
}

function sortedFields(text) {
  return [...new Set(String(text).split(",").map((field) => field.trim()).filter(Boolean))].sort();
}

async function continuationMain(input) {
  const argv = [...input];
  const continuePath = take(argv, "--continue");
  const savePath = take(argv, "--save-continuation");
  const declared = take(argv, "--discovery");
  if (argv[0] !== "compare") refuse("continuation_invalid");
  const saved = continuePath ? await loadSaved(resolve(continuePath)) : null;
  let beforePath = take(argv, "--before");
  const afterPath = take(argv, "--after");
  let fieldsText = take(argv, "--fields");
  if (saved) {
    beforePath ??= saved.observationPath;
    fieldsText ??= saved.fields.join(",");
    if (sortedFields(fieldsText).join(",") !== [...new Set(saved.fields)].sort().join(",")) refuse("continuation_fields_mismatch");
  }
  if (!beforePath || !fieldsText) refuse("continuation_invalid");
  if (!afterPath) refuse("continuation_second_observation_incomplete");
  const before = await readJson(resolve(beforePath), "continuation_observation_mismatch");
  const after = await readJson(resolve(afterPath), "continuation_second_observation_incomplete");
  if (credentialLike(before) || credentialLike(after)) refuse("continuation_credential_input");
  const afterSubject = subjectDigest(after);
  if (!afterSubject) refuse("continuation_second_observation_incomplete");
  if (saved) {
    if (sha256(JSON.stringify(before)) !== saved.observationSha256) refuse("continuation_observation_mismatch");
    if (subjectDigest(before) !== afterSubject) refuse("continuation_subject_mismatch");
  }
  const code = await main([...argv, "--before", resolve(beforePath), "--after", resolve(afterPath), "--fields", fieldsText]);
  if (code !== 0 || !savePath) return code;
  const correlationId = saved && CORRELATION_RE.test(saved.correlationId || "")
    ? saved.correlationId
    : `ae:corr:v1:${randomBytes(16).toString("base64url")}`;
  const step = saved && Number.isSafeInteger(saved.step) ? saved.step + 1 : 0;
  await writeSaved(resolve(savePath), {
    endpointUrl: saved?.endpointUrl ?? null,
    fields: sortedFields(fieldsText),
    observationPath: resolve(afterPath),
    observationSha256: sha256(JSON.stringify(after)),
    // A server token binds the observation it saw, so a local step drops it.
    token: null,
    correlationId,
    step,
    expiresAt: null,
  });
  // Separate measurement record: no token, no key, no file path.
  const isDeclared = DISCOVERY_SOURCES.has(declared);
  const measurement = {
    v: 1, kind: "measurement", tool: TOOL, correlationId, step,
    discovery: isDeclared ? { status: "declared", source: declared } : { status: "unknown", source: null },
    outcome: null,
    // Additive: local clock at handling time, why discovery has its status,
    // and the entry surface, which for this CLI is always an installed copy.
    occurredAt: new Date().toISOString(),
    discoveryBasis: isDeclared ? { kind: "caller_meta", matched: null } : null,
    entrySurface: { surface: "installed", basis: "local_cli", transport: "cli" },
  };
  process.stderr.write(`${JSON.stringify({ saved: true, measurement })}\n`);
  return 0;
}

const argv = process.argv.slice(2);
if (!argv.includes("--continue") && !argv.includes("--save-continuation")) {
  process.exitCode = await main(argv);
} else {
  try {
    process.exitCode = await continuationMain(argv);
  } catch (error) {
    const code = Object.hasOwn(NEXT, error?.code) ? error.code : "continuation_invalid";
    process.stderr.write(`${JSON.stringify({ ok: false, charged: false, paymentRequired: false, code, nextMethod: "page-change compare", nextStep: NEXT[code] })}\n`);
    process.exitCode = 2;
  }
}
