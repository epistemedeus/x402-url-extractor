import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
test("offline clean tarball install prepares the same intent without a bundled wallet or repo dependencies", { timeout: 60_000 }, async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "cw35-package-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const run = (command, args, cwd = ROOT) => {
    const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  const packed = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch]))[0];
  assert.ok(packed.files.every((f) => !/node_modules|\.state|attempt-receipt|approval-request/.test(f.path)));
  const install = join(scratch, "installed");
  run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", install, join(scratch, packed.filename)]);
  const packageRoot = join(install, "node_modules/@pilot/cw02-repeat-lockfile");
  const local = JSON.parse(run(process.execPath, [join(ROOT, "bin/repeat-lockfile.mjs"), "prepare", "--job", join(ROOT, "examples/npm-change.job.json"), "--state-dir", join(scratch, "local-state")]));
  const cold = JSON.parse(run(process.execPath, [join(packageRoot, "bin/repeat-lockfile.mjs"), "prepare", "--job", join(packageRoot, "examples/npm-change.job.json"), "--state-dir", join(scratch, "cold-state")], scratch));
  assert.equal(cold.intentId, local.intentId);
  assert.equal(cold.request.bodySha256, local.request.bodySha256);
  assert.equal(cold.termsSha256, local.termsSha256);
  assert.equal(JSON.parse(await readFile(cold.approvalPath, "utf8")).permissionToSign, false);
});
