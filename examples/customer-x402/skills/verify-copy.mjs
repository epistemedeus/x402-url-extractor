#!/usr/bin/env node
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REMAINING_SKILL_NAMES = Object.freeze(["page-change", "explicit-record"]);
export const ALREADY_DISTRIBUTED = Object.freeze(["web-extract"]);
const SKILL_FILE = "SKILL.md";
const INDEX_FILE = "index.json";
const SOURCE_PIN = "0153295c5851bf8f93fb27c77070a31417a59f69";
const LIVE_ORIGIN = "https://agents.samedaydesk.com";
const MAX_BYTES = 1_048_576;
const ACTION_ALIASES = new Map([
  ["buy", "purchase"],
  ["checkout", "purchase"],
  ["wallet", "purchase"],
  ["payment", "pay"],
  ["x402", "pay"],
]);

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_ROOT = dirname(HERE);
const REPO_ROOT = dirname(dirname(EXAMPLE_ROOT));

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
    if (st.size > MAX_BYTES) fail(`${path} exceeds ${MAX_BYTES} bytes`);
    const bytes = readFileSync(fd);
    if (bytes.length > MAX_BYTES) fail(`${path} exceeds ${MAX_BYTES} bytes`);
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

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function frontmatterDescription(markdown, name) {
  if (!markdown.startsWith("---\n")) fail(`${name} SKILL.md must start with YAML frontmatter`);
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) fail(`${name} SKILL.md frontmatter must close`);
  for (const line of markdown.slice(4, end).split("\n")) {
    const match = /^description:\s*(.*)$/.exec(line);
    if (match) return match[1];
  }
  fail(`${name} SKILL.md missing description`);
}

function copyPaths(name) {
  return [
    join(HERE, name, SKILL_FILE),
    join(REPO_ROOT, ".well-known", "skills", name, SKILL_FILE),
  ];
}

function loadSkill(name) {
  const sourcePath = join(HERE, name, "source.json");
  const source = parseObject(sourcePath, readRegularFile(sourcePath));
  if (source.name !== name) fail(`${sourcePath} name ${source.name} does not match ${name}`);
  if (source.pays !== false) fail(`${name} source.json pays must be false`);
  if (source.network !== false) fail(`${name} source.json network must be false`);
  if (source.sourcePin !== SOURCE_PIN) {
    fail(`${name} source.json sourcePin must be ${SOURCE_PIN}`);
  }
  if (source.liveSkillUrl !== `${LIVE_ORIGIN}/.well-known/skills/${name}/${SKILL_FILE}`) {
    fail(`${name} source.json liveSkillUrl is not the merchant well-known SKILL.md`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(source.liveSkillSha256 || ""))) {
    fail(`${name} source.json liveSkillSha256 must be 64 hex chars`);
  }

  const copies = copyPaths(name).map((path) => {
    const bytes = readRegularFile(path);
    const text = bytes.toString("utf8");
    if (text.includes("\uFEFF")) fail(`${path} must not have a BOM`);
    const digest = sha256Hex(bytes);
    if (digest !== source.liveSkillSha256) {
      fail(`${path} sha256 ${digest} does not match source.liveSkillSha256 ${source.liveSkillSha256}`);
    }
    return { path, bytes, text, digest };
  });

  const pluginPath = join(REPO_ROOT, source.sourcePath.split("/").join(sep));
  const pluginBytes = readRegularFile(pluginPath);
  const pluginDigest = sha256Hex(pluginBytes);
  if (pluginDigest !== source.liveSkillSha256) {
    fail(`${pluginPath} sha256 ${pluginDigest} does not match source.liveSkillSha256 ${source.liveSkillSha256}`);
  }
  for (const copy of copies) {
    if (!copy.bytes.equals(pluginBytes)) fail(`${copy.path} is not byte-identical to ${pluginPath}`);
  }

  return { name, source, copies, description: frontmatterDescription(copies[0].text, name) };
}

function loadIndex(skills) {
  const path = join(REPO_ROOT, ".well-known", "skills", INDEX_FILE);
  const index = parseObject(path, readRegularFile(path));
  if (!Array.isArray(index.skills)) fail(`${path} must have a skills array`);
  const names = index.skills.map((skill) => skill?.name);
  if (JSON.stringify(names) !== JSON.stringify([...REMAINING_SKILL_NAMES])) {
    fail(`${path} must list remaining skills ${REMAINING_SKILL_NAMES.join(",")} only, got ${names.join(",")}`);
  }
  if (names.includes("web-extract")) {
    fail(`${path} must not list web-extract; that skill is already distributed`);
  }
  for (const [i, skill] of skills.entries()) {
    const entry = index.skills[i];
    if (entry.description !== skill.description) {
      fail(`${path} ${skill.name} description does not match SKILL.md frontmatter`);
    }
    if (!Array.isArray(entry.files) || entry.files.length !== 1 || entry.files[0] !== SKILL_FILE) {
      fail(`${path} ${skill.name} files must be ["${SKILL_FILE}"]`);
    }
  }
  return index;
}

function normalizeTarget(raw) {
  const target = String(raw || "").trim().toLowerCase();
  if (!target) return "";
  if (/[\r\n]/.test(target)) fail("target must be a single line");
  return ACTION_ALIASES.get(target) || target;
}

export function verifyRemainingCopies() {
  assertRegularDirectory(HERE, "example skills root");
  assertRegularDirectory(join(REPO_ROOT, ".well-known", "skills"), "well-known skills root");
  const skills = REMAINING_SKILL_NAMES.map((name) => loadSkill(name));
  loadIndex(skills);
  return skills;
}

function main(argv = process.argv.slice(2)) {
  const skills = verifyRemainingCopies();
  const target = normalizeTarget(argv[0]);

  if (!target || target === "verify" || target === "ok") {
    console.log(`ok remaining well-known copies: ${skills.map((skill) => skill.name).join(" ")}`);
    process.exit(0);
  }

  if (ALREADY_DISTRIBUTED.includes(target)) {
    console.error(
      `rejected skill ${target}: not a remaining well-known copy. ${target} is already served live at ${LIVE_ORIGIN}/.well-known/skills/${target}/SKILL.md and distributed in runtime skill dirs. This tree copies page-change and explicit-record only.`,
    );
    process.exit(1);
  }

  for (const skill of skills) {
    const rejected = (Array.isArray(skill.source.rejectedActions) ? skill.source.rejectedActions : [])
      .find((entry) => entry && entry.id === target);
    if (rejected) {
      console.error(`rejected action ${target}: ${rejected.reason}`);
      process.exit(1);
    }
  }

  if (REMAINING_SKILL_NAMES.includes(target)) {
    const skill = skills.find((entry) => entry.name === target);
    console.log(`ok remaining skill ${target}; sha256 ${skill.source.liveSkillSha256}; pays=false network=false`);
    process.exit(0);
  }

  console.error(
    `rejected skill ${target}: remaining well-known copies are page-change and explicit-record only`,
  );
  process.exit(1);
}

const invoked = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) main();
