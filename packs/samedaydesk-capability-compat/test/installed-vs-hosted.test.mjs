import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compareInstalledVsHosted, loadHostedAcquisitionReference, PIN } from "../src/index.mjs";

const packDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tarball = path.join(packDir, "samedaydesk-capability-compat-0.1.0.tgz");

test("installed-vs-hosted comparison records steps, wall time, and bytes only", () => {
  spawnSync("npm", ["pack"], {
    cwd: packDir,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false" },
  });
  const report = compareInstalledVsHosted({
    installedTarballPath: tarball,
    packDirectory: packDir,
  });
  const reference = loadHostedAcquisitionReference();

  assert.equal(report.liveClaimed, false);
  assert.equal(report.network, false);
  assert.equal(report.charged, false);
  assert.equal(report.documentedHostedEntryLive, false);
  assert.equal(report.documentedHostedEntry, PIN.documentedHostedEntry);
  assert.equal(report.hosted.sha, "3232f2891e7af5df3c2a350c764bfdc9d35b1f12");
  assert.equal(report.hosted.bytes, reference.artifacts.reduce((sum, item) => sum + item.bytes, 0));
  assert.equal(typeof report.wallMs, "number");
  assert.ok(report.wallMs >= 0);
  assert.ok(Array.isArray(report.steps));
  assert.ok(report.steps.some((item) => item.name === "load-hosted-reference" && item.network === false && item.liveClaimed === false));
  assert.ok(report.steps.some((item) => item.name === "measure-installed-tarball"));
  assert.equal(typeof report.bytes.hosted, "number");
  assert.ok(report.bytes.hosted > 0);
  if (report.installed.bytes !== null) {
    assert.ok(report.installed.bytes > 0);
    assert.equal(report.bytes.installed, report.installed.bytes);
  }
  assert.equal(report.usefulResult, "comparison-recorded");
  assert.equal("percent" in report, false);
  assert.equal("margin" in report, false);
});
