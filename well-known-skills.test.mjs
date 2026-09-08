import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  WELL_KNOWN_SKILL_NAMES,
  WELL_KNOWN_SKILLS_CACHE_CONTROL,
  WELL_KNOWN_SKILLS_INDEX_PATH,
  WELL_KNOWN_SKILL_MAX_BYTES,
  buildWellKnownSkillsIndex,
  canonicalWellKnownSkillUrl,
  canonicalWellKnownSkillsIndexUrl,
  handleWellKnownSkillsRequest,
  isWellKnownSkillsPath,
  loadWellKnownSkills,
  resolveWellKnownSkillsPath,
} from "./well-known-skills.mjs";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_URL = "https://agents.samedaydesk.com";

function createResponse() {
  const headers = {};
  let status = 200;
  let body = "";
  return {
    statusCode() { return status; },
    headers() { return headers; },
    body() { return body; },
    status(code) { status = code; return this; },
    set(name, value) {
      if (name && typeof name === "object") {
        for (const [key, val] of Object.entries(name)) headers[key.toLowerCase()] = String(val);
        return this;
      }
      headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    end(chunk) { if (chunk !== undefined) body = String(chunk); return this; },
    send(chunk) { body = chunk; return this; },
  };
}

test("index metadata is projected from the three portable SKILL.md files", () => {
  const skills = loadWellKnownSkills();
  const index = buildWellKnownSkillsIndex(skills);
  assert.deepEqual(index.skills.map((skill) => skill.name), [...WELL_KNOWN_SKILL_NAMES]);
  assert.equal(index.skills.length, 3);
  for (const [i, skill] of skills.entries()) {
    assert.equal(index.skills[i].files.length, 1);
    assert.equal(index.skills[i].files[0], "SKILL.md");
    assert.equal(index.skills[i].name, skill.name);
    assert.equal(index.skills[i].description, skill.description);
    assert.ok(skill.description.length > 0);
    assert.ok(skill.description.length <= 1024);
    assert.match(skill.markdown, /^---\nname: /);
  }
  assert.match(skills[0].description, /POST \/extract\/batch/);
  assert.match(skills[1].description, /without fetching, paying, retrying, or scheduling/);
  assert.match(skills[2].description, /JSON Pointers/);
  assert.match(skills[2].markdown, /fixtures\/record\/required-sku\/mapping\.json/);
  assert.match(skills[2].markdown, /missing product `sku` and organization `email`\s+are optional/);
});

test("path resolver allowlists exact index and SKILL.md resources", () => {
  assert.equal(isWellKnownSkillsPath("/.well-known/skills/index.json"), true);
  assert.equal(isWellKnownSkillsPath("/.well-known/agent-card.json"), false);
  assert.equal(isWellKnownSkillsPath("/.well-known/xagent-verification.json"), false);
  assert.deepEqual(resolveWellKnownSkillsPath("/.well-known/skills"), { kind: "redirect-index" });
  assert.deepEqual(resolveWellKnownSkillsPath("/.well-known/skills/index.json"), { kind: "index" });
  assert.deepEqual(resolveWellKnownSkillsPath("/.well-known/skills/web-extract/SKILL.md"), {
    kind: "skill-md",
    name: "web-extract",
  });
  assert.deepEqual(resolveWellKnownSkillsPath("/.well-known/skills/unknown/SKILL.md"), { kind: "not-found" });
  assert.deepEqual(resolveWellKnownSkillsPath("/.well-known/skills/web-extract/../page-change/SKILL.md"), {
    kind: "not-found",
  });
  assert.deepEqual(resolveWellKnownSkillsPath("/.well-known/skills/web-extract/references/x.md"), {
    kind: "not-found",
  });
  assert.deepEqual(resolveWellKnownSkillsPath("/.well-known/skills/WEB-EXTRACT/SKILL.md"), { kind: "not-found" });
  assert.deepEqual(resolveWellKnownSkillsPath("/.well-known/skills/web-extract/skill.md"), { kind: "not-found" });
  assert.deepEqual(resolveWellKnownSkillsPath("/.well-known/skills/%2e%2e/server.js"), { kind: "not-found" });
});

test("canonical URLs use PUBLIC_URL and never a request host", () => {
  assert.equal(
    canonicalWellKnownSkillsIndexUrl(PUBLIC_URL),
    "https://agents.samedaydesk.com/.well-known/skills/index.json",
  );
  assert.equal(
    canonicalWellKnownSkillUrl(`${PUBLIC_URL}/ignored`, "page-change"),
    "https://agents.samedaydesk.com/.well-known/skills/page-change/SKILL.md",
  );
  const res = createResponse();
  handleWellKnownSkillsRequest(
    { method: "GET", path: "/.well-known/skills", headers: { host: "evil.example" } },
    res,
    { publicUrl: PUBLIC_URL },
  );
  assert.equal(res.statusCode(), 302);
  assert.equal(res.headers().location, "https://agents.samedaydesk.com/.well-known/skills/index.json");
  assert.equal(JSON.stringify(res.headers()).includes("evil.example"), false);
});

test("index and SKILL.md responses use official cache and content types", () => {
  const indexRes = createResponse();
  handleWellKnownSkillsRequest(
    { method: "GET", path: WELL_KNOWN_SKILLS_INDEX_PATH },
    indexRes,
    { publicUrl: PUBLIC_URL },
  );
  assert.equal(indexRes.statusCode(), 200);
  assert.equal(indexRes.headers()["content-type"], "application/json; charset=utf-8");
  assert.equal(indexRes.headers()["cache-control"], WELL_KNOWN_SKILLS_CACHE_CONTROL);
  assert.equal(indexRes.headers()["access-control-allow-origin"], "*");
  const parsed = JSON.parse(indexRes.body());
  assert.equal(parsed.skills.length, 3);
  assert.equal(Object.keys(parsed).join(","), "skills");

  const skillRes = createResponse();
  handleWellKnownSkillsRequest(
    { method: "GET", path: "/.well-known/skills/explicit-record/SKILL.md" },
    skillRes,
    { publicUrl: PUBLIC_URL },
  );
  const source = loadWellKnownSkills().find((skill) => skill.name === "explicit-record");
  assert.equal(skillRes.statusCode(), 200);
  assert.equal(skillRes.headers()["content-type"], "text/markdown; charset=utf-8");
  assert.equal(skillRes.body(), source.markdown);
});

test("unknown, malformed, and extra file names are 404", () => {
  const paths = [
    "/.well-known/skills/not-a-skill/SKILL.md",
    "/.well-known/skills/Invalid_Name/SKILL.md",
    "/.well-known/skills/web-extract/README.md",
    "/.well-known/skills/web-extract/SKILL.md/extra",
    "/.well-known/skills/../server.js",
    "/.well-known/skills/%252e%252e/server.js",
    "/.well-known/skills/web%2dextract/SKILL.md",
    "/.well-known/skills/web-extract/SKILL.md%00",
    "/.well-known/skills/web-extract//SKILL.md",
  ];
  for (const path of paths) {
    const res = createResponse();
    handleWellKnownSkillsRequest({ method: "GET", path }, res, { publicUrl: PUBLIC_URL });
    assert.equal(res.statusCode(), 404, path);
    assert.deepEqual(JSON.parse(res.body()), { error: "Not found" });
  }
});

test("known resources allow only GET, HEAD, and OPTIONS; unknown paths stay 404", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "CONNECT"]) {
    const known = createResponse();
    handleWellKnownSkillsRequest(
      { method, path: "/.well-known/skills/web-extract/SKILL.md" },
      known,
      { publicUrl: PUBLIC_URL },
    );
    assert.equal(known.statusCode(), 405, method);
    const unknown = createResponse();
    handleWellKnownSkillsRequest(
      { method, path: "/.well-known/skills/unknown/SKILL.md" },
      unknown,
      { publicUrl: PUBLIC_URL },
    );
    assert.equal(unknown.statusCode(), 404, method);
  }
  const options = createResponse();
  handleWellKnownSkillsRequest(
    { method: "OPTIONS", path: "/.well-known/skills/index.json" },
    options,
    { publicUrl: PUBLIC_URL },
  );
  assert.equal(options.statusCode(), 204);
  const head = createResponse();
  handleWellKnownSkillsRequest(
    { method: "HEAD", path: "/.well-known/skills/web-extract/SKILL.md" },
    head,
    { publicUrl: PUBLIC_URL },
  );
  assert.equal(head.statusCode(), 200);
  assert.equal(head.body(), "");
  assert.equal(Number(head.headers()["content-length"]) > 0, true);
});

