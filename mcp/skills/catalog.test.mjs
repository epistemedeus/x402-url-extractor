import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadWellKnownSkills } from "../../well-known-skills.mjs";
import {
  SDS_SKILL_NAMES,
  encodeSkillsCursor,
  listSkillEntries,
  loadSkillCatalog,
  parseSkillFrontmatter,
  protocolSkillEntry,
  sha256Digest,
  skillFileUri,
} from "./catalog.mjs";

function tempSkillsRoot() {
  return mkdtempSync(join(tmpdir(), "sds-mcp-skills-"));
}

function writeSkill(root, name, markdown, extraFiles = {}) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), markdown, "utf8");
  for (const [relative, body] of Object.entries(extraFiles)) {
    const path = join(dir, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body, "utf8");
  }
}

test("SDS catalog projects the three portable skills with complete manifests", () => {
  const catalog = loadSkillCatalog();
  const portable = loadWellKnownSkills();
  assert.deepEqual([...catalog.names], [...SDS_SKILL_NAMES]);
  assert.equal(catalog.skills.length, 3);
  for (const [index, skill] of catalog.skills.entries()) {
    assert.equal(skill.name, portable[index].name);
    assert.equal(skill.frontmatter.name, skill.name);
    assert.equal(skill.frontmatter.description, portable[index].description);
    assert.equal(skill.markdown, portable[index].markdown);
    assert.equal(skill.uri, skillFileUri(skill.name));
    assert.equal(skill.resources[0].uri, skill.uri);
    assert.equal(skill.resources[0].digest, sha256Digest(Buffer.from(skill.markdown, "utf8")));
    assert.equal(skill.resources[0].size, Buffer.byteLength(skill.markdown, "utf8"));
    assert.match(skill.resources[0].digest, /^sha256:[0-9a-f]{64}$/);
  }
  const pageChange = catalog.byUri.get("skill://page-change/SKILL.md");
  assert.equal(pageChange.frontmatter.license, "MIT");
  assert.equal(Object.keys(protocolSkillEntry(pageChange)).join(","), "uri,frontmatter,resources");
});

test("frontmatter parser keeps every author field and rejects name mismatch", () => {
  const parsed = parseSkillFrontmatter(
    "---\nname: page-change\ndescription: Offline compare.\nlicense: MIT\n---\n\n# x\n",
    "page-change",
  );
  assert.deepEqual(parsed, {
    name: "page-change",
    description: "Offline compare.",
    license: "MIT",
  });
  assert.throws(
    () => parseSkillFrontmatter(
      "---\nname: other\ndescription: Offline compare.\n---\n\n# x\n",
      "page-change",
    ),
    /does not match directory/,
  );
  assert.throws(
    () => parseSkillFrontmatter(
      "\uFEFF---\nname: page-change\ndescription: Offline compare.\n---\n\n# x\n",
      "page-change",
    ),
    /BOM/,
  );
});

test("seeded catalog failures reject symlink, missing SKILL.md, and extra traversal names", () => {
  const root = tempSkillsRoot();
  try {
    writeSkill(root, "web-extract", "---\nname: web-extract\ndescription: Extract public pages.\n---\n\n# ok\n");
    symlinkSync(join(root, "web-extract", "SKILL.md"), join(root, "web-extract", "link.md"));
    assert.throws(
      () => loadSkillCatalog({ skillsRoot: root, names: ["web-extract"] }),
      /must not contain symlinks/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const missing = tempSkillsRoot();
  try {
    mkdirSync(join(missing, "web-extract"), { recursive: true });
    writeFileSync(join(missing, "web-extract", "README.md"), "no\n");
    assert.throws(
      () => loadSkillCatalog({ skillsRoot: missing, names: ["web-extract"] }),
      /missing SKILL.md/,
    );
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }
});

test("listSkillEntries paginates atomically and rejects a seeded invalid cursor", () => {
  const catalog = loadSkillCatalog();
  const first = listSkillEntries(catalog, { pageSize: 1 });
  assert.equal(first.skills.length, 1);
  assert.equal(first.skills[0].uri, "skill://web-extract/SKILL.md");
  assert.equal(typeof first.nextCursor, "string");
  const second = listSkillEntries(catalog, { cursor: first.nextCursor, pageSize: 1 });
  assert.equal(second.skills[0].uri, "skill://page-change/SKILL.md");
  const invalid = listSkillEntries(catalog, { cursor: "not-a-cursor" });
  assert.equal(invalid.error, "invalid_cursor");
  const unknown = listSkillEntries(catalog, { cursor: encodeSkillsCursor("skill://missing/SKILL.md") });
  assert.equal(unknown.error, "invalid_cursor");
});
