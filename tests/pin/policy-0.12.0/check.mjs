#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  evaluateFixture,
  evaluateRepoPins,
  inspectInstalledPolicy,
  loadPins,
  readJson,
} from "./evaluate.mjs";
import { projectPinBoundary, refusalPayload } from "./project.mjs";

function print(result, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ...result, ...extra }, null, 2)}\n`);
}

function failUsage(message) {
  print({ ok: false, code: "usage", error: message });
  process.exitCode = 2;
  return false;
}

export async function run(argv = process.argv.slice(2)) {
  const pins = loadPins();

  if (argv[0] === "--help" || argv[0] === "-h") {
    print({
      ok: true,
      code: "usage",
      usage: [
        "node tests/pin/policy-0.12.0/check.mjs",
        "node tests/pin/policy-0.12.0/check.mjs <pin-fixture.json>",
        "node tests/pin/policy-0.12.0/check.mjs --project <projection-json>",
        "node tests/pin/policy-0.12.0/check.mjs --exports",
      ],
    });
    process.exitCode = 0;
    return;
  }

  if (argv[0] === "--exports") {
    const result = await inspectInstalledPolicy();
    print(result);
    process.exitCode = result.installed ? (result.ok ? 0 : 1) : 0;
    return;
  }

  if (argv[0] === "--project") {
    if (!argv[1]) {
      failUsage("missing projection fixture path");
      return;
    }
    const pinResult = evaluateRepoPins();
    const fixture = JSON.parse(readFileSync(resolve(argv[1]), "utf8"));
    try {
      projectPinBoundary(fixture, pins);
      print({
        ok: false,
        code: "pin_fixture_must_not_mint_evidence",
        accepted: false,
        evidence: null,
        pinCheck: { ok: pinResult.ok, code: pinResult.code },
      });
      process.exitCode = 1;
    } catch (error) {
      const payload = refusalPayload(error, pins, pinResult);
      print({ ok: false, code: payload.reasons[0], ...payload, fixture: argv[1] });
      process.exitCode = 1;
    }
    return;
  }

  if (argv.length === 0) {
    const result = evaluateRepoPins();
    print(result);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (argv.length !== 1 || argv[0].startsWith("-")) {
    failUsage("expected a fixture path, --project <path>, --exports, or no args");
    return;
  }

  const fixturePath = resolve(argv[0]);
  const fixture = readJson(fixturePath);
  if (fixture.kind === "projection") {
    const pinResult = evaluateRepoPins();
    try {
      projectPinBoundary(fixture, pins);
      print({
        ok: false,
        code: "pin_fixture_must_not_mint_evidence",
        accepted: false,
        evidence: null,
        fixture: argv[0],
      });
      process.exitCode = 1;
    } catch (error) {
      const payload = refusalPayload(error, pins, pinResult);
      print({ ok: false, code: payload.reasons[0], ...payload, fixture: argv[0] });
      process.exitCode = 1;
    }
    return;
  }

  const result = evaluateFixture(fixture, pins);
  print(result, { fixture: argv[0] });
  process.exitCode = result.ok ? 0 : 1;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await run();