test("symlink skill files fail closed at load", () => {
  const root = mkdtempSync(join(tmpdir(), "well-known-skills-symlink-"));
  try {
    for (const name of WELL_KNOWN_SKILL_NAMES) {
      const dir = join(root, name);
      mkdirSync(dir);
      if (name === "web-extract") {
        symlinkSync(join(REPO_ROOT, "plugins/samedaydesk-x402/skills/web-extract/SKILL.md"), join(dir, "SKILL.md"));
      } else {
        writeFileSync(join(dir, "SKILL.md"), "---\nname: x\ndescription: x\n---\n\n# x\n");
      }
    }
    assert.throws(() => loadWellKnownSkills(root), /cannot be opened without following symlinks/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("symlink skill roots and directories fail closed", () => {
  const parent = mkdtempSync(join(tmpdir(), "well-known-skills-symlink-root-"));
  try {
    const realRoot = join(parent, "real");
    mkdirSync(realRoot);
    const linkedRoot = join(parent, "linked");
    symlinkSync(realRoot, linkedRoot);
    assert.throws(() => loadWellKnownSkills(linkedRoot), /skills root must not be a symlink/);

    const rooted = join(parent, "rooted");
    mkdirSync(rooted);
    const realSkill = join(parent, "real-skill");
    mkdirSync(realSkill);
    writeFileSync(
      join(realSkill, "SKILL.md"),
      "---\nname: web-extract\ndescription: bounded\n---\n\n# bounded\n",
    );
    symlinkSync(realSkill, join(rooted, "web-extract"));
    assert.throws(() => loadWellKnownSkills(rooted), /web-extract skill directory must not be a symlink/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("oversized skill files fail closed before they are read", () => {
  const root = mkdtempSync(join(tmpdir(), "well-known-skills-oversized-"));
  try {
    for (const name of WELL_KNOWN_SKILL_NAMES) {
      const dir = join(root, name);
      mkdirSync(dir);
      writeFileSync(
        join(dir, "SKILL.md"),
        name === "web-extract"
          ? Buffer.alloc(WELL_KNOWN_SKILL_MAX_BYTES + 1, 0x61)
          : `---\nname: ${name}\ndescription: bounded\n---\n\n# bounded\n`,
      );
    }
    assert.throws(() => loadWellKnownSkills(root), /exceeds 1048576 bytes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
