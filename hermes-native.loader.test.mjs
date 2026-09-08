import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(REPO_ROOT, "hermes", "check-isolated-loader.py");
const REAL_HERMES = join(homedir(), ".hermes");

function runChecker(home, extraArgs = []) {
  const src = process.env.HERMES_AGENT_SRC;
  assert.ok(src, "HERMES_AGENT_SRC must point at a NousResearch/hermes-agent checkout");
  const result = spawnSync("python3", [CHECKER, ...extraArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 20000,
    env: {
      ...process.env,
      HERMES_HOME: home,
      HERMES_AGENT_SRC: src,
      PYTHONPATH: src,
    },
  });
  return result;
}

test("official Hermes skill_utils discovers all three portable skills from an isolated drop-in", () => {
  const home = mkdtempSync(join(tmpdir(), "samedaydesk-hermes-dropin-"));
  try {
    const result = runChecker(home);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.mode, "drop_in");
    assert.equal(receipt.hermes_home, home);
    assert.notEqual(receipt.hermes_home, REAL_HERMES);
    assert.deepEqual(Object.keys(receipt.skills).sort(), ["explicit-record", "page-change", "web-extract"]);
    assert.equal(receipt.payment_executed, false);
    assert.equal(receipt.model_execution, false);
    assert.equal(receipt.skills["page-change"].scan_verdict, "safe");
    assert.equal(receipt.skills["page-change"].community_install_allowed_without_force, true);
    assert.equal(receipt.skills["explicit-record"].scan_verdict, "safe");
    assert.equal(receipt.skills["explicit-record"].community_install_allowed_without_force, true);
    assert.equal(receipt.skills["web-extract"].scan_verdict, "safe");
    assert.equal(receipt.skills["web-extract"].community_install_allowed_without_force, true);
    assert.equal(receipt.skills["web-extract"].prompt_truncated, true);
    assert.equal(receipt.project_skills_dirs.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("official Hermes external_dirs loads the same skills without copying into HERMES_HOME/skills", () => {
  const home = mkdtempSync(join(tmpdir(), "samedaydesk-hermes-external-"));
  try {
    const result = runChecker(home, ["--external-dirs"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.mode, "external_dirs");
    assert.match(receipt.index_root, /plugins\/samedaydesk-x402\/skills$/);
    assert.deepEqual(Object.keys(receipt.skills).sort(), ["explicit-record", "page-change", "web-extract"]);
    assert.equal(receipt.skills["explicit-record"].scan_verdict, "safe");
    const config = readFileSync(join(home, "config.yaml"), "utf8");
    assert.match(config, /external_dirs:/);
    assert.equal(receipt.project_skills_dirs.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("official checker refuses the default profile and its descendants", () => {
  for (const home of [REAL_HERMES, join(REAL_HERMES, "r7-isolation-test")]) {
    const result = runChecker(home);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing default ~\/\.hermes/);
  }
});

test("official checker preserves nonempty named profiles in both modes", () => {
  const home = mkdtempSync(join(tmpdir(), "samedaydesk-hermes-existing-"));
  try {
    const config = join(home, "config.yaml");
    writeFileSync(config, "sentinel: preserve-me\n");
    for (const args of [[], ["--external-dirs"]]) {
      const result = runChecker(home, args);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /refusing nonempty/);
      assert.equal(readFileSync(config, "utf8"), "sentinel: preserve-me\n");
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("official checker refuses a symlink profile", () => {
  const parent = mkdtempSync(join(tmpdir(), "samedaydesk-hermes-link-"));
  const target = mkdtempSync(join(tmpdir(), "samedaydesk-hermes-target-"));
  try {
    const home = join(parent, "profile");
    symlinkSync(target, home, "dir");
    const result = runChecker(home);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing nonempty or symlink/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
