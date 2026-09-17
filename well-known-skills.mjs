import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WELL_KNOWN_SKILLS_BASE = "/.well-known/skills";
export const WELL_KNOWN_SKILLS_INDEX_PATH = `${WELL_KNOWN_SKILLS_BASE}/index.json`;
export const WELL_KNOWN_SKILL_FILE = "SKILL.md";
export const WELL_KNOWN_SKILLS_CACHE_CONTROL = "public, max-age=3600";
export const WELL_KNOWN_SKILL_MAX_BYTES = 1_048_576;
export const WELL_KNOWN_SKILL_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const WELL_KNOWN_SKILL_NAMES = Object.freeze([
  "web-extract",
  "page-change",
  "explicit-record",
]);

const SKILL_NAME_PATTERN = /^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DESCRIPTION_LENGTH = 1024;
const INDEX_CONTENT_TYPE = "application/json; charset=utf-8";
const SKILL_CONTENT_TYPE = "text/markdown; charset=utf-8";
const MERCHANT_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILLS_ROOT = join(MERCHANT_ROOT, "plugins", "samedaydesk-x402", "skills");

function fail(message) {
  throw new Error(`well-known skills projection invalid: ${message}`);
}

function readRegularFile(path, label) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    fail(`${label} cannot be opened without following symlinks: ${path}: ${error.message}`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) fail(`${label} must be a regular file: ${path}`);
    if (st.size > WELL_KNOWN_SKILL_MAX_BYTES) {
      fail(`${label} exceeds ${WELL_KNOWN_SKILL_MAX_BYTES} bytes: ${path}`);
    }
    const bytes = readFileSync(fd);
    if (bytes.length > WELL_KNOWN_SKILL_MAX_BYTES) {
      fail(`${label} exceeds ${WELL_KNOWN_SKILL_MAX_BYTES} bytes: ${path}`);
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function asSkillBytes(value, label = "skill artifact") {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") return Buffer.from(value, "utf8");
  fail(`${label} must be bytes or utf8 text`);
}

export function wellKnownSkillDigest(bytes) {
  return `sha256:${createHash("sha256").update(asSkillBytes(bytes)).digest("hex")}`;
}

export function verifyWellKnownSkillArtifact(entry, bytes) {
  if (!entry || typeof entry !== "object") fail("skill entry is required");
  const name = typeof entry.name === "string" && entry.name ? entry.name : "skill";
  if (typeof entry.digest !== "string" || !WELL_KNOWN_SKILL_DIGEST_PATTERN.test(entry.digest)) {
    fail(`${name} digest must be sha256:{64 lowercase hex}`);
  }
  if (!Number.isInteger(entry.size) || entry.size < 0) {
    fail(`${name} size must be a non-negative integer`);
  }
  const buffer = asSkillBytes(bytes, `${name} artifact`);
  if (buffer.length !== entry.size) {
    fail(`${name} size mismatch: advertised ${entry.size}, actual ${buffer.length}`);
  }
  const digest = wellKnownSkillDigest(buffer);
  if (digest !== entry.digest) {
    fail(`${name} digest mismatch: advertised ${entry.digest}, actual ${digest}`);
  }
  return { name, digest, size: buffer.length };
}

function assertRegularDirectory(path, label) {
  let st;
  try {
    st = lstatSync(path);
  } catch (error) {
    fail(`${label} is missing: ${path}: ${error.message}`);
  }
  if (st.isSymbolicLink()) fail(`${label} must not be a symlink: ${path}`);
  if (!st.isDirectory()) fail(`${label} must be a directory: ${path}`);
}

function parseSkillFrontmatter(markdown, expectedName) {
  if (!markdown.startsWith("---\n")) fail(`${expectedName} SKILL.md must start with YAML frontmatter`);
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) fail(`${expectedName} SKILL.md frontmatter must close`);
  const fields = {};
  for (const line of markdown.slice(4, end).split("\n")) {
    const match = /^(name|description|license):\s*(.*)$/.exec(line);
    if (!match) fail(`${expectedName} unexpected frontmatter line: ${line}`);
    fields[match[1]] = match[2];
  }
  if (fields.name !== expectedName) {
    fail(`${expectedName} frontmatter name ${fields.name || "<missing>"} does not match directory`);
  }
  if (!SKILL_NAME_PATTERN.test(fields.name)) fail(`invalid skill name: ${fields.name}`);
  const description = String(fields.description || "");
  if (!description || description.length > MAX_DESCRIPTION_LENGTH) {
    fail(`${expectedName} description must be 1-${MAX_DESCRIPTION_LENGTH} characters`);
  }
  return { name: fields.name, description };
}

