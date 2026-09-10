#!/usr/bin/env node
import { runHandoff, DEFAULT_FEED, DEFAULT_DIST08 } from "./handoff.mjs";

const [cmd, feedArg] = process.argv.slice(2);
if (cmd !== "handoff" && cmd !== "demo") {
  console.error("Usage: node src/cli.mjs handoff [feed.json]");
  process.exit(2);
}
try {
  const result = await runHandoff({
    feedPath: feedArg || DEFAULT_FEED,
    dist08Root: process.env.DIST08_ROOT || DEFAULT_DIST08,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ready") process.exit(1);
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}
