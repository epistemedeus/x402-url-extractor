#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runLockfilePinDeltaUnpaidCli } from "./lib.mjs";

async function main() {
  try {
    process.exitCode = await runLockfilePinDeltaUnpaidCli();
  } catch (error) {
    console.error(`${error.name || "Error"}: ${error.message}`);
    process.exitCode = error?.code === "invalid_args" || error?.code === "owner_refresh_refused" ? 2 : 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  await main();
}
