import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = join(ROOT, "bin/cli.mjs");
export const RECORDED = join(ROOT, "fixtures/recorded");
export const PAID_DELIVERY = join(ROOT, "fixtures/hostile/paid-delivery.json");
export const MISSING_EXTRACT = join(ROOT, "fixtures/hostile/missing-extract.json");

export function run(args, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== expectStatus) {
    const detail = result.stderr || result.stdout;
    throw new Error(`expected exit ${expectStatus}, got ${result.status}: ${detail}`);
  }
  return result;
}

export function runJson(args, options) {
  const result = run(args, options);
  const text = (result.stdout || result.stderr).trim();
  return { result, report: JSON.parse(text) };
}
