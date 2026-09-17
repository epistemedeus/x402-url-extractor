#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";

import { startEmptyAcceptsServer } from "./fixture.mjs";
import {
  EMPTY_ACCEPTS_CODE,
  EmptyAcceptsError,
  neverSettledProof,
  throwIfEmptyAccepts,
  throwOnEmptyAcceptsResponse,
} from "./throw.mjs";

function usage() {
  return [
    "x402 empty-accepts throw fixture; never settle.",
    "Usage:",
    "  node tests/protocol/empty-accepts/run.mjs",
    "  node tests/protocol/empty-accepts/run.mjs --seeded-failure",
  ].join("\n");
}

function throwingSigner() {
  return {
    address: "0x1111111111111111111111111111111111111111",
    async signTypedData() {
      throw new Error("signer must not be used for empty accepts");
    },
  };
}

function createClient() {
  return new x402Client().register("eip155:8453", new ExactEvmScheme(throwingSigner()));
}

function fail(message) {
  throw new Error(message);
}

async function proveThrow(url, { expectSettlementClaim = false } = {}) {
  const unpaid = await fetch(url, { method: "GET", redirect: "error", headers: { accept: "application/json" } });
  if (unpaid.status !== 402) fail(`expected HTTP 402, received ${unpaid.status}`);

  let threw = null;
  try {
    await throwOnEmptyAcceptsResponse(unpaid);
  } catch (error) {
    threw = error;
  }
  if (!(threw instanceof EmptyAcceptsError) || threw.code !== EMPTY_ACCEPTS_CODE) {
    fail("empty-accepts gate did not throw EmptyAcceptsError");
  }
  if (threw.settled !== false || threw.settlementVerification !== "absent") {
    fail("empty-accepts throw leaked a settlement claim");
  }
  if (expectSettlementClaim && !threw.settlementClaim?.present) {
    fail("seeded failure did not surface the hostile PAYMENT-RESPONSE claim");
  }
  if (!expectSettlementClaim && threw.settlementClaim) {
    fail("cold empty-accepts response carried a settlement header");
  }

  const client = createClient();
  let wrapThrew = null;
  try {
    await wrapFetchWithPayment(fetch, client)(url, { method: "GET", redirect: "error" });
  } catch (error) {
    wrapThrew = error;
  }
  if (!wrapThrew) fail("official wrapFetchWithPayment settled or returned instead of throwing");

  return {
    httpStatus: unpaid.status,
    gate: {
      code: threw.code,
      settled: threw.settled,
      settlementVerification: threw.settlementVerification,
      settlementClaim: threw.settlementClaim,
    },
    officialClient: { threw: true, message: wrapThrew.message },
  };
}

export async function coldRun() {
  const fixture = await startEmptyAcceptsServer();
  try {
    const proof = await proveThrow(fixture.url);
    if (fixture.stats.paidAttempts !== 0) fail("cold run sent a PAYMENT-SIGNATURE");
    if (fixture.stats.settleCalls !== 0) fail("cold run called facilitator settle");
    return {
      mode: "cold",
      ok: true,
      url: fixture.url,
      ...proof,
      stats: { ...fixture.stats },
      neverSettle: neverSettledProof(fixture.stats),
    };
  } finally {
    await fixture.close();
  }
}

export async function seededFailure() {
  const fixture = await startEmptyAcceptsServer();
  try {
    const proof = await proveThrow(fixture.seededUrl, { expectSettlementClaim: true });
    if (fixture.stats.paidAttempts !== 0) fail("seeded failure sent a PAYMENT-SIGNATURE");
    if (fixture.stats.settleCalls !== 0) fail("seeded failure called facilitator settle");

    const naive = {
      accepts: [],
      settlement: { success: true, transaction: "0xdead" },
    };
    let naiveRejected = false;
    try {
      throwIfEmptyAccepts(naive, { settlement: { present: true, success: true } });
    } catch (error) {
      naiveRejected = error instanceof EmptyAcceptsError && error.settled === false;
    }
    if (!naiveRejected) fail("seeded naive settler was not rejected");

    return {
      mode: "seeded-failure",
      ok: true,
      rejected: true,
      url: fixture.seededUrl,
      ...proof,
      stats: { ...fixture.stats },
      neverSettle: neverSettledProof(fixture.stats),
    };
  } finally {
    await fixture.close();
  }
}

export async function main(argv) {
  const args = argv.filter((arg) => arg !== "--json");
  const json = argv.includes("--json");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return 0;
  }
  if (args.some((arg) => arg === "--settle" || arg === "--pay" || arg === "--checkout")) {
    console.error("empty-accepts fixture never settles");
    return 2;
  }

  const result = args.includes("--seeded-failure") ? await seededFailure() : await coldRun();
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.mode}: threw ${result.gate.code}; settled=${result.neverSettle.settled}; paidAttempts=${result.stats.paidAttempts}; settleCalls=${result.stats.settleCalls}`);
    if (result.rejected) console.log("seeded failure rejected");
  }
  return result.ok && result.neverSettle.settled === false ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
