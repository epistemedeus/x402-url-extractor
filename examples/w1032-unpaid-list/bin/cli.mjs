#!/usr/bin/env node
import { unpaidBoundary } from "../src/boundary.mjs";
import { W1032UnpaidListError } from "../src/errors.mjs";
import { unpaidToolsList } from "../src/list.mjs";
import { parseCli, usage } from "../src/parse-args.mjs";
import { DESIGNATED_SEED_PATH } from "../src/paths.mjs";
import { emit, envelope } from "../src/report.mjs";
import { evaluateRecorded, loadSeed, runSeededFailure } from "../src/seeded.mjs";

function errorReport(command, error) {
  const code = error instanceof W1032UnpaidListError ? error.code : "FAIL";
  return envelope({
    ok: false,
    command,
    error: {
      code,
      kind: error.kind || null,
      message: error.message,
    },
    result: null,
    boundary: unpaidBoundary(),
  });
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCli(argv);
  } catch (error) {
    const report = errorReport("usage", error);
    emit(report, false);
    return 2;
  }
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }

  const json = options.json;
  try {
    if (options.seededFailure) {
      const report = envelope(runSeededFailure(DESIGNATED_SEED_PATH));
      emit(report, json);
      return report.result?.status === "missed" ? 2 : 1;
    }
    if (options.fixture) {
      const seed = loadSeed(options.fixture);
      const observed = evaluateRecorded(seed);
      const report = envelope({
        ok: observed.ok,
        command: "fixture",
        seed: { id: seed.id, kind: seed.kind, title: seed.title },
        observed,
        error: observed.ok
          ? null
          : {
              code: observed.code,
              kind: observed.kind,
              message: observed.message,
            },
      });
      emit(report, json);
      return observed.ok ? 0 : 1;
    }
    const listed = await unpaidToolsList({ url: options.url || undefined });
    emit(envelope(listed), json);
    return 0;
  } catch (error) {
    const command = options.fixture ? "fixture" : "list";
    const report = errorReport(command, error);
    emit(report, json);
    return error instanceof W1032UnpaidListError && error.code === "USAGE" ? 2 : 1;
  }
}

const code = await main();
process.exit(code);
