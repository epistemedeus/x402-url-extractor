#!/usr/bin/env node
/**
 * Acceptance CLI for W7: MCP HTTP 200 + result.isError is never paid.
 *
 *   node tests/protocol/mcp-200-iserror-w7/check.mjs --cold
 *   node tests/protocol/mcp-200-iserror-w7/check.mjs --seeded-failure
 *
 * Cold mounts mcp-server.mjs on loopback with a fake facilitator.
 * Never pays, never hits a public merchant, never uses --live.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  KIND,
  classifyMcpHttpResponse,
  naiveHttp2xxPaidInference,
  rejectPaidClaimIfHttp200IsError,
} from "./classify-mcp-http.mjs";
import { startMounted, unpaidAccepts } from "./helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SEEDED_HTTP_200_ISERROR = path.join(
  here,
  "fixtures/seeded-false-paid-http-2xx-iserror.json",
);
const REFUSED_FLAGS = Object.freeze([
  "--live",
  "--refresh",
  "--cdp",
  "--poll",
  "--pay",
  "--payment",
  "--payment-signature",
]);

function print(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function help() {
  return `x402 MCP HTTP 200 isError is never paid.

Usage:
  node tests/protocol/mcp-200-iserror-w7/check.mjs --cold
  node tests/protocol/mcp-200-iserror-w7/check.mjs --seeded-failure
  node tests/protocol/mcp-200-iserror-w7/check.mjs --claim <fixture.json>

Cold run mounts mcp-server.mjs on loopback. Never pays. --live is refused.
`;
}

function observationOf(claim) {
  return {
    httpStatus: claim.httpStatus,
    body: claim.body,
    contentType: claim.contentType || "",
    requestPaymentPresent: claim.requestPaymentPresent === true,
  };
}

async function runCold() {
  const mounted = await startMounted();
  try {
    const { unpaid, accepts } = await unpaidAccepts(
      mounted.origin,
      "enrich",
      "domain",
      "example.invalid",
      11,
    );
    await mounted.drain();
    const observation = {
      httpStatus: unpaid.status,
      body: unpaid.body,
      contentType: unpaid.contentType,
      requestPaymentPresent: false,
    };
    const classified = classifyMcpHttpResponse(observation);
    const naive = naiveHttp2xxPaidInference(observation);
    const paidClaim = rejectPaidClaimIfHttp200IsError(observation, {
      paid: true,
      result: "paid_success",
    });
    const acceptList = unpaid.json?.result?.structuredContent?.accepts;
    const ok = unpaid.status === 200
      && unpaid.json?.result?.isError === true
      && classified.paid === false
      && classified.isError === true
      && classified.kind === KIND.CHALLENGE
      && classified.kind !== KIND.PAID_SUCCESS
      && paidClaim.rejected === true
      && Array.isArray(acceptList)
      && acceptList.length >= 1
      && Boolean(accepts)
      && mounted.calls.settle === 0
      && (mounted.calls.handler.enrich || 0) === 0
      && mounted.calls.external === 0
      && mounted.events[0]?.result === "challenge";
    return {
      ok,
      product: "mcp-200-iserror-w7",
      schemaVersion: classified.schemaVersion,
      outcome: ok ? "unpaid_call_is_error" : "cold_failed",
      isError: classified.isError,
      paid: classified.paid,
      kind: classified.kind,
      charged: false,
      liveMerchantCall: false,
      paymentSent: false,
      naiveWouldHavePaid: naive === "paid_success",
      paidClaimRejected: paidClaim.rejected === true,
      paidClaimCode: paidClaim.code,
      wire: {
        httpStatus: unpaid.status,
        isError: unpaid.json?.result?.isError === true,
        jsonrpc: unpaid.json?.jsonrpc || null,
        hasStructuredAccepts: Array.isArray(acceptList) && acceptList.length >= 1,
        acceptCount: Array.isArray(acceptList) ? acceptList.length : 0,
        paymentRequiredHeader: unpaid.headers?.["payment-required"] || null,
        paymentResponseHeader: unpaid.headers?.["payment-response"] || null,
        x402Version: unpaid.json?.result?.structuredContent?.x402Version ?? null,
        error: unpaid.json?.result?.structuredContent?.error ?? null,
      },
      calls: {
        settle: mounted.calls.settle,
        verify: mounted.calls.verify,
        handlerEnrich: mounted.calls.handler.enrich || 0,
        external: mounted.calls.external,
      },
      telemetry: mounted.events[0]?.result || null,
      resultSnippet: {
        isError: unpaid.json?.result?.isError === true,
        hasStructuredContent: Boolean(unpaid.json?.result?.structuredContent),
        contentCount: Array.isArray(unpaid.json?.result?.content)
          ? unpaid.json.result.content.length
          : 0,
      },
    };
  } finally {
    await mounted.close();
  }
}

async function runSeededFailure(claimPath = SEEDED_HTTP_200_ISERROR) {
  const claim = JSON.parse(await readFile(claimPath, "utf8"));
  const observation = observationOf(claim);
  const classified = classifyMcpHttpResponse(observation);
  const naive = naiveHttp2xxPaidInference(observation);
  const rejected = rejectPaidClaimIfHttp200IsError(
    observation,
    claim.claimed || { paid: true, result: "paid_success" },
  );
  const hostileClaim = claim.claimed?.paid === true
    || claim.claimed?.result === "paid_success"
    || claim.claimed?.kind === KIND.PAID_SUCCESS;
  return {
    ok: rejected.rejected === true
      && classified.paid === false
      && classified.isError === true
      && hostileClaim,
    product: "mcp-200-iserror-w7",
    outcome: rejected.rejected ? "rejected" : "seeded_claim_not_rejected",
    id: claim.id || path.basename(claimPath),
    fixture: path.relative(path.resolve(here, "../../.."), claimPath),
    isError: classified.isError,
    paid: classified.paid,
    kind: classified.kind,
    charged: false,
    code: rejected.code,
    naiveWouldHavePaid: naive === "paid_success",
    claimed: claim.claimed || null,
    message: rejected.rejected
      ? "HTTP 200 + result.isError is not paid_success. Seeded paid claim rejected."
      : "Seeded paid claim was not rejected; W7 invariant failed.",
  };
}

async function main(argv = process.argv.slice(2)) {
  const refused = argv.find((arg) => REFUSED_FLAGS.includes(arg));
  if (refused) {
    print({
      ok: false,
      outcome: "rejected",
      error: "forbidden_flag",
      flag: refused,
      message: `${refused} is refused. This suite is unpaid loopback MCP only.`,
    });
    return 1;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help());
    return 0;
  }

  if (argv.includes("--seeded-failure") || argv[0] === "--claim") {
    const claimIndex = argv.findIndex((arg) => arg === "--claim");
    const claimPath = claimIndex >= 0 && argv[claimIndex + 1]
      ? path.resolve(argv[claimIndex + 1])
      : SEEDED_HTTP_200_ISERROR;
    const report = await runSeededFailure(claimPath);
    print(report);
    if (!report.ok) {
      process.stderr.write(`SEEDED_FAILURE not rejected id=${report.id} outcome=${report.outcome}\n`);
      return 2;
    }
    process.stderr.write(
      `SEEDED_FAILURE rejected id=${report.id} code=${report.code} naiveWouldHavePaid=${report.naiveWouldHavePaid}\n`,
    );
    return 1;
  }

  if (argv.length === 0 || argv[0] === "--cold") {
    const report = await runCold();
    print(report);
    process.stderr.write(
      `mcp-200-iserror-w7 cold: ${report.ok ? "pass" : "fail"}`
        + ` http=${report.wire?.httpStatus} isError=${report.wire?.isError}`
        + ` paid=${report.paid} kind=${report.kind} settle=${report.calls?.settle}\n`,
    );
    return report.ok ? 0 : 1;
  }

  print({
    ok: false,
    error: "usage",
    message: "expected --cold, --seeded-failure, --claim <fixture.json>, or no args",
  });
  return 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error?.stack || error?.message || error}\n`);
      process.exit(1);
    },
  );
}

export { main, runCold, runSeededFailure, REFUSED_FLAGS };
