import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { LIVE_ORIGIN, TOOL_NAME } from "./constants.mjs";
import { UnpaidListError } from "./errors.mjs";
import { listUnpaidResources } from "./list.mjs";
import { DEFAULT_CATALOG_PATH } from "./paths.mjs";
import { langchainToolSpec } from "./tool.mjs";

const PAYMENT_FLAGS = [
  "--approve",
  "--pay",
  "--wallet",
  "--checkout",
  "--private-key-env",
  "--payment-signature",
  "--private-key",
];

export function usage() {
  return `SameDayDesk LangChain unpaid x402 list

Credential-free catalog list. Never reads wallet credentials, signs, sends
payment headers, or fetches paid bodies. Default reads the local fixture.

  npm start
  npm run list
  node bin/cli.mjs
  node bin/cli.mjs --catalog ./fixtures/well-known-x402.json
  node bin/cli.mjs --catalog ./fixtures/well-known-x402.json --query extract
  node bin/cli.mjs --catalog ./fixtures/well-known-x402.json --route /extract

Optional live well-known fetch (still unpaid; HTTP 200 only):
  node bin/cli.mjs --origin ${LIVE_ORIGIN}
  node bin/cli.mjs --url ${LIVE_ORIGIN}/.well-known/x402

LangChain tool spec (no model call):
  node bin/cli.mjs --tool-spec

Seeded failure (must exit non-zero):
  node bin/cli.mjs --catalog ./fixtures/hostile/malformed.json
  node bin/cli.mjs --catalog ./fixtures/hostile/private-url.json

Notes:
  - Default commands never pay and never touch a wallet.
  - Listed amounts are catalog advertisements, not live 402 challenges.
  - Paid routes are not fetched. Discovery is GET ${LIVE_ORIGIN}/.well-known/x402.
  - This is not a LangChain payer, checkout, or @x402/fetch client.
  - Wrap ${TOOL_NAME} with LangChain using src/tool.mjs; payment stays out.
`;
}

export function parseCli(argv) {
  for (const flag of PAYMENT_FLAGS) {
    if (argv.includes(flag)) {
      throw new UnpaidListError("unpaid list refuses payment, wallet, or checkout flags", {
        code: "payment_intent_refused",
        field: flag,
      });
    }
  }

  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      catalog: { type: "string" },
      origin: { type: "string" },
      url: { type: "string" },
      query: { type: "string" },
      route: { type: "string" },
      "tool-spec": { type: "boolean" },
    },
  });
  return values;
}

export async function runCli(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, fetchImpl } = {}) {
  try {
    const values = parseCli(argv);
    if (values.help) {
      stdout.write(usage());
      return 0;
    }
    if (values["tool-spec"]) {
      stdout.write(`${JSON.stringify(langchainToolSpec(), null, 2)}\n`);
      return 0;
    }
    const report = await listUnpaidResources({
      catalogPath: values.catalog ? resolve(values.catalog) : (values.origin || values.url ? null : DEFAULT_CATALOG_PATH),
      origin: values.origin,
      url: values.url,
      query: values.query,
      route: values.route,
      fetchImpl,
    });
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (error) {
    const payload = {
      ok: false,
      error: error instanceof UnpaidListError ? error.code : "unpaid_list_error",
      message: error.message,
      field: error.field ?? null,
    };
    if (error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      payload.error = "unknown_argument";
    }
    stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 1;
  }
}
