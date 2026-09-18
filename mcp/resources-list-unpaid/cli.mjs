#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { acceptInitialize, acceptResourcesList, ACCEPT_CODES } from "./accept.mjs";
import { BOUNDARY, SCHEMA, UNPAID_RESOURCE_URIS } from "./catalog.mjs";
import { coldRun } from "./mount.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDED = Object.freeze({
  "paid-list": join(HERE, "fixtures", "seeded-paid-list.json"),
});

function usage(exitCode = 0) {
  console.log(`x402-url-extractor unpaid MCP resources/list

Cold run (loopback MCP, no payment headers):
  node mcp/resources-list-unpaid/cli.mjs
  node mcp/resources-list-unpaid/cli.mjs --json

Accept a captured resources/list envelope:
  node mcp/resources-list-unpaid/cli.mjs accept --fixture <path> --json

Seeded failure (must exit 1):
  node mcp/resources-list-unpaid/cli.mjs --seeded-failure paid-list --json

This surface lists unpaid discovery resources only. It does not call tools,
send payment headers, or settle.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    json: false,
    command: "cold-run",
    fixture: null,
    seed: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") usage(0);
    else if (token === "--json") args.json = true;
    else if (token === "accept") args.command = "accept";
    else if (token === "--fixture") args.fixture = argv[++i];
    else if (token === "--seeded-failure") {
      args.command = "seeded-failure";
      args.seed = argv[++i];
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
}

function printEnvelope(envelope, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }
  if (envelope.ok) {
    console.log(`resources-list-unpaid ok count=${envelope.count} paymentRequired=false`);
    for (const uri of envelope.uris || []) console.log(uri);
    return;
  }
  const err = envelope.error || {};
  console.error(`${err.code || "ERROR"} ${err.message || "resources/list rejected"}`);
}

function loadFixture(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw.json && Number.isInteger(raw.httpStatus)) return raw;
  return { httpStatus: 200, headers: {}, paymentSent: false, json: raw };
}

function envelopeFromDecision(decision, extra = {}) {
  return {
    schema: SCHEMA,
    ok: decision.ok === true,
    boundary: BOUNDARY,
    paymentRequired: decision.paymentRequired === true,
    paymentSent: false,
    ...extra,
    ...(decision.ok ? {
      count: decision.count,
      uris: decision.uris,
      names: decision.names,
      resources: decision.resources,
    } : { error: decision.error }),
  };
}

async function runCold(jsonMode) {
  const probe = await coldRun();
  const init = acceptInitialize({ json: probe.initialized.json });
  if (!init.ok) {
    printEnvelope(envelopeFromDecision(init, { command: "cold-run" }), jsonMode);
    process.exit(1);
  }
  const listed = acceptResourcesList({
    httpStatus: probe.listed.status,
    headers: probe.listed.headers,
    json: probe.listed.json,
    paymentSent: probe.listed.paymentSent,
  });
  const envelope = envelopeFromDecision(listed, {
    command: "cold-run",
    origin: probe.origin,
    httpStatus: probe.listed.status,
    initialize: {
      protocolVersion: init.protocolVersion,
      serverInfo: init.serverInfo,
      resourcesCapability: init.capabilities,
    },
    catalog: [...UNPAID_RESOURCE_URIS],
  });
  printEnvelope(envelope, jsonMode);
  process.exit(listed.ok ? 0 : 1);
}

function runAccept(fixturePath, jsonMode, extra = {}) {
  const capture = loadFixture(resolve(fixturePath));
  const listed = acceptResourcesList({
    httpStatus: capture.httpStatus,
    headers: capture.headers || {},
    json: capture.json,
    paymentSent: capture.paymentSent === true,
  });
  const envelope = envelopeFromDecision(listed, {
    command: extra.command || "accept",
    seed: extra.seed || null,
    fixture: fixturePath,
    httpStatus: capture.httpStatus,
  });
  printEnvelope(envelope, jsonMode);
  process.exit(listed.ok ? 0 : 1);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage(2);
  }
  if (args.command === "cold-run") {
    await runCold(args.json);
    return;
  }
  if (args.command === "seeded-failure") {
    const fixture = SEEDED[args.seed];
    if (!fixture) {
      printEnvelope({
        schema: SCHEMA,
        ok: false,
        command: "seeded-failure",
        paymentRequired: false,
        paymentSent: false,
        boundary: BOUNDARY,
        error: {
          code: "SEED_UNKNOWN",
          message: `unknown seeded failure: ${args.seed}`,
          known: Object.keys(SEEDED),
        },
      }, args.json);
      process.exit(2);
    }
    runAccept(fixture, args.json, { command: "seeded-failure", seed: args.seed });
    return;
  }
  if (args.command === "accept") {
    if (!args.fixture) {
      console.error("accept requires --fixture");
      usage(2);
    }
    runAccept(args.fixture, args.json);
    return;
  }
  usage(2);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});

export { ACCEPT_CODES, SEEDED };
