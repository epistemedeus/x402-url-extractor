#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_BATCH_AUTHORIZATION,
  LIVE_EXTRACT_BATCH_URL,
  LIVE_EXTRACT_URL,
  LIVE_LOCKFILE_URL,
  LIVE_ORIGIN,
} from "../src/constants.mjs";
import {
  AttemptReceiptError,
  readAttemptReceipt,
  safeAttemptJson,
} from "../src/attempt-receipt.mjs";
import { AuthorizationRefusal, normalizeAuthorization } from "../src/authorization.mjs";
import { BatchAdmissionError } from "../src/batch-admission.mjs";
import { printPreflight, runPreflight } from "../src/preflight.mjs";
import { printAttemptArtifact, printPurchase, runAuthorizedPurchase } from "../src/purchase.mjs";
import { ReconcileError, reconcileAttemptReceipt } from "../src/reconcile.mjs";
import { safeJson } from "../src/redact.mjs";
import { resolveBuyerAccount } from "../src/wallet.mjs";

function usage(exitCode = 0) {
  const text = `SameDayDesk customer x402 example

Credential-free unpaid batch preflight (default; never touches a wallet):
  npm start
  npm run preflight
  npm run preflight -- --authorization ./fixtures/authorization-batch.json

Credential-free unpaid single-page GET preflight (backward compatible):
  npm run preflight:get
  npm run preflight -- --get --url '${LIVE_EXTRACT_URL}'

Construct GET /extract before the wallet (required query url=). Bare
  ${LIVE_ORIGIN}/extract without url is unsigned discovery (HTTP 402), not a purchase.

Explicit approved purchase (customer-owned wallet injection required):
  npm run purchase -- --approve --authorization ./fixtures/authorization-batch.json --private-key-env CUSTOMER_X402_PRIVATE_KEY
  npm run purchase:get -- --approve --authorization ./fixtures/authorization.json --private-key-env CUSTOMER_X402_PRIVATE_KEY

Safer purchase with customer-owned unsigned attempt receipt (opt-in):
  npm run purchase -- --approve --authorization ./fixtures/authorization-batch.json \\
    --private-key-env CUSTOMER_X402_PRIVATE_KEY --attempt-receipt ./attempt-receipt.json

Read-only reconcile of a preserved attempt receipt (no wallet; explicit RPC required):
  npm run reconcile -- --reconcile --attempt-receipt ./attempt-receipt.json --rpc-url https://example-rpc.invalid

Notes:
  - Default commands never read wallet credentials, sign, send payment headers, or pay.
  - Default route is POST ${LIVE_EXTRACT_BATCH_URL} with fixture public HTTPS URLs.
  - Local batch admission runs before any fetch or wallet lookup.
  - GET /extract requires a public HTTP(S) query url= before --approve. Empty,
    missing, duplicate, or malformed url is refused locally; a bare unpaid 402
    remains discovery. POST /lockfile-pin-delta requires JSON {before, after}
    objects; empty {} is unpaid discovery and is not signed.
  - POST ${LIVE_LOCKFILE_URL} (live 5000 atomic USDC, x402-only) uses the same
    inspect/--approve/reconcile path once --authorization binds that HTTPS URL
    and exact {before, after} body bytes. Default commands still do not pay
    lockfile; there is no auto-approve and no PAYMENT_SIGNATURE prerequisite.
    See fixtures/authorization-lockfile.json.
  - --approve binds exact HTTPS URL, method, body bytes, network, asset, recipient,
    amount cap, and buyer-required output before invoking @x402/fetch.
  - Without --attempt-receipt, unsigned EIP-3009 nonce/validBefore are not retained.
  - With --attempt-receipt, identity is persisted before paid send; write failure aborts send.
  - --reconcile is read-only: bounded RPC authorizationState/finality only; never retry/unlock/respend.
  - Authorization rejects mutated body bytes after approval; preflight and paid
    attempts send the same bytes.
  - HTTP payment credentials are never transplanted into mcp:// resources.
  - HTTP 200 / settlement headers alone do not prove required output validity.
  - A paid batch may truthfully contain failed rows (partial_delivered).
  - No application retry, timeout retry, or fallback provider payment.
  - fixtures/authorization-batch-homepages.json is a future live-trial template only.
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
    get: false,
    reconcile: false,
    url: null,
    authorizationPath: null,
    privateKeyEnv: null,
    attemptReceiptPath: null,
    rpcUrl: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--approve") args.approve = true;
    else if (arg === "--reconcile") args.reconcile = true;
    else if (arg === "--get") args.get = true;
    else if (arg === "--url") args.url = argv[++i];
    else if (arg === "--authorization") args.authorizationPath = argv[++i];
    else if (arg === "--private-key-env") args.privateKeyEnv = argv[++i];
    else if (arg === "--attempt-receipt") args.attemptReceiptPath = argv[++i];
    else if (arg === "--rpc-url") args.rpcUrl = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage(0);

  if (args.reconcile) {
    if (!args.attemptReceiptPath) {
      throw new Error("--reconcile requires --attempt-receipt <file>");
    }
    if (!args.rpcUrl) {
      throw new Error("--reconcile requires --rpc-url <url>");
    }
    if (args.approve || args.privateKeyEnv) {
      throw new Error("--reconcile refuses wallet/approve flags");
    }
    const receipt = readAttemptReceipt(args.attemptReceiptPath);
    const result = await reconcileAttemptReceipt({
      receipt,
      rpcUrl: args.rpcUrl,
    });
    printAttemptArtifact(result);
    const ok = result.decision === "unused_expired" ||
      result.decision === "unused_within_window" ||
      result.decision === "used_settlement_matched_unfinalized" ||
      result.decision === "used_settlement_confirmed" ||
      result.decision === "used_settlement_finalized" ||
      result.decision === "used_unmatched_settlement";
    process.exit(ok ? 0 : 2);
  }

  if (!args.approve) {
    let authorization;
    if (args.authorizationPath) {
      authorization = readJson(args.authorizationPath);
    } else if (args.get) {
      authorization = null;
    } else {
      authorization = DEFAULT_BATCH_AUTHORIZATION;
    }
    if (args.get && authorization && String(authorization.method || "GET").toUpperCase() !== "GET") {
      throw new Error("--get requires a GET authorization");
    }
    const result = await runPreflight({
      url: args.url ?? (args.get ? LIVE_EXTRACT_URL : authorization?.url ?? LIVE_EXTRACT_BATCH_URL),
      authorization: args.get && !args.authorizationPath
        ? null
        : authorization,
      method: args.get ? "GET" : undefined,
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
  const authorization = normalizeAuthorization(readJson(args.authorizationPath));
  if (args.get && authorization.method !== "GET") {
    throw new Error("--get requires a GET authorization");
  }
  const result = await runAuthorizedPurchase({
    authorization,
    url: args.url ?? authorization.url,
    loadAccount: () => resolveBuyerAccount({ privateKey: process.env[args.privateKeyEnv] }),
    approve: true,
    attemptReceiptPath: args.attemptReceiptPath ? resolve(args.attemptReceiptPath) : null,
  });
  printPurchase(result);
  const ok = result.outcome === "valid_delivered" ||
    result.outcome === "useful_delivered" ||
    result.outcome === "partial_delivered";
  process.exit(ok ? 0 : 2);
}

main().catch((error) => {
  if (error instanceof AuthorizationRefusal || error instanceof BatchAdmissionError) {
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
  if (error instanceof AttemptReceiptError || error instanceof ReconcileError) {
    console.error(safeAttemptJson({
      outcome: "unknown",
      message: error.message,
      code: error.code,
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
