#!/usr/bin/env node
import { runExtract } from "../src/run-extract.mjs";

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

const taskPath = flag("task") || process.env.N8N_EXTRACT_TASK || "";
const storeRoot = flag("store") || process.env.N8N_EXTRACT_STORE || "";

if (!taskPath || !storeRoot) {
  console.log(JSON.stringify({
    ok: false,
    status: "usage",
    exitCode: 2,
    error: "Set --task and --store, or N8N_EXTRACT_TASK and N8N_EXTRACT_STORE",
  }, null, 2));
  process.exit(2);
}

const result = await runExtract({ taskPath, storeRoot });
console.log(JSON.stringify(result, null, 2));
process.exit(result.exitCode ?? 0);
