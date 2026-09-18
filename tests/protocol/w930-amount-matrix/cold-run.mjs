#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REFUSED_FLAGS } from "./constants.mjs";
import { runCold } from "./check.mjs";

function refusedFlag(argv) {
  for (const arg of argv) {
    const name = String(arg).replace(/^--/, "");
    if (REFUSED_FLAGS.includes(name)) return arg;
  }
  return null;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  const refused = refusedFlag(argv);
  if (refused) {
    console.error(`${refused} is refused`);
    process.exitCode = 2;
  } else if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: node tests/protocol/w930-amount-matrix/cold-run.mjs [--origin http://127.0.0.1:PORT]");
    console.log("Default: spawn local server.js. Unpaid GET/MCP/OpenAPI only. No payment headers.");
    process.exitCode = 0;
  } else {
    process.exitCode = await runCold(argv);
  }
}
