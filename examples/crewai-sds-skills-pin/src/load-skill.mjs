import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { digestBytes } from "./digest.mjs";
import { fail } from "./errors.mjs";
import {
  FORBIDDEN_SUBSTRINGS,
  MAX_DESCRIPTION_LENGTH,
  SKILL_FILE,
  SKILL_MAX_BYTES,
  SKILL_NAME_PATTERN,
} from "./pins.mjs";

function assertInsideRoot(root, path, label) {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
    fail(`${label} escaped skills root: ${path}`, { kind: "path_escape" });
  }
}

export function assertLocalSkillRef(value, label = "skill ref") {
  const text = String(value ?? "");
  if (!text) fail(`${label} is empty`, { kind: "invalid_ref" });
  if (text.startsWith("@")) {
    fail(`${label} registry refs are refused: ${text}`, {
      kind: "registry_ref",
      details: { value: text },
    });
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) {
    fail(`${label} remote URLs are refused: ${text}`, {
      kind: "remote_url",
      details: { value: text },
    });
  }
  if (text.includes("\\")) {
    fail(`${label} must be a posix path, not a Windows path`, { kind: "invalid_ref" });
  }
  return text;
}

export function assertRegularDirectory(path, label) {
  let st;
  try {
    st = lstatSync(path);
  } catch (error) {
    fail(`${label} is missing: ${path}: ${error.message}`, { kind: "missing_path" });
  }
  if (st.isSymbolicLink()) fail(`${label} must not be a symlink: ${path}`, { kind: "symlink" });
  if (!st.isDirectory()) fail(`${label} must be a directory: ${path}`, { kind: "not_directory" });
}

function readRegularFile(path, label) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    fail(`${label} cannot be opened without following symlinks: ${path}: ${error.message}`, {
      kind: "not_regular_file",
    });
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) fail(`${label} must be a regular file: ${path}`, { kind: "not_regular_file" });
    if (st.size > SKILL_MAX_BYTES) {
      fail(`${label} exceeds ${SKILL_MAX_BYTES} bytes: ${path}`, { kind: "too_large" });
    }
    const bytes = readFileSync(fd);
    if (bytes.length > SKILL_MAX_BYTES) {
      fail(`${label} exceeds ${SKILL_MAX_BYTES} bytes: ${path}`, { kind: "too_large" });
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function parseSkillFrontmatter(markdown, expectedName) {
  if (markdown.includes("\uFEFF")) fail(`${expectedName} SKILL.md must not have a BOM`, { kind: "bom" });
  if (!markdown.startsWith("---\n")) {
    fail(`${expectedName} SKILL.md must start with YAML frontmatter`, { kind: "invalid_frontmatter" });
  }
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) fail(`${expectedName} SKILL.md frontmatter must close`, { kind: "invalid_frontmatter" });
  const fields = {};
  for (const line of markdown.slice(4, end).split("\n")) {
    if (line === "") continue;
    const match = /^(name|description|license):\s*(.*)$/.exec(line);
    if (!match) fail(`${expectedName} unexpected frontmatter line: ${line}`, { kind: "invalid_frontmatter" });
    fields[match[1]] = match[2];
  }
  if (fields.name !== expectedName) {
    fail(
      `${expectedName} frontmatter name ${fields.name || "<missing>"} does not match directory`,
      { kind: "invalid_frontmatter" },
    );
  }
  if (!SKILL_NAME_PATTERN.test(fields.name)) {
    fail(`invalid skill name: ${fields.name}`, { kind: "invalid_frontmatter" });
  }
  const description = String(fields.description || "");
  if (!description || description.length > MAX_DESCRIPTION_LENGTH) {
    fail(`${expectedName} description must be 1-${MAX_DESCRIPTION_LENGTH} characters`, {
      kind: "invalid_frontmatter",
    });
  }
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    if (markdown.includes(needle)) {
      fail(`${expectedName} SKILL.md contains forbidden ${needle}`, { kind: "forbidden_content" });
    }
  }
  return { name: fields.name, description, license: fields.license || null };
}

export function listSkillDirectories(skillsRoot) {
  assertRegularDirectory(skillsRoot, "skills root");
  const root = resolve(skillsRoot);
  const names = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    assertInsideRoot(root, full, "skills child");
    if (entry.isSymbolicLink() || lstatSync(full).isSymbolicLink()) {
      fail(`skills child must not be a symlink: ${full}`, { kind: "symlink" });
    }
    if (entry.isFile()) {
      fail(`skills root must not contain loose files: ${entry.name}`, { kind: "extra_skill" });
    }
    if (!entry.isDirectory()) fail(`unsupported skills child: ${full}`, { kind: "extra_skill" });
    names.push(entry.name);
  }
  return names.sort();
}

export function loadSkillMarkdown(skillDir, expectedName) {
  assertRegularDirectory(skillDir, `${expectedName} skill directory`);
  const dir = resolve(skillDir);
  const children = readdirSync(dir, { withFileTypes: true });
  if (children.length !== 1 || children[0].name !== SKILL_FILE || !children[0].isFile()) {
    fail(`${expectedName} skill directory must contain only ${SKILL_FILE}`, { kind: "unsigned_extra_file" });
  }
  const skillFile = join(dir, SKILL_FILE);
  assertInsideRoot(dir, skillFile, `${expectedName} ${SKILL_FILE}`);
  const bytes = readRegularFile(skillFile, `${expectedName} ${SKILL_FILE}`);
  const markdown = bytes.toString("utf8");
  const meta = parseSkillFrontmatter(markdown, expectedName);
  return Object.freeze({
    name: meta.name,
    description: meta.description,
    license: meta.license,
    directory: dir,
    skillMd: skillFile,
    markdown,
    ...digestBytes(bytes),
  });
}
