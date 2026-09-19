#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REFUSED_FLAGS } from "./constants.mjs";
import { evaluateAmountMatrix } from "./evaluate.mjs";
import { captureUnpaidMatrix, isLoopbackOrigin, startLocalMerchant } from "./probe.mjs";

function refusedFlag(argv) {
  for (const arg of argv) {
    const name = String(arg).replace(/^--/, "");
    if (REFUSED_FLAGS.includes(name)) return arg;
  }
  return null;
}

function originFromArgv(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === "--origin") {
      const value = argv[i + 1];
      if (!value || String(value).startsWith("--")) return { error: "missing" };
      return { value };
    }
    if (arg.startsWith("--origin=")) {
      const value = arg.slice("--origin=".length);
      if (!value) return { error: "missing" };
      return { value };
    }
  }
  return { value: null };
}

export async function runCold(argv = process.argv.slice(2)) {
  const refused = refusedFlag(argv);
  if (refused) {
    console.error(`${refused} is refused`);
    return 2;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: node tests/protocol/unpaid-amount-matrix/cold-run.mjs [--origin http://127.0.0.1:PORT]");
    console.log("Default: spawn local server.js. Unpaid GET/MCP/OpenAPI only. No payment headers.");
    return 0;
  }

  const parsedOrigin = originFromArgv(argv);
  if (parsedOrigin.error) {
    console.error("--origin requires a loopback URL");
    return 2;
  }
  const origin = parsedOrigin.value;
  if (origin && !isLoopbackOrigin(origin)) {
    console.error(`${origin} is refused; unpaid matrix is loopback-only`);
    return 2;
  }
  let merchant = null;
  try {
    const base = origin || (merchant = await startLocalMerchant()).base;
    const captured = await captureUnpaidMatrix(base);
    const report = evaluateAmountMatrix(captured);
    report.coldRun = {
      base,
      spawned: !origin,
      paymentHeadersSent: false,
      facilitatorSettleCalled: false,
    };
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  } finally {
    if (merchant) await merchant.close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  process.exitCode = await runCold();
}
