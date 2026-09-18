#!/usr/bin/env node
import { FORBIDDEN_FLAGS, OUTCOMES, REJECTION_KINDS } from "../src/constants.mjs";
import { UnpaidCallError } from "../src/errors.mjs";
import { loadFixture } from "../src/fixture.mjs";
import { runLoopbackUnpaidCall } from "../src/loopback.mjs";
import { SDK_METHOD, SDK_PACKAGE, SDK_VERSION } from "../src/pins.mjs";
import { assertNoSecretMaterial, safeJson } from "../src/redact.mjs";

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
      const value = argv[++i];
      if (!value) {
        throw new UnpaidCallError("--fixture requires a path", { kind: REJECTION_KINDS.INVALID_SHAPE });
      }
      if (FORBIDDEN_FLAGS.includes(value) || value.startsWith("--live") || value.startsWith("--pay") || value.startsWith("-")) {
        throw new UnpaidCallError(
          `refused flag ${value}. This example never pays, publishes, or calls a live merchant.`,
          { kind: REJECTION_KINDS.FORBIDDEN_FLAG },
        );
      }
      args.fixture = value;
    } else if (FORBIDDEN_FLAGS.includes(arg) || arg.startsWith("--live") || arg.startsWith("--pay")) {
      throw new UnpaidCallError(
        `refused flag ${arg}. This example never pays, publishes, or calls a live merchant.`,
        { kind: REJECTION_KINDS.FORBIDDEN_FLAG },
      );
    } else {
      throw new UnpaidCallError(`unknown argument: ${arg}`, { kind: REJECTION_KINDS.INVALID_SHAPE });
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
  const text = safeJson(report);
  assertNoSecretMaterial(text);
  console.log(text);
  if (report.outcome !== OUTCOMES.UNPAID_CALL_IS_ERROR || report.isError !== true) {
    process.exit(1);
  }
  process.exit(0);
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
  process.exit(1);
});
