#!/usr/bin/env node
/**
 * Fresh-consumer CLI for R2-RECORD-JOBS-08 (recurring job bundle).
 *
 *   node src/cli.mjs bundle
 *   node src/cli.mjs run <request.json|->
 *   node src/cli.mjs validate <request.json|->
 *   node src/cli.mjs demo
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildJobManifest,
  runBundle,
  runDemoJourney,
  validateBundleRequest,
} from "./bundle.mjs";
import { BUNDLE_STATUS, SCHEMA } from "./constants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadJson(path) {
  if (path === "-" || path === "/dev/stdin") {
    return JSON.parse(readFileSync(0, "utf8"));
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function usage() {
  console.error(`Usage:
  node src/cli.mjs bundle
  node src/cli.mjs run <request.json|->
  node src/cli.mjs validate <request.json|->
  node src/cli.mjs demo`);
  process.exit(2);
}

const [cmd, a] = process.argv.slice(2);
if (!cmd) usage();

const clock = () => Date.parse("2026-09-10T19:00:00.000Z");

try {
  if (cmd === "bundle") {
    console.log(JSON.stringify(buildJobManifest({ clock }), null, 2));
  } else if (cmd === "validate") {
    if (!a) usage();
    const normalized = validateBundleRequest(loadJson(a));
    console.log(JSON.stringify({ ok: true, normalized }, null, 2));
  } else if (cmd === "run") {
    if (!a) usage();
    const pkg = await runBundle(loadJson(a), { clock });
    console.log(JSON.stringify(pkg, null, 2));
    if (pkg.status === BUNDLE_STATUS.REJECTED) process.exit(1);
  } else if (cmd === "demo") {
    const journey = await runDemoJourney({ clock });
    const manifest = journey.steps.find((s) => s.name === "manifest").result;
    const positive = journey.steps.find((s) => s.name === "positive-bundle").result;
    const partial = journey.steps.find((s) => s.name === "partial-missing-sibling").result;
    const negative = journey.steps.find((s) => s.name === "negative-forbidden").result;
    const unknown = journey.steps.find((s) => s.name === "negative-unknown-job").result;
    console.log(
      JSON.stringify(
        {
          schema: SCHEMA,
          demo: true,
          note: "Synthetic fixtures only; no live paid calls; Heavy 01..04 owned_by_heavy stubs; siblings preferred when present.",
          results: {
            "manifest.readyCount": manifest.summary.readyCount,
            "manifest.ownedByHeavyCount": manifest.summary.ownedByHeavyCount,
            "positive-bundle.json": {
              status: positive.status,
              jobStatuses: positive.jobs.map((j) => ({
                id: j.jobId,
                status: j.status,
                dependencyMode: j.dependencyMode || null,
              })),
              hasInvestmentRecommendation: positive.hasInvestmentRecommendation,
            },
            "partial-missing-sibling.json": {
              status: partial.status,
              jobStatuses: partial.jobs.map((j) => ({
                id: j.jobId,
                status: j.status,
              })),
              hasInvestmentRecommendation: partial.hasInvestmentRecommendation,
            },
            "negative-forbidden.json": {
              status: negative.status,
              error: negative.error || null,
              hasInvestmentRecommendation: negative.hasInvestmentRecommendation,
            },
            "negative-unknown-job.json": {
              status: unknown.status,
              jobStatuses: unknown.jobs.map((j) => ({
                id: j.jobId,
                status: j.status,
              })),
              hasInvestmentRecommendation: unknown.hasInvestmentRecommendation,
            },
          },
          wrote: [
            "demo-out/journey.json",
            "demo-out/manifest.json",
            "demo-out/positive.json",
            "demo-out/partial.json",
            "demo-out/negative.json",
            "demo-out/unknown.json",
          ],
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
