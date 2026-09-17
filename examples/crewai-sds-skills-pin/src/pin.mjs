import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { fail } from "./errors.mjs";
import { assertLocalSkillRef, listSkillDirectories, loadSkillMarkdown } from "./load-skill.mjs";
import { DEFAULT_SKILLS_ROOT, MERCHANT_ROOT, skillMdRelativePath } from "./paths.mjs";
import { SCHEMA, SKILL_FILE, SKILL_NAMES, SKILL_PINS } from "./pins.mjs";

const PIN_FIELDS = Object.freeze(["name", "relativePath", "bytes", "sha256", "gitBlobSha"]);

function isHex(value, length) {
  return typeof value === "string" && value.length === length && /^[0-9a-f]+$/.test(value);
}

export function normalizePins(pins) {
  if (!Array.isArray(pins) || pins.length === 0) {
    fail("pins must be a non-empty array", { kind: "invalid_pins" });
  }
  const seen = new Set();
  const normalized = pins.map((pin, index) => {
    if (!pin || typeof pin !== "object" || Array.isArray(pin)) {
      fail(`pin ${index} must be an object`, { kind: "invalid_pins" });
    }
    for (const key of Object.keys(pin)) {
      if (!PIN_FIELDS.includes(key)) fail(`pin ${index} has unknown field ${key}`, { kind: "invalid_pins" });
    }
    const name = String(pin.name || "");
    assertLocalSkillRef(name, `pin ${index} name`);
    if (seen.has(name)) fail(`duplicate pin name: ${name}`, { kind: "invalid_pins" });
    seen.add(name);
    if (!SKILL_NAMES.includes(name)) fail(`pin names an unknown SDS skill: ${name}`, { kind: "invalid_pins" });
    const relativePath = String(pin.relativePath || "");
    if (relativePath !== skillMdRelativePath(name)) {
      fail(`pin ${name} relativePath must be ${skillMdRelativePath(name)}`, { kind: "invalid_pins" });
    }
    const bytes = Number(pin.bytes);
    if (!Number.isInteger(bytes) || bytes <= 0) fail(`pin ${name} bytes must be a positive integer`, { kind: "invalid_pins" });
    if (!isHex(pin.sha256, 64)) fail(`pin ${name} sha256 must be 64 lowercase hex chars`, { kind: "invalid_pins" });
    if (!isHex(pin.gitBlobSha, 40)) fail(`pin ${name} gitBlobSha must be 40 lowercase hex chars`, { kind: "invalid_pins" });
    return Object.freeze({
      name,
      relativePath,
      bytes,
      sha256: pin.sha256,
      gitBlobSha: pin.gitBlobSha,
    });
  });
  if (normalized.length !== SKILL_NAMES.length) {
    fail(`pins must cover exactly ${SKILL_NAMES.join(", ")}`, { kind: "invalid_pins" });
  }
  const names = normalized.map((pin) => pin.name);
  if (names.join(",") !== SKILL_NAMES.join(",")) {
    fail(`pins must be in canonical order: ${SKILL_NAMES.join(", ")}`, { kind: "invalid_pins" });
  }
  return Object.freeze(normalized);
}

export function defaultPins() {
  return SKILL_PINS;
}

export function loadPinsFile(path) {
  assertLocalSkillRef(path, "pins path");
  const text = readFileSync(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`pins file is not JSON: ${error.message}`, { kind: "invalid_pins" });
  }
  const pins = Array.isArray(parsed) ? parsed : parsed?.skills;
  return normalizePins(pins);
}

export function resolveSkillsRoot(skillsRoot = DEFAULT_SKILLS_ROOT) {
  assertLocalSkillRef(skillsRoot, "skills root");
  return resolve(skillsRoot);
}

function posixRelative(from, to) {
  return relative(from, to).split(sep).join("/");
}

export function pinLocalSdsSkills({
  skillsRoot = DEFAULT_SKILLS_ROOT,
  pins = SKILL_PINS,
} = {}) {
  const root = resolveSkillsRoot(skillsRoot);
  const expected = normalizePins(pins);
  const discovered = listSkillDirectories(root);
  if (discovered.length === 0) fail("skills root contains no skill directories", { kind: "empty_skills" });

  const expectedNames = expected.map((pin) => pin.name);
  for (const name of discovered) {
    if (!expectedNames.includes(name)) {
      fail(`unsigned extra skill directory: ${name}`, { kind: "extra_skill", details: { name } });
    }
  }
  for (const name of expectedNames) {
    if (!discovered.includes(name)) {
      fail(`missing pinned skill directory: ${name}`, { kind: "missing_skill", details: { name } });
    }
  }

  const usingDefaultRoot = root === resolve(DEFAULT_SKILLS_ROOT);
  const skills = expected.map((pin) => {
    const loaded = loadSkillMarkdown(join(root, pin.name), pin.name);
    const expectedFile = join(root, pin.name, SKILL_FILE);
    if (resolve(loaded.skillMd) !== resolve(expectedFile)) {
      fail(`${pin.name} SKILL.md path is not ${expectedFile}`, { kind: "path_mismatch" });
    }
    const relativePath = posixRelative(resolve(MERCHANT_ROOT), loaded.skillMd);
    if (usingDefaultRoot && relativePath !== pin.relativePath) {
      fail(`${pin.name} path ${relativePath} does not match pin ${pin.relativePath}`, {
        kind: "path_mismatch",
      });
    }
    if (loaded.bytes !== pin.bytes) {
      fail(`${pin.name} size ${loaded.bytes} does not match pin ${pin.bytes}`, {
        kind: "size_mismatch",
        details: { name: pin.name, actual: loaded.bytes, expected: pin.bytes },
      });
    }
    if (loaded.sha256 !== pin.sha256) {
      fail(`${pin.name} sha256 ${loaded.sha256} does not match pin ${pin.sha256}`, {
        kind: "digest_mismatch",
        details: { name: pin.name, actual: loaded.sha256, expected: pin.sha256 },
      });
    }
    if (loaded.gitBlobSha !== pin.gitBlobSha) {
      fail(`${pin.name} git blob ${loaded.gitBlobSha} does not match pin ${pin.gitBlobSha}`, {
        kind: "blob_mismatch",
        details: { name: pin.name, actual: loaded.gitBlobSha, expected: pin.gitBlobSha },
      });
    }
    return Object.freeze({
      name: loaded.name,
      description: loaded.description,
      directory: loaded.directory,
      skillMd: loaded.skillMd,
      relativePath,
      bytes: loaded.bytes,
      sha256: loaded.sha256,
      gitBlobSha: loaded.gitBlobSha,
    });
  });

  return Object.freeze({
    schema: SCHEMA,
    skillsRoot: root,
    skills,
  });
}
