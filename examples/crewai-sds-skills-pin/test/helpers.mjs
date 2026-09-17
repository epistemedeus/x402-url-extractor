import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_SKILLS_ROOT } from "../src/paths.mjs";
import { SKILL_FILE, SKILL_NAMES, SKILL_PINS } from "../src/pins.mjs";

export function makeTempDir(prefix = "crewai-sds-skills-pin-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export function checkoutMarkdown(name) {
  return readFileSync(join(DEFAULT_SKILLS_ROOT, name, SKILL_FILE));
}

export function writeSkillTree(root, skills) {
  mkdirSync(root, { recursive: true });
  for (const [name, markdown] of Object.entries(skills)) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    const body = Buffer.isBuffer(markdown) ? markdown : Buffer.from(markdown);
    writeFileSync(join(dir, SKILL_FILE), body);
  }
  return root;
}

export function writePinnedCheckoutCopy(root = makeTempDir()) {
  const skills = {};
  for (const name of SKILL_NAMES) skills[name] = checkoutMarkdown(name);
  return writeSkillTree(root, skills);
}

export function clonePins(overrides = {}) {
  return SKILL_PINS.map((pin) => ({ ...pin, ...(overrides[pin.name] || {}) }));
}
