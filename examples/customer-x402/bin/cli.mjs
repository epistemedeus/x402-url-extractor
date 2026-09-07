#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LIVE_EXTRACT_URL } from "../src/constants.mjs";
import { AuthorizationRefusal } from "../src/authorization.mjs";
import { printPreflight, runPreflight } from "../src/preflight.mjs";
import { printPurchase, runAuthorizedPurchase } from "../src/purchase.mjs";
import { safeJson } from "../src/redact.mjs";
import { resolveBuyerAccount } from "../src/wallet.mjs";

function usage(exitCode = 0) {
  const text = `SameDayDesk customer x402 example

Credential-free unpaid preflight (default; never touches a wallet):
  npm start
  npm run preflight -- --url '${LIVE_EXTRACT_URL}'

Explicit approved purchase (customer-owned wallet injection required):
  npm run purchase -- --approve --authorization ./fixtures/authorization.json --private-key-env CUSTOMER_X402_PRIVATE_KEY

Notes:
  - Default commands never read wallet credentials, sign, send payment headers, or pay.
  - --approve binds exact HTTPS origin/path/query, method, network, asset, recipient,
    amount cap, and buyer-required output before invoking @x402/fetch.
  - HTTP payment credentials are never transplanted into mcp:// resources.
  - HTTP 200 / settlement headers alone do not prove required output validity.
  - No application retry, timeout retry, or fallback provider payment.
`;
  console.log(text);
  process.exit(exitCode);
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function parseArgs(argv) {
  const args = {
    approve: false,
    help: false,
    url: null,
    authorizationPath: null,
    privateKeyEnv: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--approve") args.approve = true;
    else if (arg === "--url") args.url = argv[++i];
    else if (arg === "--authorization") args.authorizationPath = argv[++i];
    else if (arg === "--private-key-env") args.privateKeyEnv = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage(0);

  if (!args.approve) {
    const authorization = args.authorizationPath ? readJson(args.authorizationPath) : null;
    const result = await runPreflight({
      url: args.url ?? LIVE_EXTRACT_URL,
      authorization,
    });
    printPreflight(result);
    process.exit(result.outcome === "preflight_ok" ? 0 : 2);
  }

  if (!args.authorizationPath) {
    throw new Error("--approve requires --authorization <file>");
  }
  if (!args.privateKeyEnv) {
    throw new Error("--approve requires --private-key-env <ENV_VAR> (value is never printed)");
  }
  const authorization = readJson(args.authorizationPath);
  const result = await runAuthorizedPurchase({
    authorization,
    url: args.url ?? authorization.url,
    loadAccount: () => resolveBuyerAccount({ privateKey: process.env[args.privateKeyEnv] }),
    approve: true,
  });
  printPurchase(result);
  process.exit(result.outcome === "valid_delivered" ? 0 : 2);
}

main().catch((error) => {
  if (error instanceof AuthorizationRefusal) {
    console.error(safeJson({
      outcome: "authorization_refused",
      message: error.message,
      field: error.field,
      walletAccessed: false,
      paymentSigned: false,
      paymentSent: false,
    }));
    process.exit(2);
  }
  console.error(safeJson({
    outcome: "unknown",
    message: "configuration or unpaid preflight failed",
    walletAccessed: false,
    paymentSigned: false,
    paymentSent: false,
  }));
  process.exit(1);
});
