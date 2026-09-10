import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
export const PACK_ROOT = join(here, "..");
export const FIXTURES = join(PACK_ROOT, "fixtures");
export const CLI = join(PACK_ROOT, "scripts/cli.mjs");

export function fixture(...parts) {
  return join(FIXTURES, ...parts);
}

export function runCli(args, { timeout = 15000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd: PACK_ROOT,
  });
}

export function parseCliJson(proc) {
  if (proc.error) throw proc.error;
  const text = proc.stdout || "";
  return JSON.parse(text);
}
