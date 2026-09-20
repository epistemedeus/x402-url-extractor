#!/usr/bin/env node
import { CODES, REFUSED_FLAGS } from "./constants.mjs";
import { evaluateAmountMatrix } from "./evaluate.mjs";
import { loadBoundedFixture, SEEDED_EXTRACT_ONTO_SCAN } from "./paths.mjs";
import { runColdSuite, runFixtureCorpus, runSeededFailure } from "./run.mjs";

const KNOWN_FLAGS = new Set([
  "--cold",
  "--seeded-failure",
  "--all-fixtures",
  "--help",
  "-h",
  "--origin",
]);

function help() {
  return `w1010: unpaid x402 amount matrix (HTTP 402 / MCP tools/list / OpenAPI).

Usage:
  node tests/protocol/w1010-amount-matrix/check.mjs
  node tests/protocol/w1010-amount-matrix/check.mjs --cold
  node tests/protocol/w1010-amount-matrix/check.mjs --seeded-failure
  node tests/protocol/w1010-amount-matrix/check.mjs --all-fixtures
  node tests/protocol/w1010-amount-matrix/check.mjs <fixture.json>

Cold run mounts local server.js on loopback with a fake facilitator that
refuses verify/settle. Unpaid GET/MCP/OpenAPI only. Never pays.
Refused: --live --pay --stripe --checkout --settle --cdp --publish --neo --payment-signature.
`;
}

function print(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function failUsage(message) {
  print({ ok: false, code: "usage", error: message, usage: help().trim().split("\n").slice(2) });
  process.exit(2);
}

function refusedFlag(argv) {
  for (const arg of argv) {
    const name = String(arg).split("=")[0];
    if (REFUSED_FLAGS.includes(name)) return arg;
  }
  return null;
}

function originFromArgv(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === "--origin") {
      const value = argv[i + 1];
      if (!value || String(value).startsWith("--")) return { error: "missing" };
      return { value };
    }
    if (arg.startsWith("--origin=")) {
      const value = arg.slice("--origin=".length);
      if (!value) return { error: "missing" };
      return { value };
    }
  }
  return { value: null };
}

function unknownFlag(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === "--origin") {
      i += 1;
      continue;
    }
    if (!arg.startsWith("-")) continue;
    const name = arg.split("=")[0];
    if (KNOWN_FLAGS.has(name) || name === "-h") continue;
    if (REFUSED_FLAGS.includes(name)) continue;
    return arg;
  }
  return null;
}

async function main(argv = process.argv.slice(2)) {
  const refused = refusedFlag(argv);
  if (refused) {
    print({
      ok: false,
      code: "refused",
      error: `${refused} is refused. This suite is unpaid loopback amount-matrix only.`,
      paymentAttempted: false,
    });
    process.stderr.write(`${refused} is refused\n`);
    return 2;
  }

  const unknown = unknownFlag(argv);
  if (unknown) {
    print({
      ok: false,
      code: "unknown_flag",
      error: `unknown flag ${unknown}`,
      paymentAttempted: false,
    });
    process.stderr.write(`unknown flag ${unknown}\n`);
    return 2;
  }

  if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
    process.stdout.write(help());
    return 0;
  }

  if (argv[0] === "--all-fixtures") {
    const report = runFixtureCorpus();
    print(report);
    process.stderr.write(
      `w1010-amount-matrix fixtures: ${report.ok ? "pass" : "fail"} counted=${report.counted} passed=${report.passed}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (argv[0] === "--seeded-failure") {
    const report = runSeededFailure(SEEDED_EXTRACT_ONTO_SCAN);
    print({
      ...report,
      fixture: "tests/protocol/w1010-amount-matrix/fixtures/reject/seeded-extract-onto-scan.json",
    });
    if (report.ok) {
      process.stderr.write("SEEDED_FAILURE must not pass a copy of extract 5000 onto /scan\n");
      return 2;
    }
    process.stderr.write(
      `SEEDED_FAILURE rejected id=${report.id} codes=${report.codes.join(",")}\n`,
    );
    return 1;
  }

  if (argv.length === 0 || argv[0] === "--cold" || argv.includes("--cold")) {
    const parsedOrigin = originFromArgv(argv);
    if (parsedOrigin.error) {
      print({ ok: false, code: "refused", error: "--origin requires a loopback URL", paymentAttempted: false });
      process.stderr.write("--origin requires a loopback URL\n");
      return 2;
    }
    const report = await runColdSuite({ origin: parsedOrigin.value });
    print(report);
    if (report.codes?.includes("refused") && report.error) {
      process.stderr.write(`${report.error}\n`);
      return 2;
    }
    process.stderr.write(
      `w1010-amount-matrix cold: ${report.ok ? "pass" : "fail"} codes=${report.codes.join(",")}`
        + ` paymentSent=${report.paymentAttempted}`
        + ` settle=${report.coldRun?.facilitatorSettleCalled}`
        + ` verify=${report.coldRun?.facilitatorVerifyCalled}\n`,
    );
    return report.ok ? 0 : 1;
  }

  const originValue = originFromArgv(argv).value;
  const positional = argv.filter((arg) => !String(arg).startsWith("--") && arg !== originValue);
  if (positional.length !== 1) {
    failUsage("expected --cold, --seeded-failure, --all-fixtures, a fixture path, or no args");
  }

  let loaded;
  try {
    loaded = loadBoundedFixture(positional[0]);
  } catch (error) {
    const code = error?.code === "FIXTURE_ESCAPE"
      ? "fixture_escape"
      : error?.code === "FIXTURE_NOT_FOUND"
        ? "fixture_not_found"
        : "malformed_fixture";
    print({
      ok: false,
      code,
      error: error?.message || "invalid fixture",
      paymentAttempted: false,
    });
    process.stderr.write(`${code}: ${error?.message || error}\n`);
    return 2;
  }
  const fixture = loaded.document;
  const report = evaluateAmountMatrix(fixture);
  print({ ...report, fixture: positional[0] });
  if (fixture.expect === "reject") {
    if (report.ok) {
      process.stderr.write("reject fixture must not pass w1010-amount-matrix\n");
      return 2;
    }
    process.stderr.write(`rejected fixture id=${report.id || fixture.id} codes=${report.codes.join(",")}\n`);
    return 1;
  }
  if (!report.ok && report.codes.includes(CODES.COPY_EXTRACT_ONTO_SCAN)) {
    process.stderr.write("copy of extract 5000 onto /scan\n");
  }
  return report.ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error) => {
    process.stderr.write(`${error?.stack || error?.message || error}\n`);
    process.exit(1);
  },
);