function loadPortableSkill(skillsRoot, name) {
  const skillDir = join(skillsRoot, name);
  const skillFile = join(skillDir, WELL_KNOWN_SKILL_FILE);
  assertRegularDirectory(skillsRoot, "skills root");
  assertRegularDirectory(skillDir, `${name} skill directory`);
  const bytes = readRegularFile(skillFile, `${name} ${WELL_KNOWN_SKILL_FILE}`);
  const markdown = bytes.toString("utf8");
  if (markdown.includes("\uFEFF")) fail(`${name} SKILL.md must not have a BOM`);
  const meta = parseSkillFrontmatter(markdown, name);
  return {
    name: meta.name,
    description: meta.description,
    files: [WELL_KNOWN_SKILL_FILE],
    markdown,
    digest: wellKnownSkillDigest(bytes),
    size: bytes.length,
  };
}

export function loadWellKnownSkills(skillsRoot = DEFAULT_SKILLS_ROOT) {
  return WELL_KNOWN_SKILL_NAMES.map((name) => loadPortableSkill(skillsRoot, name));
}

function projectSkillIndexEntry(skill) {
  if (!skill || typeof skill !== "object") fail("skill is required");
  const name = typeof skill.name === "string" && skill.name ? skill.name : "skill";
  if (typeof skill.markdown !== "string") fail(`${name} markdown is required`);
  const bytes = Object.hasOwn(skill, "bytes")
    ? asSkillBytes(skill.bytes, `${name} artifact`)
    : Buffer.from(skill.markdown, "utf8");
  const digest = wellKnownSkillDigest(bytes);
  const size = bytes.length;
  if (Object.hasOwn(skill, "digest") && skill.digest !== digest) {
    fail(`${name} digest mismatch: advertised ${skill.digest}, actual ${digest}`);
  }
  if (Object.hasOwn(skill, "size") && skill.size !== size) {
    fail(`${name} size mismatch: advertised ${skill.size}, actual ${size}`);
  }
  return {
    name: skill.name,
    description: skill.description,
    files: [...skill.files],
    digest,
    size,
  };
}

export function buildWellKnownSkillsIndex(skills = loadWellKnownSkills()) {
  const index = {
    skills: skills.map((skill) => projectSkillIndexEntry(skill)),
  };
  for (const [i, skill] of skills.entries()) {
    verifyWellKnownSkillArtifact(index.skills[i], Buffer.from(skill.markdown, "utf8"));
  }
  return index;
}

export function canonicalWellKnownSkillsOrigin(publicUrl) {
  const origin = new URL(publicUrl).origin;
  if (!origin.startsWith("https://")) fail("canonical origin must be HTTPS");
  return origin;
}

export function canonicalWellKnownSkillsIndexUrl(publicUrl) {
  return `${canonicalWellKnownSkillsOrigin(publicUrl)}${WELL_KNOWN_SKILLS_INDEX_PATH}`;
}

export function canonicalWellKnownSkillUrl(publicUrl, name) {
  if (!WELL_KNOWN_SKILL_NAMES.includes(name)) fail(`unknown skill: ${name}`);
  return `${canonicalWellKnownSkillsOrigin(publicUrl)}${WELL_KNOWN_SKILLS_BASE}/${name}/${WELL_KNOWN_SKILL_FILE}`;
}

export function isWellKnownSkillsPath(pathname) {
  const path = String(pathname || "").split("?", 1)[0];
  return path === WELL_KNOWN_SKILLS_BASE || path.startsWith(`${WELL_KNOWN_SKILLS_BASE}/`);
}

export function resolveWellKnownSkillsPath(pathname) {
  const path = String(pathname || "").split("?", 1)[0] || "";
  if (path === WELL_KNOWN_SKILLS_BASE || path === `${WELL_KNOWN_SKILLS_BASE}/`) {
    return { kind: "redirect-index" };
  }
  if (path === WELL_KNOWN_SKILLS_INDEX_PATH) return { kind: "index" };
  for (const name of WELL_KNOWN_SKILL_NAMES) {
    if (path === `${WELL_KNOWN_SKILLS_BASE}/${name}`) {
      return { kind: "redirect-skill", name };
    }
    if (path === `${WELL_KNOWN_SKILLS_BASE}/${name}/${WELL_KNOWN_SKILL_FILE}`) {
      return { kind: "skill-md", name };
    }
  }
  return { kind: "not-found" };
}

