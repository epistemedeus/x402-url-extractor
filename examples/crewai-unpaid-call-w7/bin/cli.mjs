#!/usr/bin/env node
import { CrewaiUnpaidCallError } from "../src/errors.mjs";
import {
  CREWAI_ADAPTER,
  CREWAI_DSL,
  CREWAI_PIN,
  CREWAI_SAFE_API,
  CREWAI_UNSAFE_API,
  SDS_MCP_URL,
} from "../src/pins.mjs";
import { refuseForbiddenArgv, refuseLiveOrNeoUrl } from "../src/refuse.mjs";
import { runSeededFailure, runUnpaidCall } from "../src/run.mjs";

function usage(exitCode = 0) {
  const text = `SameDayDesk CrewAI unpaid tools/call example (W7)

Credential-free. Speaks the CrewAI MCPServerHTTP streamable-http wire
(initialize, tools/list, tools/call) against a loopback unpaid fixture.
Unpaid tools/call is JSON-RPC 200 with isError:true Payment required.
That is not paid success and not settlement.

Default (cold run, local fixture, no wallet, no kickoff):
  npm start
  node bin/cli.mjs

Seeded failure (CrewAI MCPClient.call_tool drops isError; claimed paid_success):
  npm run seeded-failure
  node bin/cli.mjs --seeded-failure

Pins:
  crewai            ${CREWAI_PIN}
  transport         streamable-http
  dsl               ${CREWAI_DSL}
  adapter           ${CREWAI_ADAPTER}
  keep isError via  ${CREWAI_SAFE_API}
  do not use        ${CREWAI_UNSAFE_API}
  do not            Agent.kickoff / Crew.kickoff

Notes:
  - This example never pays, never kickoff, never --live.
  - HTTP 200 is not paid. isError:true is the unpaid challenge.
  - call_tool() drops isError; this example rejects that false-success.
  - Live SDS MCP (${SDS_MCP_URL}) is refused here (no --live).
  - Neo /labs/crewai is refused and is not claimed as a live lab.
  - No payment headers, no --approve, no publish.
`;
  console.log(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  refuseForbiddenArgv(argv);
  const options = { seededFailure: false, mcpUrl: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    else if (arg === "--seeded-failure") options.seededFailure = true;
    else if (arg === "--json") continue;
    else if (arg === "--mcp-url") {
      const value = argv[++i];
      if (!value) {
        throw new CrewaiUnpaidCallError("--mcp-url requires a loopback HTTP URL", { code: "INVALID_ARGS" });
      }
      refuseLiveOrNeoUrl(value);
      options.mcpUrl = value;
    } else if (arg.startsWith("--mcp-url=")) {
      const value = arg.slice("--mcp-url=".length);
      refuseLiveOrNeoUrl(value);
      options.mcpUrl = value;
    } else {
      throw new CrewaiUnpaidCallError(`unknown argument: ${arg}`, {
        code: "UNKNOWN_ARG",
        kind: "refused",
        details: { arg },
      });
    }
  }
  return options;
}

function printError(error) {
  const payload = {
    ok: false,
    code: error instanceof CrewaiUnpaidCallError ? error.code : "UNEXPECTED",
    kind: error instanceof CrewaiUnpaidCallError ? error.kind : "error",
    error: error.message,
    details: error instanceof CrewaiUnpaidCallError ? error.details : null,
  };
  console.log(JSON.stringify(payload, null, 2));
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.seededFailure) {
      await runSeededFailure({ mcpUrl: options.mcpUrl });
      throw new CrewaiUnpaidCallError("seeded failure did not reject", { code: "SEED_MISSED" });
    }
    const { report } = await runUnpaidCall({ mcpUrl: options.mcpUrl });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 0;
  } catch (error) {
    printError(error);
    process.exitCode = error instanceof CrewaiUnpaidCallError && error.code === "SEED_REJECT" ? 1 : 1;
  }
}

await main();
