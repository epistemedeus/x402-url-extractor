import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SKILLGUARD } from "./pins.mjs";
import { authorityMatches, skillguardMatches } from "./scanner-pin.mjs";

const JOB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export function hydrateRoot() {
  return process.env.SCOPED_SURFACE_HYDRATE || path.join(JOB_DIR, ".hydrate-scoped-surface-100312");
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

function publicCandidates() {
  return [
    process.env.SKILLGUARD_ROOT,
    process.env.SCOPED_SURFACE_HYDRATE ? path.join(process.env.SCOPED_SURFACE_HYDRATE, "skillguard") : null,
    path.join(hydrateRoot(), "skillguard"),
  ];
}

// Public scanner only. This does not fetch Neo and does not read a gh token.
export async function ensurePublicScanner() {
  for (const dir of publicCandidates()) {
    if (skillguardMatches(dir)) return { skillguardRoot: path.resolve(dir), authorityFile: null };
  }
  const dest = path.join(hydrateRoot(), "skillguard");
  const fetched = fetchCommit(SKILLGUARD.repo, SKILLGUARD.commit, dest);
  if (fetched.status !== 0) throw Object.assign(new Error("skillguard_source_unhydrated"), { code: "skillguard_source_unhydrated" });
  const checkout = spawnSync("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: dest, encoding: "utf8" });
  if (checkout.status !== 0 || !skillguardMatches(dest)) {
    throw Object.assign(new Error("skillguard_source_unhydrated"), { code: "skillguard_source_unhydrated" });
  }
  return { skillguardRoot: dest, authorityFile: null };
}

export function findRetentionAuthority(extra = []) {
  const candidates = [
    process.env.SCOPED_SURFACE_AUTHORITY,
    ...extra,
    path.join(hydrateRoot(), "accepted-derivative", "index.mjs"),
  ];
  for (const file of candidates) {
    if (authorityMatches(file)) return path.resolve(file);
  }
  return null;
}

// Missing private authority is a limit. It is not a fetch and not acceptance.
export function ensureRetentionAuthority() {
  const authorityFile = findRetentionAuthority();
  if (!authorityFile) {
    return {
      available: false,
      authorityFile: null,
      reason: "retention_authority_unavailable",
    };
  }
  return { available: true, authorityFile, reason: null };
}

export async function ensurePins() {
  return ensurePublicScanner();
}
