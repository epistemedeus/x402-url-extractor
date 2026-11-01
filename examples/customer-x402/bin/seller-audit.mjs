#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SELLER_AUDIT_CONTRACT } from "../src/seller-audit.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function parseArgs(argv) {
  const args = {
    command: "contract",
    approve: false,
    authorizationPath: null,
    privateKeyEnv: null,
    attemptReceiptPath: null,
    rpcUrl: null,
    url: null,
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("-")) args.command = rest.shift();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--approve") args.approve = true;
    else if (arg === "--authorization") args.authorizationPath = rest[++i];
    else if (arg === "--private-key-env") args.privateKeyEnv = rest[++i];
    else if (arg === "--attempt-receipt") args.attemptReceiptPath = rest[++i];
    else if (arg === "--rpc-url") args.rpcUrl = rest[++i];
    else if (arg === "--url") args.url = rest[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function refuse(payload, exitCode = 2) {
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(exitCode);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "contract") {
    process.stdout.write(`${JSON.stringify(SELLER_AUDIT_CONTRACT)}\n`);
    return;
  }
  if (args.command === "self-check") {
    const { runSellerAuditSelfCheck } = await import("../src/seller-audit-check.mjs");
    const result = await runSellerAuditSelfCheck();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exit(2);
    return;
  }
  if (args.command === "preflight") {
    if (args.approve || args.privateKeyEnv) {
      refuse({
        outcome: "authorization_refused",
        message: "preflight refuses approve and wallet flags",
        walletAccessed: false,
        paymentSigned: false,
        paymentSent: false,
        charged: false,
      });
    }
    if (!args.authorizationPath) {
      refuse({
        outcome: "authorization_refused",
        message: "preflight requires --authorization and does not choose a live target",
        walletAccessed: false,
        paymentSigned: false,
        paymentSent: false,
        charged: false,
      });
    }
    const authorization = readJson(args.authorizationPath);
    const { runPreflight, printPreflight } = await import("../src/preflight.mjs");
    const result = await runPreflight({
      authorization,
      url: args.url ?? authorization.url,
    });
    printPreflight(result);
    process.exit(result.outcome === "preflight_ok" ? 0 : 2);
  }
  if (args.command === "purchase") {
    if (!args.approve) {
      throw new Error("purchase requires --approve");
    }
    if (!args.authorizationPath) throw new Error("purchase requires --authorization <file>");
    if (!args.privateKeyEnv) throw new Error("purchase requires --private-key-env <ENV_VAR>");
    const { normalizeAuthorization } = await import("../src/authorization.mjs");
    const { runAuthorizedPurchase, printPurchase } = await import("../src/purchase.mjs");
    const { resolveBuyerAccount } = await import("../src/wallet.mjs");
    const authorization = normalizeAuthorization(readJson(args.authorizationPath));
    const result = await runAuthorizedPurchase({
      authorization,
      url: args.url ?? authorization.url,
      loadAccount: () => resolveBuyerAccount({ privateKey: process.env[args.privateKeyEnv] }),
      approve: true,
      attemptReceiptPath: args.attemptReceiptPath ? resolve(args.attemptReceiptPath) : null,
    });
    printPurchase(result);
    const ok = result.outcome === "valid_delivered"
      || result.outcome === "useful_delivered"
      || result.outcome === "partial_delivered";
    process.exit(ok ? 0 : 2);
  }
  if (args.command === "reconcile") {
    if (!args.attemptReceiptPath) throw new Error("reconcile requires --attempt-receipt <file>");
    if (!args.rpcUrl) throw new Error("reconcile requires --rpc-url <url>");
    if (args.approve || args.privateKeyEnv) throw new Error("reconcile refuses wallet/approve flags");
    const { readAttemptReceipt } = await import("../src/attempt-receipt.mjs");
    const { reconcileAttemptReceipt } = await import("../src/reconcile.mjs");
    const { printAttemptArtifact } = await import("../src/purchase.mjs");
    const receipt = readAttemptReceipt(args.attemptReceiptPath);
    const result = await reconcileAttemptReceipt({ receipt, rpcUrl: args.rpcUrl });
    printAttemptArtifact(result);
    const ok = result.decision === "unused_expired"
      || result.decision === "unused_within_window"
      || result.decision === "used_settlement_matched_unfinalized"
      || result.decision === "used_settlement_confirmed"
      || result.decision === "used_settlement_finalized"
      || result.decision === "used_unmatched_settlement";
    process.exit(ok ? 0 : 2);
  }
  throw new Error(`unknown command: ${args.command}`);
}

main().catch(async (error) => {
  const { AuthorizationRefusal } = await import("../src/authorization.mjs");
  const refused = error instanceof AuthorizationRefusal;
  const payload = {
    outcome: refused ? "authorization_refused" : "unknown",
    message: refused ? error.message : "seller-audit command failed",
    walletAccessed: false,
    paymentSigned: false,
    paymentSent: false,
    charged: false,
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(refused ? 2 : 1);
});
