import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

export const E08_PIN = "d5c5ab3606ba2f79d5bdfec6afb347b566966573";

function run(cmd, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(0, 400)}`));
      } else resolve(Buffer.concat(out).toString("utf8"));
    });
  });
}

function archiveInto(repoRoot, dir) {
  return new Promise((resolve, reject) => {
    const git = spawn("git", ["-C", repoRoot, "archive", E08_PIN, "experiments/ae14-async-delivery"], { stdio: ["ignore", "pipe", "pipe"] });
    const tar = spawn("tar", ["-C", dir, "-x"], { stdio: ["pipe", "ignore", "pipe"] });
    const err = [];
    let gitCode = null;
    let tarCode = null;
    let settled = false;
    const finish = () => {
      if (settled || gitCode === null || tarCode === null) return;
      settled = true;
      if (gitCode !== 0 || tarCode !== 0) {
        reject(new Error(`archive exited git=${gitCode} tar=${tarCode}: ${Buffer.concat(err).toString("utf8").slice(0, 400)}`));
      } else resolve();
    };
    git.stderr.on("data", (chunk) => err.push(chunk));
    tar.stderr.on("data", (chunk) => err.push(chunk));
    git.stdout.pipe(tar.stdin);
    git.on("error", (error) => { if (!settled) { settled = true; reject(error); } });
    tar.on("error", (error) => { if (!settled) { settled = true; reject(error); } });
    git.on("close", (code) => { gitCode = code; finish(); });
    tar.on("close", (code) => { tarCode = code; finish(); });
  });
}

/** Materialize E08 at its pin and prove every file blob matches `git rev-parse`. */
export async function materializeE08({ repoRoot, pgModule }) {
  const dir = await mkdtemp(join(tmpdir(), "ae19-e08-"));
  await archiveInto(repoRoot, dir);
  const root = join(dir, "experiments/ae14-async-delivery");
  const listed = (await run("git", ["-C", repoRoot, "ls-tree", "-r", "--name-only", E08_PIN, "experiments/ae14-async-delivery"])).trim().split("\n");
  const checks = [];
  for (const path of listed) {
    if (!path) continue;
    const blob = (await run("git", ["-C", repoRoot, "rev-parse", `${E08_PIN}:${path}`])).trim();
    const hashed = (await run("git", ["hash-object", join(dir, path)])).trim();
    checks.push({ path, blob, hashed, equal: blob === hashed });
  }
  if (checks.some((row) => !row.equal)) {
    const error = new Error("e08_pin_mismatch");
    error.code = "e08_pin_mismatch";
    throw error;
  }
  await mkdir(join(root, "node_modules"), { recursive: true });
  await symlink(pgModule, join(root, "node_modules/pg"));
  return { root, pin: E08_PIN, files: checks.length };
}

export async function loadUnchangedE08(root) {
  const href = (rel) => pathToFileURL(join(root, rel)).href;
  const [service, helpers, standIn] = await Promise.all([
    import(href("src/service.mjs")),
    import(href("test/helpers.mjs")),
    import(href("src/stand-in-port.mjs")),
  ]);
  return { ...service, ...helpers, standIn, root, pin: E08_PIN };
}

/**
 * E08's deliverOutput consumes an extraction artifact. E08 source is not modified.
 * The funded accept/reuse path stays on the unchanged service.
 */
export async function handExtractionToE08(e08, ctx, artifact) {
  const funded = await e08.fund(ctx, { gross: "105263" });
  const delivered = await ctx.service.deliverOutput(e08.actors().worker, funded.opened.jobId, {
    kind: artifact.kind,
    body: artifact.body,
    digest: artifact.digest,
  });
  const accepted = await ctx.service.accept(e08.actors().reviewer, funded.opened.jobId, {
    artifactDigest: artifact.digest,
  });
  const acceptedAgain = await ctx.service.accept(e08.actors().reviewer, funded.opened.jobId, {
    artifactDigest: artifact.digest,
  });
  const stored = await ctx.journal.read(funded.opened.jobId);
  const port = await ctx.port.load(funded.proofId);
  const reused = await ctx.service.reuse(e08.actors().later, funded.opened.jobId);
  const portAfter = await ctx.port.load(funded.proofId);
  return { funded, delivered, accepted, acceptedAgain, stored, port, reused, portAfter };
}

export function sha256File(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function readPinBytes(root, rel) {
  return readFile(join(root, rel));
}
