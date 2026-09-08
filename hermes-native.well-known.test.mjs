import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(REPO_ROOT, "hermes", "check-well-known-adapter.py");
const REAL_HERMES = join(homedir(), ".hermes");
const PYTHON = process.env.HERMES_PYTHON || "python3";

function runChecker(home, origin) {
  const src = process.env.HERMES_AGENT_SRC;
  assert.ok(src, "HERMES_AGENT_SRC must point at a NousResearch/hermes-agent checkout");
  const pythonPath = [process.env.HERMES_PYDEPS, src, process.env.PYTHONPATH]
    .filter(Boolean)
    .join(delimiter);
  return spawnSync(PYTHON, [CHECKER, "--origin", origin], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 45_000,
    env: {
      ...process.env,
      HERMES_HOME: home,
      HERMES_AGENT_SRC: src,
      PYTHONPATH: pythonPath,
      PYTHONDONTWRITEBYTECODE: "1",
    },
  });
}

test("official well-known adapter refuses the default profile", () => {
  const result = runChecker(REAL_HERMES, "http://127.0.0.1:9");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing default ~\/\.hermes/);
});

test("official well-known adapter records the loopback SSRF boundary without bypass", () => {
  const home = mkdtempSync(join(tmpdir(), "samedaydesk-hermes-well-known-"));
  try {
    const result = runChecker(home, "http://127.0.0.1:9");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.official_is_safe_url, false);
    assert.equal(receipt.loopback_or_local_host, true);
    assert.equal(receipt.force, false);
    assert.equal(receipt.private_url_bypass, false);
    assert.equal(receipt.model_execution, false);
    assert.equal(receipt.payment_executed, false);
    assert.equal(receipt.mocked_origin, false);
    assert.equal(receipt.search_count, 0);
    assert.equal(receipt.inspect, null);
    assert.equal(receipt.fetch_files, null);
    assert.equal(receipt.installed, false);
    assert.equal(receipt.boundary, "official_ssrf_guard_blocks_loopback_or_private_origin");
    assert.equal(receipt.adapter, "tools.skills_hub_sources.WellKnownSkillSource");
    assert.match(receipt.postdeploy_commands[0], /hermes skills search https:\/\/agents\.samedaydesk\.com --source well-known/);
    assert.match(receipt.postdeploy_commands[4], /hermes skills install well-known:https:\/\/agents\.samedaydesk\.com\/\.well-known\/skills\/web-extract --yes/);
    assert.doesNotMatch(receipt.postdeploy_commands.join("\n"), /127\.0\.0\.1|localhost/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("official well-known adapter against live HTTPS records undeployed index, not mock-live success", () => {
  const home = mkdtempSync(join(tmpdir(), "samedaydesk-hermes-well-known-live-"));
  try {
    const result = runChecker(home, "https://agents.samedaydesk.com");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.official_is_safe_url, true);
    assert.equal(receipt.loopback_or_local_host, false);
    assert.equal(receipt.force, false);
    assert.equal(receipt.private_url_bypass, false);
    assert.equal(receipt.mocked_origin, false);
    assert.equal(receipt.model_execution, false);
    assert.equal(receipt.payment_executed, false);
    if (receipt.ok) {
      assert.deepEqual(receipt.search_names.sort(), ["explicit-record", "page-change", "web-extract"]);
      assert.equal(receipt.installed, true);
      assert.equal(receipt.boundary, null);
    } else {
      assert.equal(receipt.search_count, 0);
      assert.equal(receipt.inspect, null);
      assert.equal(receipt.fetch_files, null);
      assert.equal(receipt.installed, false);
      assert.equal(receipt.boundary, "live_https_index_unavailable_until_deploy");
    }
    assert.match(receipt.postdeploy_commands[0], /hermes skills search https:\/\/agents\.samedaydesk\.com --source well-known/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
