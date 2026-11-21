import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tarballName = "samedaydesk-capability-compat-0.1.0.tgz";

function run(command, args, cwd, timeout = 120_000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false" },
  });
  return result;
}

test("install-from-pack: npm pack then npm install into a temp dir runs the bin", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "capability-compat-install-"));
  try {
    const packed = run("npm", ["pack"], packDir);
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const tarball = path.join(packDir, tarballName);
    const info = await stat(tarball);
    assert.ok(info.size > 0);

    const installed = run("npm", [
      "install",
      "--ignore-scripts",
      "--prefer-offline",
      "--no-fund",
      "--no-audit",
      tarball,
    ], work);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);

    const help = run("npx", ["--no-install", "capability-compat", "help"], work);
    assert.equal(help.status, 0, help.stderr || help.stdout);
    assert.match(help.stdout, /samedaydesk-capability-compat 0\.1\.0/);
    assert.match(help.stdout, /ERA_NEGOTIATION_FAILED/);

    const pin = run("npx", ["--no-install", "capability-compat", "pin"], work);
    assert.equal(pin.status, 0, pin.stderr || pin.stdout);
    const body = JSON.parse(pin.stdout);
    assert.equal(body.package, "samedaydesk-capability-compat");
    assert.equal(body.version, "0.1.0");
    assert.equal(body.tool, "compare_page_observations");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
