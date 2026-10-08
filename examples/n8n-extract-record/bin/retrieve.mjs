#!/usr/bin/env node
import { runRetrieveFromPaths } from "../src/run-retrieve.mjs";

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

const result = runRetrieveFromPaths({
  storeRoot: flag("store") || process.env.N8N_EXTRACT_STORE || "",
  artifactId: flag("artifact") || process.env.N8N_EXTRACT_ARTIFACT || "",
  taskPath: flag("task") || process.env.N8N_EXTRACT_TASK || "",
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.exitCode ?? 0);
