import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { WELL_KNOWN_SKILL_MAX_BYTES, WELL_KNOWN_SKILL_NAMES } from "../../well-known-skills.mjs";

export const SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills";
export const SKILL_SCHEME = "skill:";
export const SKILL_MD = "SKILL.md";
export const SKILL_NAME_PATTERN = /^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_RESOURCES_LIMIT = 512;
export const SKILL_TOTAL_BYTES_LIMIT = 16_777_216;
export const SDS_SKILL_NAMES = WELL_KNOWN_SKILL_NAMES;

const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_URI_CHARS = 2048;
const MERCHANT_ROOT = dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));
export const DEFAULT_SDS_SKILLS_ROOT = join(MERCHANT_ROOT, "plugins", "samedaydesk-x402", "skills");

function fail(message) {
  throw new Error(`mcp skills catalog invalid: ${message}`);
}

function posixJoin(...parts) {
  return parts.filter((part) => part !== "").join("/");
}

function readRegularFileBytes(path, label) {
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

function parseYamlScalar(raw) {
  const value = String(raw ?? "");
  if (value.length >= 2) {
    const start = value[0];
    const end = value[value.length - 1];
    if ((start === '"' && end === '"') || (start === "'" && end === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseSkillFrontmatter(markdown, expectedName) {
  if (typeof markdown !== "string") fail(`${expectedName} SKILL.md must be UTF-8 text`);
  if (markdown.includes("\uFEFF")) fail(`${expectedName} SKILL.md must not have a BOM`);
  if (!markdown.startsWith("---\n")) fail(`${expectedName} SKILL.md must start with YAML frontmatter`);
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) fail(`${expectedName} SKILL.md frontmatter must close`);
  const frontmatter = {};
  for (const line of markdown.slice(4, end).split("\n")) {
    if (line.trim() === "") continue;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) fail(`${expectedName} unexpected frontmatter line: ${line}`);
    if (Object.hasOwn(frontmatter, match[1])) fail(`${expectedName} duplicate frontmatter field: ${match[1]}`);
    frontmatter[match[1]] = parseYamlScalar(match[2]);
  }
  if (frontmatter.name !== expectedName) {
    fail(`${expectedName} frontmatter name ${frontmatter.name || "<missing>"} does not match directory`);
  }
  if (!SKILL_NAME_PATTERN.test(frontmatter.name)) fail(`invalid skill name: ${frontmatter.name}`);
  const description = String(frontmatter.description || "");
  if (!description || description.length > MAX_DESCRIPTION_LENGTH) {
    fail(`${expectedName} description must be 1-${MAX_DESCRIPTION_LENGTH} characters`);
  }
  return frontmatter;
}

export function skillFileUri(skillPath, relativePath = SKILL_MD) {
  const filePath = String(relativePath || "").split(sep).join("/");
  if (!skillPath || skillPath.includes("\\") || skillPath.includes("\0")) fail(`invalid skill path: ${skillPath}`);
  if (!filePath || filePath.startsWith("/") || filePath.includes("\0") || filePath.split("/").includes("..")) {
    fail(`invalid skill file path: ${relativePath}`);
  }
  return `skill://${skillPath}/${filePath}`;
}

export function sha256Digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function mimeTypeForRelativePath(relativePath) {
  if (relativePath === SKILL_MD || relativePath.endsWith(".md")) return "text/markdown";
  if (relativePath.endsWith(".json")) return "application/json";
  if (relativePath.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

function listRegularRelativeFiles(skillDir, label) {
  assertRegularDirectory(skillDir, label);
  const files = [];
  const stack = [""];
  while (stack.length) {
    const relDir = stack.pop();
    const absDir = relDir ? join(skillDir, relDir) : skillDir;
    let names;
    try {
      names = readdirSync(absDir);
    } catch (error) {
      fail(`${label} cannot be read: ${absDir}: ${error.message}`);
    }
    names.sort();
    for (const name of names) {
      if (name === "." || name === "..") continue;
      if (name.includes("\0") || name.includes("/") || name.includes("\\")) {
        fail(`${label} contains an illegal entry name: ${name}`);
      }
      const childRel = posixJoin(relDir, name);
      if (childRel.split("/").includes("..")) fail(`${label} path escaped: ${childRel}`);
      const childAbs = join(skillDir, childRel.split("/").join(sep));
      const resolved = relative(skillDir, childAbs);
      if (resolved.startsWith("..") || resolved.includes(`..${sep}`)) fail(`${label} path escaped: ${childRel}`);
      let st;
      try {
        st = lstatSync(childAbs);
      } catch (error) {
        fail(`${label} cannot stat ${childRel}: ${error.message}`);
      }
      if (st.isSymbolicLink()) fail(`${label} must not contain symlinks: ${childRel}`);
      if (st.isDirectory()) {
        stack.push(childRel);
        continue;
      }
      if (!st.isFile()) fail(`${label} contains a non-file: ${childRel}`);
      files.push(childRel);
    }
  }
  files.sort();
  return files;
}

function loadSkillFile(skillDir, relativePath, skillPath) {
  const abs = join(skillDir, relativePath.split("/").join(sep));
  const bytes = readRegularFileBytes(abs, `${skillPath}/${relativePath}`);
  const text = bytes.toString("utf8");
  if (Buffer.byteLength(text, "utf8") !== bytes.length) {
    fail(`${skillPath}/${relativePath} must be UTF-8`);
  }
  return {
    relativePath,
    uri: skillFileUri(skillPath, relativePath),
    bytes,
    text,
    digest: sha256Digest(bytes),
    size: bytes.length,
    mimeType: mimeTypeForRelativePath(relativePath),
  };
}

function loadOneSkill(skillsRoot, name) {
  if (!SKILL_NAME_PATTERN.test(name)) fail(`invalid skill name: ${name}`);
  const skillDir = join(skillsRoot, name);
  const relativeFiles = listRegularRelativeFiles(skillDir, `${name} skill directory`);
  if (!relativeFiles.includes(SKILL_MD)) fail(`${name} is missing ${SKILL_MD}`);
  const files = relativeFiles.map((relativePath) => loadSkillFile(skillDir, relativePath, name));
  if (files.length > SKILL_RESOURCES_LIMIT) {
    fail(`${name} has ${files.length} resources; limit is ${SKILL_RESOURCES_LIMIT}`);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > SKILL_TOTAL_BYTES_LIMIT) {
    fail(`${name} totals ${totalBytes} bytes; limit is ${SKILL_TOTAL_BYTES_LIMIT}`);
  }
  const skillMd = files.find((file) => file.relativePath === SKILL_MD);
  const frontmatter = parseSkillFrontmatter(skillMd.text, name);
  const uri = skillMd.uri;
  if (uri.length > MAX_URI_CHARS) fail(`${name} URI exceeds ${MAX_URI_CHARS} characters`);
  const resources = files.map((file) => ({
    uri: file.uri,
    digest: file.digest,
    size: file.size,
  }));
  resources.sort((a, b) => {
    if (a.uri === uri) return -1;
    if (b.uri === uri) return 1;
    return a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0;
  });
  return {
    name,
    skillPath: name,
    uri,
    frontmatter,
    resources,
    files,
    markdown: skillMd.text,
  };
}

export function protocolSkillEntry(skill) {
  return {
    uri: skill.uri,
    frontmatter: { ...skill.frontmatter },
    resources: skill.resources.map((resource) => ({ ...resource })),
  };
}

export function loadSkillCatalog({
  skillsRoot = DEFAULT_SDS_SKILLS_ROOT,
  names = SDS_SKILL_NAMES,
} = {}) {
  assertRegularDirectory(skillsRoot, "skills root");
  const list = [...names];
  if (list.length === 0) fail("skill name allowlist is empty");
  const seen = new Set();
  const skills = list.map((name) => {
    if (seen.has(name)) fail(`duplicate skill name: ${name}`);
    seen.add(name);
    return loadOneSkill(skillsRoot, name);
  });
  const byUri = new Map();
  const filesByUri = new Map();
  for (const skill of skills) {
    if (byUri.has(skill.uri)) fail(`duplicate skill URI: ${skill.uri}`);
    byUri.set(skill.uri, skill);
    for (const file of skill.files) {
      if (filesByUri.has(file.uri)) fail(`duplicate resource URI: ${file.uri}`);
      filesByUri.set(file.uri, { skill, file });
    }
  }
  return Object.freeze({
    skillsRoot,
    names: Object.freeze(skills.map((skill) => skill.name)),
    skills: Object.freeze(skills),
    byUri,
    filesByUri,
  });
}

export function getSkillEntry(catalog, uri) {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > MAX_URI_CHARS) return null;
  return catalog.byUri.get(uri) ?? null;
}

export function getSkillFile(catalog, uri) {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > MAX_URI_CHARS) return null;
  return catalog.filesByUri.get(uri) ?? null;
}

export function encodeSkillsCursor(uri) {
  return Buffer.from(String(uri), "utf8").toString("base64url");
}

export function decodeSkillsCursor(cursor) {
  if (typeof cursor !== "string" || cursor.length === 0) return null;
  let uri;
  try {
    uri = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (encodeSkillsCursor(uri) !== cursor) return null;
  return uri;
}

export function listSkillEntries(catalog, { cursor, pageSize } = {}) {
  const ordered = catalog.skills.map(protocolSkillEntry);
  let start = 0;
  if (cursor !== undefined && cursor !== null && cursor !== "") {
    const uri = decodeSkillsCursor(cursor);
    if (!uri) return { error: "invalid_cursor", cursor };
    const index = ordered.findIndex((entry) => entry.uri === uri);
    if (index < 0) return { error: "invalid_cursor", cursor };
    start = index + 1;
  }
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : ordered.length || 1;
  const skills = ordered.slice(start, start + size);
  const next = start + skills.length;
  return {
    skills,
    nextCursor: next < ordered.length ? encodeSkillsCursor(skills[skills.length - 1].uri) : undefined,
  };
}
