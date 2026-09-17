#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { FORBIDDEN_FLAGS, OUTCOMES } from "../src/constants.mjs";
import { UnpaidCallError } from "../src/errors.mjs";
import { loadFixture } from "../src/fixture.mjs";
import { runLoopbackUnpaidCall } from "../src/loopback.mjs";
import { SDK_METHOD, SDK_PACKAGE, SDK_VERSION } from "../src/pins.mjs";
import { safeJson } from "../src/redact.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = join(ROOT, "..", "fixtures", "unpaid-call-is-error.json");
const SEEDED_FAILURE = join(ROOT, "..", "fixtures", "hostile", "is-error-false.json");

function usage(exitCode = 0) {
  const text = `SameDayDesk OpenAI Agents unpaid-call example

Credential-free unpaid MCP tools/call through ${SDK_PACKAGE}@${SDK_VERSION}
${SDK_METHOD}. Default never pays, never signs, never uses --live.

Cold run (loopback mock + real OpenAI Agents SDK):
  npm start
  node bin/cli.mjs

Offline fixture replay of a recorded callToolResult:
  node bin/cli.mjs --fixture ./fixtures/unpaid-call-is-error.json

Seeded failure (isError:false is rejected):
  node bin/cli.mjs --fixture ./fixtures/hostile/is-error-false.json
  npm run fail

Notes:
  - Unpaid x402 over MCP is a JSON-RPC *result* with isError:true and PaymentRequired structuredContent.
  - callTool() returns content only and drops isError. This example uses callToolResult().
  - isError:true is not paid_success and is not authorization to attach x402/payment.
  - JSON-RPC protocol errors (including code 402) are not this outcome.
  - --live, --pay, --approve, --payment, --neo, and --publish are refused.
`;
  console.log(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { help: false, fixture: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--fixture") {
      args.fixture = argv[++i];
      if (!args.fixture) throw new UnpaidCallError("--fixture requires a path", { kind: "invalid_shape" });
    } else if (FORBIDDEN_FLAGS.includes(arg) || arg.startsWith("--live") || arg.startsWith("--pay")) {
      throw new UnpaidCallError(
        `refused flag ${arg}. This example never pays, publishes, or calls a live merchant.`,
        { kind: "forbidden_flag" },
      );
    } else {
      throw new UnpaidCallError(`unknown argument: ${arg}`, { kind: "invalid_shape" });
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage(0);
  const report = args.fixture
    ? loadFixture(args.fixture)
    : await runLoopbackUnpaidCall();
  console.log(safeJson(report));
  if (report.outcome !== OUTCOMES.UNPAID_CALL_IS_ERROR || report.isError !== true) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const payload = {
    ok: false,
    outcome: "rejected",
    isError: null,
    paid: false,
    charged: false,
    error: error instanceof UnpaidCallError ? error.kind : "rejected",
    message: error?.message || String(error),
  };
  console.log(safeJson(payload));
  process.exitCode = 1;
});

export { DEFAULT_FIXTURE, SEEDED_FAILURE };
