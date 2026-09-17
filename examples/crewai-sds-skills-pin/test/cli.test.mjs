import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { DEFAULT_SKILLS_ROOT } from "../src/paths.mjs";
import { SCHEMA, SKILL_NAMES, SKILL_PINS } from "../src/pins.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin/cli.mjs");

function run(args, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, expectStatus, result.stderr || result.stdout);
  return result;
}

test("default CLI prints Agent.skills=[] populated from digest-pinned SDS SKILL.md", () => {
  const result = run([]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.schema, SCHEMA);
  assert.deepEqual(report.agent.skills, [DEFAULT_SKILLS_ROOT]);
  assert.equal(report.agent.skills.length, 1);
  assert.deepEqual(report.skills.map((skill) => skill.name), [...SKILL_NAMES]);
  for (const [i, pin] of SKILL_PINS.entries()) {
    assert.equal(report.skills[i].sha256, pin.sha256);
    assert.equal(report.skills[i].bytes, pin.bytes);
    assert.equal(report.skills[i].gitBlobSha, pin.gitBlobSha);
  }
  assert.equal(report.boundary.registry, false);
  assert.equal(report.boundary.remoteFetch, false);
  assert.equal(report.boundary.payment, false);
  assert.equal(report.boundary.publish, false);
  assert.equal(report.boundary.llm, false);
  assert.match(report.python, /from crewai import Agent/);
  assert.match(report.python, /skills=\[SDS_SKILLS\]/);
  assert.equal(report.python.includes("@"), false);
});

test("CLI help lists advertised pin and seeded-failure commands", () => {
  const result = run(["--help"]);
  assert.match(result.stdout, /npm start/);
  assert.match(result.stdout, /node bin\/cli\.mjs/);
  assert.match(result.stdout, /--seeded-failure/);
  assert.match(result.stdout, /Agent\.skills/);
  assert.match(result.stdout, /registry/);
  assert.doesNotMatch(result.stdout, /crewai skill publish/);
});

test("seeded failure rejects the wrong web-extract digest", () => {
  const result = run(["--seeded-failure"], { expectStatus: 1 });
  assert.match(result.stderr, /^digest_mismatch:/);
  assert.match(result.stderr, /web-extract sha256 382e45d33e95b81dd27c2ab38c576118159a37af2d776bc0620ecf9b472d3551 does not match pin 0000000000000000000000000000000000000000000000000000000000000000/);
  assert.equal(result.stdout, "");
});

test("pins fixture path is the same seeded failure", () => {
  const result = run(["--pins", "./fixtures/seeded-failure/digest-mismatch.json"], { expectStatus: 1 });
  assert.match(result.stderr, /digest_mismatch: web-extract sha256 /);
});

test("registry refs and remote URLs are refused", () => {
  const registry = run(["--skills", "@acme/web-extract"], { expectStatus: 1 });
  assert.match(registry.stderr, /registry_ref:/);
  const url = run(["--skills-root", "https://agents.samedaydesk.com/.well-known/skills"], { expectStatus: 1 });
  assert.match(url.stderr, /remote_url:/);
});

test("unknown CLI arguments fail closed", () => {
  run(["--wallet"], { expectStatus: 1 });
  run(["--publish"], { expectStatus: 1 });
});
