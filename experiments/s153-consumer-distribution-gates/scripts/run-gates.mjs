#!/usr/bin/env node
/**
 * Run S153 distribution gates (gates/<cell>/gate.test.mjs).
 * Offline. No payment, publication, or network.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const GATES = join(ROOT, "..", "gates");

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith("_")) continue;
    const abs = join(dir, name);
    if (!statSync(abs).isDirectory()) continue;
    const test = join(abs, "gate.test.mjs");
    try {
      if (statSync(test).isFile()) out.push(test);
    } catch {
      /* empty cell */
    }
  }
  return out;
}

const files = collect(GATES);
if (files.length === 0) {
  process.stderr.write("no gates/*/gate.test.mjs found\n");
  process.exit(1);
}

const proc = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  env: { ...process.env },
});
process.exit(proc.status ?? 1);
