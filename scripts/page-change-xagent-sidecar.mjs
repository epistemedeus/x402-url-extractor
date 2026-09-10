#!/usr/bin/env node
/**
 * Optional contest-prep sidecar. Reuses the official xagentAI/xagt-plugin
 * validator. Does not create RIGHTS.md, open a contest PR, sign up, deploy,
 * or claim live proof.
 *
 *   XAGT_PLUGIN_ROOT=/path/to/xagt-plugin@422f0aeb... \
 *     node scripts/page-change-xagent-sidecar.mjs [submission-directory]
 */
import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PIN = "422f0aeb5520a3506b08b05cfefcb76c6cb786c0";
if (process.argv.includes("--online") || process.env.XAGT_SIDECAR_ONLINE === "1") {
  console.error("online verification is out of scope for this sidecar");
  process.exit(2);
}
const root = String(process.env.XAGT_PLUGIN_ROOT || "").trim();
if (!root) {
  console.error(`Set XAGT_PLUGIN_ROOT to a checkout of xagentAI/xagt-plugin@${PIN}`);
  process.exit(2);
}

const validator = join(resolve(root), "scripts", "validate-submission.mjs");
try {
  const revision = execFileSync("git", ["-C", resolve(root), "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim();
  const dirty = execFileSync("git", ["-C", resolve(root), "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8", timeout: 5000 });
  if (revision !== PIN || dirty) throw new Error("official validator checkout must be clean at the exact pin");
  await access(validator);
  const pinned=execFileSync('git',['--no-replace-objects','-C',resolve(root),'show',`${PIN}:scripts/validate-submission.mjs`],{timeout:5000});
  if(!pinned.equals(await readFile(validator))) throw new Error('Validator bytes differ from pin');
} catch {
  console.error("official validator checkout is missing, dirty, or not at the exact pin");
  process.exit(2);
}

const { validateSubmissionDirectory } = await import(pathToFileURL(validator).href);
const target = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), ".."));

try {
  const report = await validateSubmissionDirectory(target, { online: false });
  process.stdout.write(`${JSON.stringify({ ok: true, officialPin: PIN, verificationMode: "offline-structure-only", liveDeploymentVerified: false, rightsVerified: false, report }, null, 2)}\n`);
} catch (error) {
  const message = String(error?.message || error);
  process.stdout.write(`${JSON.stringify({ ok: false, officialPin: PIN, error: message })}\n`);
  process.exit(1);
}
