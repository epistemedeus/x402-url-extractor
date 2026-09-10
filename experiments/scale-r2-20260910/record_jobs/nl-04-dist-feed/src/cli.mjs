#!/usr/bin/env node
/**
 * NL-RECORD-04 CLI — distribution repair feed
 *
 *   node src/cli.mjs feed <input.json|->
 *   node src/cli.mjs validate <feed.json|->
 *   node src/cli.mjs demo
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDistRepairFeed } from "./feed.mjs";
import { FEED_SCHEMA, FEED_STATUS, PINS } from "./constants.mjs";
import { validateDistRepairFeed } from "./validate.mjs";

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
  node src/cli.mjs feed <input.json|->
  node src/cli.mjs validate <feed.json|->
  node src/cli.mjs demo`);
  process.exit(2);
}

const [cmd, a] = process.argv.slice(2);
if (!cmd) usage();

const FIXED = () => Date.parse("2026-09-10T12:00:00.000Z");

try {
  if (cmd === "feed") {
    if (!a) usage();
    const feed = buildDistRepairFeed(loadJson(a));
    console.log(JSON.stringify(feed, null, 2));
    if (feed.status === FEED_STATUS.REJECTED) process.exit(1);
  } else if (cmd === "validate") {
    if (!a) usage();
    const feed = validateDistRepairFeed(loadJson(a));
    console.log(JSON.stringify({ ok: true, schema: feed.schema, status: feed.status }, null, 2));
  } else if (cmd === "demo") {
    const fixtures = [
      "positive.json",
      "partial-incomplete-current.json",
      "negative-forbidden.json",
    ];
    const results = {};
    let exportPath = null;
    for (const name of fixtures) {
      const raw = loadJson(join(root, "fixtures", name));
      const feed = buildDistRepairFeed(raw, { clock: FIXED });
      results[name] = {
        status: feed.status,
        recommendationCount: feed.repairRecommendations?.length ?? 0,
        byRecommendation: feed.recommendationSummary?.byRecommendation ?? null,
        currentCaptureIncomplete: feed.currentCaptureIncomplete ?? null,
        coveragePreservedCount: feed.recommendationSummary?.coveragePreservedCount ?? 0,
        error: feed.error ?? null,
        usableBy: feed.usableBy,
        hasSeoRank: Object.prototype.hasOwnProperty.call(feed, "seoRank"),
        hasTrafficProjection: Object.prototype.hasOwnProperty.call(feed, "trafficProjection"),
        hasRankingScore: Object.prototype.hasOwnProperty.call(feed, "rankingScore"),
        hasRevenue: Object.prototype.hasOwnProperty.call(feed, "revenue"),
      };
      if (name === "positive.json" && feed.status !== FEED_STATUS.REJECTED) {
        const outDir = join(root, "artifacts");
        mkdirSync(outDir, { recursive: true });
        exportPath = join(outDir, "dist-repair-feed.positive.json");
        writeFileSync(exportPath, JSON.stringify(feed, null, 2));
      }
    }
    console.log(
      JSON.stringify(
        {
          schema: FEED_SCHEMA,
          demo: true,
          note: "Synthetic fixtures only; no live crawl; coverage-preserving removals.",
          pins: PINS,
          exportArtifact: exportPath,
          results,
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
