#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const verify = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "verify-copy.mjs");
const target = process.argv[2] || "purchase";
const result = spawnSync(process.execPath, [verify, target], { stdio: "inherit" });
process.exit(result.status === null ? 2 : result.status);
