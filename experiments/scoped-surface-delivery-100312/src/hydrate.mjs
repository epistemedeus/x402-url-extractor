import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ACCEPTED_DERIVATIVE, SKILLGUARD } from "./pins.mjs";

const JOB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hydrateRoot() {
  return process.env.SCOPED_SURFACE_HYDRATE || path.join(JOB_DIR, ".hydrate-scoped-surface-100312");
}

function fileHash(file) {
  return sha256(fs.readFileSync(file));
}

export function skillguardMatches(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return Object.entries(SKILLGUARD.files).every(([rel, hex]) => {
    const file = path.join(dir, rel);
    return fs.existsSync(file) && fileHash(file) === hex;
  });
}

function fetchCommit(repo, commit, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const run = (args) => spawnSync("git", args, { cwd: dest, encoding: "utf8" });
  const init = run(["init"]);
  if (init.status !== 0) return init;
  const remote = run(["remote", "add", "origin", repo]);
  if (remote.status !== 0) return remote;
  return run(["fetch", "--depth", "1", "origin", commit]);
}

function ensureSkillguard(root) {
  const candidates = [process.env.SKILLGUARD_ROOT, path.join(JOB_DIR, "skillguard"), path.join(root, "skillguard")];
  for (const dir of candidates) {
    if (skillguardMatches(dir)) return path.resolve(dir);
  }
  const dest = path.join(root, "skillguard");
  const fetched = fetchCommit(SKILLGUARD.repo, SKILLGUARD.commit, dest);
  if (fetched.status !== 0) {
    throw new Error("skillguard_source_unhydrated");
  }
  const checkout = spawnSync("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: dest, encoding: "utf8" });
  if (checkout.status !== 0 || !skillguardMatches(dest)) {
    throw new Error("skillguard_source_unhydrated");
  }
  return dest;
}

function ensureAuthority(root) {
  const dest = path.join(root, "accepted-derivative", "index.mjs");
  if (fs.existsSync(dest) && fileHash(dest) === ACCEPTED_DERIVATIVE.sha256) return dest;
  const scratch = path.join(root, "neo-fetch");
  const fetched = fetchCommit(ACCEPTED_DERIVATIVE.repo, ACCEPTED_DERIVATIVE.commit, scratch);
  if (fetched.status !== 0) throw new Error("authority_source_unhydrated");
  const shown = spawnSync("git", ["show", `FETCH_HEAD:${ACCEPTED_DERIVATIVE.path}`], { cwd: scratch, encoding: "buffer" });
  fs.rmSync(scratch, { recursive: true, force: true });
  if (shown.status !== 0) throw new Error("authority_source_unhydrated");
  if (sha256(shown.stdout) !== ACCEPTED_DERIVATIVE.sha256) throw new Error("authority_source_hash_mismatch");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, shown.stdout, { mode: 0o600 });
  return dest;
}

let pending = null;

export function ensurePins() {
  pending ??= (async () => {
    const root = hydrateRoot();
    fs.mkdirSync(root, { recursive: true });
    return {
      root,
      skillguardRoot: ensureSkillguard(root),
      authorityFile: ensureAuthority(root),
    };
  })();
  return pending;
}