function skillsHeaders(contentType, canonicalUrl) {
  return {
    "Content-Type": contentType,
    "Cache-Control": WELL_KNOWN_SKILLS_CACHE_CONTROL,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Link: `<${canonicalUrl}>; rel="canonical"`,
  };
}

function send(res, { status, headers, body, method }) {
  res.status(status);
  for (const [name, value] of Object.entries(headers)) res.set(name, value);
  if (method === "HEAD" || body === null || body === undefined) {
    if (typeof body === "string") res.set("Content-Length", Buffer.byteLength(body));
    return res.end();
  }
  return res.send(body);
}

export function handleWellKnownSkillsRequest(req, res, {
  publicUrl,
  skills = loadWellKnownSkills(),
} = {}) {
  const method = String(req.method || "GET").toUpperCase();
  const origin = canonicalWellKnownSkillsOrigin(publicUrl);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": WELL_KNOWN_SKILLS_CACHE_CONTROL,
  };

  const resolved = resolveWellKnownSkillsPath(req.path);
  if (resolved.kind === "not-found") {
    const body = JSON.stringify({ error: "Not found" });
    return send(res, {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": INDEX_CONTENT_TYPE },
      body,
      method,
    });
  }

  if (method === "OPTIONS") {
    return send(res, {
      status: 204,
      headers: { ...corsHeaders, "Content-Length": "0" },
      body: null,
      method,
    });
  }

  if (method !== "GET" && method !== "HEAD") {
    const body = JSON.stringify({ error: "Method not allowed" });
    return send(res, {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": INDEX_CONTENT_TYPE },
      body,
      method,
    });
  }

  if (resolved.kind === "redirect-index") {
    return res.status(302).set({
      Location: `${origin}${WELL_KNOWN_SKILLS_INDEX_PATH}`,
      "Cache-Control": WELL_KNOWN_SKILLS_CACHE_CONTROL,
    }).end();
  }
  if (resolved.kind === "redirect-skill") {
    return res.status(302).set({
      Location: canonicalWellKnownSkillUrl(publicUrl, resolved.name),
      "Cache-Control": WELL_KNOWN_SKILLS_CACHE_CONTROL,
    }).end();
  }
  if (resolved.kind === "index") {
    const body = `${JSON.stringify(buildWellKnownSkillsIndex(skills), null, 2)}\n`;
    return send(res, {
      status: 200,
      headers: skillsHeaders(INDEX_CONTENT_TYPE, canonicalWellKnownSkillsIndexUrl(publicUrl)),
      body,
      method,
    });
  }
  if (resolved.kind === "skill-md") {
    const skill = skills.find((entry) => entry.name === resolved.name);
    if (!skill) {
      const body = JSON.stringify({ error: "Not found" });
      return send(res, {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": INDEX_CONTENT_TYPE },
        body,
        method,
      });
    }
    return send(res, {
      status: 200,
      headers: skillsHeaders(SKILL_CONTENT_TYPE, canonicalWellKnownSkillUrl(publicUrl, resolved.name)),
      body: skill.markdown,
      method,
    });
  }

  fail(`unhandled resolved path kind: ${resolved.kind}`);
}

export function mountWellKnownSkills(app, { publicUrl, skillsRoot = DEFAULT_SKILLS_ROOT } = {}) {
  const skills = loadWellKnownSkills(skillsRoot);
  const handler = (req, res, next) => {
    if (!isWellKnownSkillsPath(req.path)) return next();
    return handleWellKnownSkillsRequest(req, res, { publicUrl, skills });
  };
  app.use(handler);
  return {
    index: buildWellKnownSkillsIndex(skills),
    names: skills.map((skill) => skill.name),
  };
}

function invokedAsCli() {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  try {
    return pathToFileURL(argvPath).href === import.meta.url;
  } catch {
    return false;
  }
}

if (invokedAsCli()) {
  const skills = loadWellKnownSkills();
  const index = buildWellKnownSkillsIndex(skills);
  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
}
