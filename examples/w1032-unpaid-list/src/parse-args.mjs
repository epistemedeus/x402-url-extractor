import { parseArgs } from "node:util";

import { fail } from "./errors.mjs";
import { assertNoForbiddenFlags } from "./boundary.mjs";

export function usage() {
  return `samedaydesk-w1032-unpaid-list

Unpaid MCP tools/list against SameDayDesk. Initialize plus tools/list only.
Does not call tools, pay, publish, or use neo.

  node bin/cli.mjs [--json]
  node bin/cli.mjs --seeded-failure [--json]
  node bin/cli.mjs --fixture <seed.json> [--json]
  node bin/cli.mjs --url <mcp-url> [--json]

Default URL is https://agents.samedaydesk.com/mcp (streamable-http).
Loopback http://127.0.0.1/mcp is allowed only for tests.
Refused: --call, --pay, --approve, --publish, --neo.
`;
}

export function parseCli(argv) {
  assertNoForbiddenFlags(argv);
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        "seeded-failure": { type: "boolean", default: false },
        fixture: { type: "string" },
        url: { type: "string" },
      },
    });
  } catch (error) {
    fail("USAGE", error.message, { kind: "usage" });
  }
  const values = parsed.values;
  if (values["seeded-failure"] && values.fixture) {
    fail("USAGE", "--seeded-failure already selects the designated seed");
  }
  if (values["seeded-failure"] && values.url) {
    fail("USAGE", "--seeded-failure is offline and does not take --url");
  }
  return {
    json: values.json,
    help: values.help,
    seededFailure: values["seeded-failure"],
    fixture: values.fixture || null,
    url: values.url || null,
  };
}
