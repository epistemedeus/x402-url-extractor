#!/usr/bin/env node
import { resolve } from "node:path";

import { AcquireError, acquireUpstream } from "../src/acquire.mjs";
import {
  BASEPAY_REPO,
  BASEPAY_TIP_COMMIT,
  MAPPING_GIT_BLOB,
  MAPPING_PATH,
  RESULT_GIT_BLOB,
  RESULT_PATH,
} from "../src/pins.mjs";
import { UPSTREAM_RUNTIME_DIR } from "../src/paths.mjs";

function usage(exitCode = 0) {
  const text = `SameDayDesk BasePay optional upstream acquire

Downloads the two pinned BasePay JSON reports into a gitignored runtime
directory, verifies git-blob SHA-1 (sha1("blob " + len + "\\0" + bytes)) and
sha256 against pins, and writes RECEIPT.json.

Download only. Never executes downloaded bytes. Never imports them as Node
code. This is not a license grant.

Default:
  npm run acquire-upstream
  node bin/acquire-upstream.mjs

Options:
  --out DIR          Destination directory (default: runtime/upstream)
  --source-dir DIR   Copy local bytes instead of HTTPS (still pin-verified)

Pins:
  repo     ${BASEPAY_REPO}
  commit   ${BASEPAY_TIP_COMMIT}
  result   ${RESULT_PATH}  git blob ${RESULT_GIT_BLOB}
  mapping  ${MAPPING_PATH}  git blob ${MAPPING_GIT_BLOB}
`;
  console.log(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { help: false, destDir: UPSTREAM_RUNTIME_DIR, sourceDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--out") args.destDir = resolve(argv[++i]);
    else if (token === "--source-dir") args.sourceDir = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(String(error?.message || error));
    usage(1);
    return;
  }
  if (args.help) {
    usage(0);
    return;
  }
  try {
    const receipt = await acquireUpstream({
      destDir: args.destDir,
      sourceDir: args.sourceDir,
    });
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    const message = error instanceof AcquireError
      ? error.message
      : String(error?.message || error);
    console.error(message);
    process.exitCode = 1;
  }
}

await main();
