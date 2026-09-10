/**
 * c11 helpers: load PIN, reuse S137 release-brief conflict fixtures, spawn CLI.
 * Offline. Does not fetch, pay, or write outside the caller-supplied temp dir.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_DIR, "../../../..");
export const PIN_PATH = join(GATE_DIR, "PIN.json");
export const S137_PACK = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI_PATH = join(S137_PACK, "scripts/cli.mjs");
export const KIT_ROOT = join(REPO_ROOT, "experiments/s153-consumer-distribution-gates/kit");
export const RECEIPTS_ROOT = join(REPO_ROOT, "experiments/s153-consumer-distribution-gates/receipts");

export function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function absFromRepo(rel) {
  return join(REPO_ROOT, rel);
}

export function loadCaseSpec(relPath) {
  return JSON.parse(readFileSync(absFromRepo(relPath), "utf8"));
}

/** Schema input for buildReleaseBrief / CLI --in. Case wrappers are not merged. */
export function schemaInputOf(spec) {
  if (!spec || typeof spec !== "object" || !spec.input || typeof spec.input !== "object") {
    throw new Error("conflict case missing schema input");
  }
  return spec.input;
}

export function asBrief(result) {
  if (!result || typeof result !== "object") return result;
  if (result.brief && typeof result.brief === "object") return result.brief;
  if (result.packet && typeof result.packet === "object") return result.packet;
  return result;
}

export function runCli(args, { cwd = REPO_ROOT, timeout = 20000, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    timeout,
    cwd,
    env: { ...process.env, ...env },
  });
}

export function parseCliJson(proc) {
  if (proc.error) throw proc.error;
  try {
    return JSON.parse(proc.stdout || "");
  } catch (error) {
    throw new Error(`CLI stdout was not JSON: ${error.message}\nstdout=${proc.stdout}\nstderr=${proc.stderr}`);
  }
}

export function walkFiles(root) {
  if (!existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    const st = statSync(dir);
    if (st.isFile()) {
      out.push(dir);
      continue;
    }
    if (!st.isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (name === "." || name === "..") continue;
      stack.push(join(dir, name));
    }
  }
  return out;
}

export function relKitPath(abs) {
  return relative(KIT_ROOT, abs).split(sep).join("/");
}
