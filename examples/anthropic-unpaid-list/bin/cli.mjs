#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { refuseForbiddenArgv } from "../src/admit.mjs";
import { LIVE_ORIGIN, PRODUCT } from "../src/constants.mjs";
import { ListError } from "../src/errors.mjs";
import { createRecordedFetch, loadRecordedDiscovery } from "../src/fixtures.mjs";
import { listUnpaid } from "../src/list.mjs";
import { safeJson } from "../src/redact.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function usage(exitCode = 0) {
  const text = `SameDayDesk Anthropic unpaid-list example

Credential-free unpaid discovery list for Claude Code / Anthropic extract
surfaces. Never reads wallet credentials, signs, sends payment headers, pays,
checks out, publishes, or touches neo.

Default (live unpaid discovery of the canonical merchant):
  npm start
  npm run list
  node bin/cli.mjs

Recorded fixtures (no network):
  npm run list:fixture
  node bin/cli.mjs --fixture ./fixtures/recorded

Copyable CLI:
  node bin/cli.mjs --origin https://agents.samedaydesk.com
  node bin/cli.mjs --origin https://agents.samedaydesk.com --no-probe
  node bin/cli.mjs --fixture ./fixtures/recorded

Seeded failures (must exit 2):
  node bin/cli.mjs --approve
  node bin/cli.mjs --checkout
  node bin/cli.mjs --publish
  node bin/cli.mjs --neo
  node bin/cli.mjs --origin http://127.0.0.1
  node bin/cli.mjs --origin mcp://agents.samedaydesk.com/mcp

Notes:
  - Default commands never pay. A 402 is the live offer, not a sale.
  - MCP initialize + tools/list only. tools/call is refused.
  - Local marketplace catalog is not an Anthropic official directory listing.
  - Listing and install grant no payment authority.
  - This example has no npm dependencies and no wallet.
`;
  console.log(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  refuseForbiddenArgv(argv);
  const args = {
    help: false,
    origin: LIVE_ORIGIN,
    fixture: null,
    includeProbes: true,
    probeUrl: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--origin") args.origin = argv[++i];
    else if (arg === "--fixture") args.fixture = argv[++i];
    else if (arg === "--no-probe") args.includeProbes = false;
    else if (arg === "--probe-url") args.probeUrl = argv[++i];
    else {
      throw new ListError(`unknown argument: ${arg}`, { code: "unknown_argument", field: arg });
    }
  }
  if (args.origin == null) throw new ListError("missing --origin value", { code: "invalid_origin", field: "origin" });
  if (argv.includes("--fixture") && !args.fixture) {
    throw new ListError("missing --fixture value", { code: "invalid_fixture", field: "fixture" });
  }
  if (argv.includes("--probe-url") && !args.probeUrl) {
    throw new ListError("missing --probe-url value", { code: "invalid_url", field: "probeUrl" });
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) usage(0);
  let fetchImpl = globalThis.fetch;
  if (args.fixture) {
    const recorded = loadRecordedDiscovery(resolve(process.cwd(), args.fixture));
    fetchImpl = createRecordedFetch(recorded);
  }
  const report = await listUnpaid({
    origin: args.origin,
    fetchImpl,
    includeProbes: args.includeProbes,
    probeUrl: args.probeUrl || undefined,
    repoRoot: REPO_ROOT,
  });
  process.stdout.write(`${safeJson(report)}\n`);
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  const code = error instanceof ListError ? error.exitCode : 1;
  const payload = {
    ok: false,
    product: PRODUCT,
    paymentAttempted: false,
    walletAccessed: false,
    checkoutAttempted: false,
    published: false,
    neoTouched: false,
    error: {
      name: error.name,
      code: error.code || "error",
      message: error.message,
      field: error.field || null,
    },
  };
  process.stderr.write(`${safeJson(payload)}\n`);
  process.exit(code);
});
