#!/usr/bin/env node
/**
 * Fresh-consumer CLI for S155 source-record job kit.
 *
 *   node src/cli.mjs manifest
 *   node src/cli.mjs validate <request.json|->
 *   node src/cli.mjs run <request.json|->
 *   node src/cli.mjs journey
 *   node src/cli.mjs demo
 */

import { readFileSync } from "node:fs";
import {
  buildKitManifest,
  runKitJourney,
  runKitRequest,
  validateKitRequest,
} from "./kit.mjs";
import { JOURNEY_SCHEMA, KIT_STATUS, SCHEMA } from "./constants.mjs";

function loadJson(path) {
  if (path === "-" || path === "/dev/stdin") {
    return JSON.parse(readFileSync(0, "utf8"));
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function usage() {
  console.error(`Usage:
  node src/cli.mjs manifest
  node src/cli.mjs validate <request.json|->
  node src/cli.mjs run <request.json|->
  node src/cli.mjs journey
  node src/cli.mjs demo`);
  process.exit(2);
}

const [cmd, a] = process.argv.slice(2);
if (!cmd) usage();

const clock = () => Date.parse("2026-09-10T20:00:00.000Z");

try {
  if (cmd === "manifest") {
    console.log(JSON.stringify(buildKitManifest({ clock }), null, 2));
  } else if (cmd === "validate") {
    if (!a) usage();
    const normalized = validateKitRequest(loadJson(a));
    console.log(JSON.stringify({ ok: true, normalized }, null, 2));
  } else if (cmd === "run") {
    if (!a) usage();
    const pkg = await runKitRequest(loadJson(a), { clock });
    console.log(JSON.stringify(pkg, null, 2));
    if (pkg.status === KIT_STATUS.REJECTED) process.exit(1);
  } else if (cmd === "journey" || cmd === "demo") {
    const journey = await runKitJourney({ clock });
    const clean = journey.steps.find((s) => s.name === "clean-install")?.result;
    const example = journey.steps.find((s) => s.name === "example")?.result;
    const partial = journey.steps.find((s) => s.name === "partial-missing-native")?.result;
    const refusal = journey.steps.find((s) => s.name === "refusal-forbidden")?.result;
    const csvProbe = journey.steps.find((s) => s.name === "csv-s154-probe")?.result;
    const manifest = journey.steps.find((s) => s.name === "manifest")?.result;
    console.log(
      JSON.stringify(
        {
          schema: cmd === "journey" ? JOURNEY_SCHEMA : SCHEMA,
          [cmd === "journey" ? "journey" : "demo"]: true,
          heavyPin: journey.heavyPin,
          wrote: [
            "demo-out/journey.json",
            "demo-out/manifest.json",
            "demo-out/clean-install.json",
            "demo-out/example.json",
            "demo-out/native-extras.json",
            "demo-out/partial.json",
            "demo-out/partial-missing-fixture.json",
            "demo-out/refusal-forbidden.json",
            "demo-out/refusal-unknown.json",
            "demo-out/refusal-malformed.json",
            "demo-out/csv-s154-probe.json",
          ],
          summary: {
            cleanInstallOk: clean?.ok ?? null,
            exampleStatus: example?.status ?? null,
            exampleJobStatuses: example?.jobs?.map((j) => ({
              id: j.jobId,
              status: j.status,
            })),
            partialStatus: partial?.status ?? null,
            refusalStatus: refusal?.status ?? null,
            csvProbeAllPass: csvProbe?.allPass ?? null,
            manifestReadyCount: manifest?.summary?.readyCount ?? null,
            hasInvestmentRecommendation: false,
          },
          note: journey.note,
        },
        null,
        2,
      ),
    );
  } else {
    usage();
  }
} catch (err) {
  console.error(
    JSON.stringify({
      error: err.code || "error",
      message: err.message,
      details: err.details || null,
    }),
  );
  process.exit(1);
}
