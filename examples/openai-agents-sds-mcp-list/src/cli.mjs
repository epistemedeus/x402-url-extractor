import { LIVE_MCP_URL, SDK_PACKAGE, SDK_VERSION, TRANSPORT_CLASS } from "./constants.mjs";
import { isRefusal, PolicyRefusal } from "./errors.mjs";
import { listUnpaidSdsTools } from "./list-tools.mjs";
import { assertMcpListUrl, refusedCliFlag } from "./policy.mjs";

export function usage() {
  return `SameDayDesk unpaid MCP tools/list via OpenAI Agents ${TRANSPORT_CLASS}

Credential-free discovery only. Never runs an agent, never calls tools, never
sends payment or credential headers.

Default (live SameDayDesk Streamable HTTP):
  npm start
  npm run list
  node bin/cli.mjs

Pins:
  ${SDK_PACKAGE} ${SDK_VERSION}
  transport ${TRANSPORT_CLASS}
  url       ${LIVE_MCP_URL}

Require extract and extract_batch with their input schemas. Extra unrelated
tools are accepted. Do not call them.

Optional spoofable source header (not the default, not identity):
  node bin/cli.mjs --declare-source

Refused:
  --call, --approve, --pay, --purchase, --wallet, --header
`;
}

export function parseArgs(argv) {
  const args = {
    help: false,
    url: LIVE_MCP_URL,
    declareSource: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const refused = refusedCliFlag(arg);
    if (refused) {
      throw new PolicyRefusal(
        `${refused} is refused; this example only lists tools unpaid`,
        { field: refused },
      );
    }
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--url") {
      const value = argv[++i];
      if (value == null) throw new PolicyRefusal("--url requires a value", { field: "url" });
      args.url = value;
    } else if (arg === "--declare-source") args.declareSource = true;
    else throw new PolicyRefusal(`unknown argument: ${arg}`, { field: arg });
  }
  if (!args.help) args.url = assertMcpListUrl(args.url);
  return args;
}

export function refusalPayload(error) {
  return {
    ok: false,
    outcome: "refused",
    code: error.code || "policy_refused",
    message: error.message,
    field: error.field ?? null,
    paymentAttempted: false,
    toolsCalled: false,
    agentRun: false,
  };
}

export async function runCli(argv, { listTools = listUnpaidSdsTools } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    return { ok: true, help: true, text: usage() };
  }
  const result = await listTools({
    url: args.url,
    declareSource: args.declareSource,
  });
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const result = await runCli(argv);
    if (result.help) {
      process.stdout.write(result.text);
      process.exitCode = 0;
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 2;
  } catch (error) {
    if (isRefusal(error)) {
      process.stdout.write(`${JSON.stringify(refusalPayload(error), null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`${JSON.stringify({
      ok: false,
      outcome: "error",
      message: error instanceof Error ? error.message : String(error),
      paymentAttempted: false,
      toolsCalled: false,
      agentRun: false,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
