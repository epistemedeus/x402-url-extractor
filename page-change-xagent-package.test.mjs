import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  BLOCKED_DIR_NAMES,
  DEFAULT_SLUG,
  OFFICIAL_XAGT_PLUGIN_PIN,
  VENDOR_DIR,
  VENDOR_SHA256,
  buildPageChangePackage,
  classifyExclusion,
  sha256,
} from "./scripts/page-change-xagent-package.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const officialRoot = "/home/ubuntu/work/s56/s118-xagt-plugin";

test("exclusions keep vendor source and drop validator-blocked names", () => {
  assert.equal(classifyExclusion(`${VENDOR_DIR}/compare.mjs`, Buffer.from("export const x = 1;\n")), null);
  assert.equal(classifyExclusion("service-deployment-ed25519-public.pem", Buffer.from("-----BEGIN PUBLIC KEY-----\n")), "secret_filename");
  assert.equal(classifyExclusion("node_modules/express/index.js", Buffer.from("module.exports = 1;\n")), "blocked_directory:node_modules");
  assert.equal(classifyExclusion("experiments/s118-xagent/submissions/mcp-hackathon/x/source/a.mjs", Buffer.from("export {}\n")), "contest_wrapper");
  const fakeKey = ["sk", "live", "secret", "do", "not", "store"].join("-");
  assert.equal(classifyExclusion("commerce-settlement-source-delivery.test.mjs", Buffer.from(`apiKey: "${fakeKey}"\n`)), "secret_content");
  assert.deepEqual([...BLOCKED_DIR_NAMES], ["node_modules", ".git", "dist", "build", ".next"]);
});

test("worktree package preserves vendor/ and is stdlib-runnable", { timeout: 60_000 }, async () => {
  const outDir = await mkdtemp(join(tmpdir(), "s118-xagent-package-"));
  try {
    const built = await buildPageChangePackage({
      repoRoot: root,
      worktree: true,
      outDir,
      reviewCommit: "a".repeat(40),
    });
    assert.equal(built.slug, DEFAULT_SLUG);
    assert.ok(existsSync(join(outDir, "source", VENDOR_DIR, "compare.mjs")));
    assert.ok(existsSync(join(outDir, "source", VENDOR_DIR, "NOTICE.md")));
    assert.equal(existsSync(join(outDir, "source", "service-deployment-ed25519-public.pem")), false);
    assert.equal(existsSync(join(outDir, "source", "node_modules")), false);
    assert.equal(existsSync(join(outDir, "source", ".git")), false);
    assert.ok(existsSync(join(outDir, "source", "page-change-http.mjs")));
    assert.ok(existsSync(join(outDir, "source", "scripts", "page-change-xagent-package.mjs")));
    for (const [name, digest] of Object.entries(VENDOR_SHA256)) {
      const bytes = readFileSync(join(outDir, "source", VENDOR_DIR, name));
      assert.equal(sha256(bytes), digest, name);
    }
    const submission = await readFile(join(outDir, "SUBMISSION.md"), "utf8");
    assert.match(submission, /Not submitted/);
    assert.match(submission, /vendor\//);
    const rights = await readFile(join(outDir, "RIGHTS.md"), "utf8");
    assert.match(rights, /UNSIGNED OPERATOR DRAFT/);
    assert.equal(rights.includes("SIGNED BY"), false);
    const manifest = JSON.parse(await readFile(join(outDir, "submission.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.slug, DEFAULT_SLUG);
    assert.equal(manifest.reviewCommit, "a".repeat(40));
    assert.equal(manifest.deploymentProofUrl, "https://agents.samedaydesk.com/.well-known/xagent-verification.json");
    const verification = await readFile(join(outDir, "verification", "README.md"), "utf8");
    assert.match(verification, /curl /);
    assert.match(verification, /health/);
    assert.match(verification, /missing_source_commit/);

    const compare = spawnSync(process.execPath, [
      join(outDir, "source", "examples/customer-x402/bin/page-change.mjs"),
      "compare",
      "--before",
      join(outDir, "source", "examples/customer-x402/fixtures/page-change/merchant/unchanged-before.json"),
      "--after",
      join(outDir, "source", "examples/customer-x402/fixtures/page-change/merchant/unchanged-after.json"),
      "--fields",
      "title,description",
    ], { encoding: "utf8", timeout: 20_000 });
    assert.equal(compare.status, 0, compare.stderr);
    const report = JSON.parse(compare.stdout);
    assert.equal(report.verdict, "unchanged");
    assert.equal(report.claims.fresh, false);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("commit package matches git blob bytes for included first-party files", { timeout: 30_000 }, async () => {
  const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const outDir = await mkdtemp(join(tmpdir(), "s118-xagent-commit-package-"));
  try {
    const built = await buildPageChangePackage({
      repoRoot: root,
      commit: head,
      outDir,
      reviewCommit: head,
    });
    assert.equal(built.reviewCommit, head);
    const vendor = readFileSync(join(outDir, "source", VENDOR_DIR, "compare.mjs"));
    const fromGit = spawnSync("git", ["-C", root, "show", `${head}:${VENDOR_DIR}/compare.mjs`]);
    assert.equal(sha256(vendor), sha256(fromGit.stdout));
    assert.equal(existsSync(join(outDir, "source", "service-deployment-ed25519-public.pem")), false);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("sidecar pin constant matches the package builder pin", () => {
  const sidecar = readFileSync(join(root, "scripts/page-change-xagent-sidecar.mjs"), "utf8");
  assert.match(sidecar, new RegExp(OFFICIAL_XAGT_PLUGIN_PIN));
  assert.equal(sidecar.includes("a9f5526f89ca67138174ff8f2f8aa63812683dd5"), false);
});

test("official offline validator accepts a worktree package when the pin is present", { timeout: 30_000 }, async () => {
  if (!existsSync(join(officialRoot, "scripts", "validate-submission.mjs"))) {
    return;
  }
  const pin = spawnSync("git", ["-C", officialRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const dirty = spawnSync("git", ["-C", officialRoot, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).stdout;
  if (pin !== OFFICIAL_XAGT_PLUGIN_PIN || dirty) return;
  const scratch = await mkdtemp(join(tmpdir(), "s118-xagent-validate-"));
  const outDir = join(scratch, DEFAULT_SLUG);
  try {
    await buildPageChangePackage({
      repoRoot: root,
      worktree: true,
      outDir,
      reviewCommit: "a".repeat(40),
    });
    const sidecar = spawnSync(process.execPath, [join(root, "scripts/page-change-xagent-sidecar.mjs"), outDir], {
      env: { ...process.env, XAGT_PLUGIN_ROOT: officialRoot },
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.equal(sidecar.status, 0, sidecar.stdout + sidecar.stderr);
    const report = JSON.parse(sidecar.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.officialPin, OFFICIAL_XAGT_PLUGIN_PIN);
    assert.equal(report.report.status, "pass");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
