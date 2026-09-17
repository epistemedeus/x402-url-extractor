import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { SkillsPinError } from "../src/errors.mjs";
import { assertLocalSkillRef } from "../src/load-skill.mjs";
import { DEFAULT_SKILLS_ROOT } from "../src/paths.mjs";
import { loadPinsFile, pinLocalSdsSkills } from "../src/pin.mjs";
import { SKILL_NAMES, SKILL_PINS } from "../src/pins.mjs";
import {
  checkoutMarkdown,
  clonePins,
  makeTempDir,
  removeTempDir,
  writePinnedCheckoutCopy,
  writeSkillTree,
} from "./helpers.mjs";

test("default checkout SKILL.md files match committed pins", () => {
  const pinned = pinLocalSdsSkills();
  assert.equal(pinned.skillsRoot, DEFAULT_SKILLS_ROOT);
  assert.deepEqual(pinned.skills.map((skill) => skill.name), [...SKILL_NAMES]);
  for (const [i, pin] of SKILL_PINS.entries()) {
    assert.equal(pinned.skills[i].sha256, pin.sha256);
    assert.equal(pinned.skills[i].bytes, pin.bytes);
    assert.equal(pinned.skills[i].gitBlobSha, pin.gitBlobSha);
    assert.equal(pinned.skills[i].relativePath, pin.relativePath);
  }
});

test("web-extract pin matches the plugin product skill digest", () => {
  assert.equal(
    SKILL_PINS[0].sha256,
    "382e45d33e95b81dd27c2ab38c576118159a37af2d776bc0620ecf9b472d3551",
  );
});

test("tampered SKILL.md bytes fail the digest pin", () => {
  const dir = makeTempDir();
  try {
    const skills = {};
    for (const name of SKILL_NAMES) skills[name] = checkoutMarkdown(name);
    const original = Buffer.from(checkoutMarkdown("web-extract"));
    original[original.length - 1] = original[original.length - 1] === 0x0a ? 0x20 : 0x0a;
    skills["web-extract"] = original;
    writeSkillTree(dir, skills);
    assert.throws(
      () => pinLocalSdsSkills({ skillsRoot: dir, pins: clonePins() }),
      (error) => error instanceof SkillsPinError && error.kind === "digest_mismatch",
    );
  } finally {
    removeTempDir(dir);
  }
});

test("byte-identical checkout copy still matches digest and blob", () => {
  const dir = makeTempDir();
  try {
    writePinnedCheckoutCopy(dir);
    const pinned = pinLocalSdsSkills({ skillsRoot: dir, pins: clonePins() });
    assert.equal(pinned.skills[0].sha256, SKILL_PINS[0].sha256);
    assert.equal(pinned.skills[1].gitBlobSha, SKILL_PINS[1].gitBlobSha);
  } finally {
    removeTempDir(dir);
  }
});

test("wrong size is rejected even if the caller forges sha256 later", () => {
  const dir = makeTempDir();
  try {
    writePinnedCheckoutCopy(dir);
    const pins = clonePins({ "page-change": { bytes: 1 } });
    assert.throws(
      () => pinLocalSdsSkills({ skillsRoot: dir, pins }),
      (error) => error instanceof SkillsPinError && error.kind === "size_mismatch",
    );
  } finally {
    removeTempDir(dir);
  }
});

test("extra and missing skill directories are refused", () => {
  const extra = makeTempDir();
  const missing = makeTempDir();
  try {
    writePinnedCheckoutCopy(extra);
    writeSkillTree(extra, {
      "bonus-skill": "---\nname: bonus-skill\ndescription: extra\n---\n\n# no\n",
    });
    assert.throws(
      () => pinLocalSdsSkills({ skillsRoot: extra, pins: clonePins() }),
      (error) => error instanceof SkillsPinError && error.kind === "extra_skill",
    );

    const skills = {};
    for (const name of SKILL_NAMES.slice(0, 2)) skills[name] = checkoutMarkdown(name);
    writeSkillTree(missing, skills);
    assert.throws(
      () => pinLocalSdsSkills({ skillsRoot: missing, pins: clonePins() }),
      (error) => error instanceof SkillsPinError && error.kind === "missing_skill",
    );
  } finally {
    removeTempDir(extra);
    removeTempDir(missing);
  }
});

test("symlinks and extra files are refused", () => {
  const dir = makeTempDir();
  try {
    writePinnedCheckoutCopy(dir);
    symlinkSync(join(dir, "web-extract"), join(dir, "alias"));
    assert.throws(
      () => pinLocalSdsSkills({ skillsRoot: dir, pins: clonePins() }),
      (error) => error instanceof SkillsPinError && error.kind === "symlink",
    );
  } finally {
    removeTempDir(dir);
  }

  const extras = makeTempDir();
  try {
    writePinnedCheckoutCopy(extras);
    writeFileSync(join(extras, "web-extract", "notes.md"), "nope");
    assert.throws(
      () => pinLocalSdsSkills({ skillsRoot: extras, pins: clonePins() }),
      (error) => error instanceof SkillsPinError && error.kind === "unsigned_extra_file",
    );
  } finally {
    removeTempDir(extras);
  }

  const loose = makeTempDir();
  try {
    writePinnedCheckoutCopy(loose);
    writeFileSync(join(loose, "README.md"), "nope");
    assert.throws(
      () => pinLocalSdsSkills({ skillsRoot: loose, pins: clonePins() }),
      (error) => error instanceof SkillsPinError && error.kind === "extra_skill",
    );
  } finally {
    removeTempDir(loose);
  }
});

test("BOM and unexpected frontmatter fail closed", () => {
  const dir = makeTempDir();
  try {
    const skills = {};
    for (const name of SKILL_NAMES) skills[name] = checkoutMarkdown(name);
    skills["web-extract"] = Buffer.concat([Buffer.from("\uFEFF"), checkoutMarkdown("web-extract")]);
    writeSkillTree(dir, skills);
    assert.throws(
      () => pinLocalSdsSkills({ skillsRoot: dir, pins: clonePins() }),
      (error) => error instanceof SkillsPinError && error.kind === "bom",
    );
  } finally {
    removeTempDir(dir);
  }
});

test("seeded-failure pins file loads and disagrees with checkout bytes", () => {
  const pins = loadPinsFile(fileURLToPath(new URL("../fixtures/seeded-failure/digest-mismatch.json", import.meta.url)));
  assert.equal(pins[0].sha256, "0".repeat(64));
  assert.throws(
    () => pinLocalSdsSkills({ pins }),
    (error) => error instanceof SkillsPinError && error.kind === "digest_mismatch",
  );
});

test("registry refs and remote URLs are refused before filesystem read", () => {
  assert.throws(() => assertLocalSkillRef("@acme/web-extract"), (error) => error.kind === "registry_ref");
  assert.throws(
    () => assertLocalSkillRef("https://agents.samedaydesk.com/.well-known/skills"),
    (error) => error.kind === "remote_url",
  );
});
