#!/usr/bin/env node
// TEST-ONLY stand-in for the official runner CLI, used to exercise the
// adapter's spawn, timeout, and parse paths without installing the runner.
// It accepts the same argv shape: server --url U --requirements R --output-dir D --timeout T
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
const mode = process.env.FAKE_RUNNER_MODE || "fixture";
const revision = flag("--requirements");
const outDir = flag("--output-dir");

if (argv[0] !== "server" || !flag("--url") || !revision || !outDir) {
  console.error("fake-runner: unexpected argv", argv.join(" "));
  process.exit(64);
}
if (mode === "crash") {
  console.error("fake-runner: simulated crash");
  process.exit(3);
}
if (mode === "hang") {
  setInterval(() => {}, 1000);
} else {
  const fixture = JSON.parse(readFileSync(process.env.FAKE_RUNNER_FIXTURE, "utf8"));
  const leg = fixture.legs.find((item) => item.revision === revision);
  for (const item of leg?.scenarios || []) {
    const dir = join(outDir, `server-${item.scenario}-2026-11-12T12-00-00-000Z`);
    mkdirSync(dir, { recursive: true });
    const body = mode === "garbled" ? "{not json" : JSON.stringify(item.checks, null, 2);
    writeFileSync(join(dir, "checks.json"), body);
  }
  console.log(`fake-runner: wrote ${leg?.scenarios?.length ?? 0} scenarios for ${revision}`);
  process.exit(leg?.exitCode ?? 0);
}
