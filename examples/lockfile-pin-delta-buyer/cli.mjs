#!/usr/bin/env node
/**
 * External buyer example for POST /lockfile-pin-delta.
 * Reads local lockfile JSON and posts objects. Never sends filesystem paths,
 * commands, or production credentials. Discover is free. Compare is unpaid
 * unless PAYMENT_SIGNATURE is supplied by the caller. MPP is not accepted.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

function usage() {
  return `lockfile-pin-delta-buyer

  node cli.mjs --base-url <origin> discover
  node cli.mjs --base-url <origin> compare --before <lock.json> --after <lock.json>

Reads local JSON files and posts lockfile objects. Does not pay unless
PAYMENT_SIGNATURE (x402) is already in the environment. MPP is not accepted.
`;
}

function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "base-url": { type: "string" },
      before: { type: "string" },
      after: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  return { values, positionals };
}

function requireBaseUrl(value) {
  const url = new URL(String(value || ""));
  if (!/^https?:$/.test(url.protocol)) throw new Error("base-url must be http(s)");
  return url.origin;
}

function readLockfileObject(path, label) {
  const text = readFileSync(path, "utf8");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
  return { status: response.status, headers: Object.fromEntries(response.headers), body };
}

async function postLockfiles(base, before, after, extraHeaders = {}) {
  const headers = { "content-type": "application/json", ...extraHeaders };
  const response = await fetch(`${base}/lockfile-pin-delta`, {
    method: "POST",
    headers,
    body: JSON.stringify({ before, after }),
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 1000); }
  return {
    status: response.status,
    paymentRequired: response.headers.get("payment-required"),
    wwwAuthenticate: response.headers.get("www-authenticate"),
    paymentReplay: response.headers.get("x-payment-replay"),
    body,
  };
}

async function discover(base) {
  const [openapi, manifest, actions, unpaid] = await Promise.all([
    getJson(`${base}/openapi.json`),
    getJson(`${base}/.well-known/x402`),
    getJson(`${base}/api/actions`),
    postLockfiles(base, { lockfileVersion: 3, packages: {} }, { lockfileVersion: 3, packages: {} }),
  ]);
  const path = openapi.body?.paths?.["/lockfile-pin-delta"];
  const action = Array.isArray(actions.body?.actions)
    ? actions.body.actions.find((entry) => entry.route === "/lockfile-pin-delta")
    : null;
  const advertised = Array.isArray(manifest.body?.items)
    && manifest.body.items.some((item) => item.resource?.routeTemplate === "/lockfile-pin-delta");
  return {
    ok: true,
    command: "discover",
    base,
    enabled: Boolean(path?.post),
    openapiOperationId: path?.post?.operationId || null,
    advertisedInWellKnown: advertised,
    actionCatalog: action ? { method: action.method, priceAtomicUsdc: action.priceAtomicUsdc } : null,
    unpaidStatus: unpaid.status,
    unpaidCharged: unpaid.body?.charged ?? null,
    challenge: unpaid.status === 402,
    note: "Free discovery only. A 402 is the live offer, not a sale. Signed deployment statement is not rewritten by this route.",
  };
}

async function compare(base, beforePath, afterPath) {
  const before = readLockfileObject(beforePath, "before");
  const after = readLockfileObject(afterPath, "after");
  const headers = {};
  if (process.env.PAYMENT_SIGNATURE) headers["payment-signature"] = process.env.PAYMENT_SIGNATURE;
  const result = await postLockfiles(base, before, after, headers);
  return {
    ok: result.status === 200 && result.body?.ok === true,
    command: "compare",
    base,
    status: result.status,
    charged: result.body?.charged ?? false,
    analysis: result.body?.analysis ?? null,
    transport: result.body?.transport ?? null,
    challenge: result.status === 402,
    replay: result.paymentReplay,
    body: result.body,
    boundary: "Local files were read by this CLI and posted as JSON objects. No path, command, or network fetch was sent to the merchant.",
  };
}

const { values, positionals } = parseCli(process.argv.slice(2));
if (values.help || positionals[0] === "help") {
  process.stdout.write(usage());
  process.exit(0);
}
const command = positionals[0];
if (!command || !values["base-url"]) {
  process.stderr.write(usage());
  process.exit(2);
}

try {
  const base = requireBaseUrl(values["base-url"]);
  let result;
  if (command === "discover") result = await discover(base);
  else if (command === "compare") {
    if (!values.before || !values.after) throw new Error("compare requires --before and --after JSON files");
    result = await compare(base, values.before, values.after);
  } else {
    throw new Error(`unknown command ${command}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok || result.challenge ? 0 : 1);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: String(error?.message || error) })}\n`);
  process.exit(1);
}
