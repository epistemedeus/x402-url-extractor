#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const node = process.execPath;
const tests = readdirSync(here)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join(here, name));

function run(label, args, { expectStatus = 0 } = {}) {
  const result = spawnSync(node, args, {
    cwd: path.resolve(here, "../../.."),
    encoding: "utf8",
    stdio: "inherit",
    env: { ...process.env },
  });
  const status = result.status ?? 1;
  if (status !== expectStatus) {
    console.error(`${label} failed with exit ${result.status ?? "null"} (expected ${expectStatus})`);
    process.exit(status === 0 ? 1 : status);
  }
  return status;
}

if (tests.length === 0) {
  console.error("no *.test.mjs files");
  process.exit(1);
}

const check = path.join(here, "check.mjs");
const coldStatus = run("cold-check", [check, "--cold"]);
const testStatus = run("cold-test", ["--test", ...tests]);
const seededCliStatus = run("seeded-failure-cli", [check, "--seeded-failure"], { expectStatus: 1 });
const seededStatus = run("seeded-failure", [path.join(here, "reject-seeded.mjs")]);
const negativeStatus = run("not-this-failure", [
  path.join(here, "reject-seeded.mjs"),
  "--claim",
  path.join(here, "fixtures/not-this-failure-paid-success.json"),
], { expectStatus: 1 });
const liveStatus = run("refused-live", [check, "--live"], { expectStatus: 1 });
console.log(JSON.stringify({
  ok: true,
  coldCheckExit: coldStatus,
  coldTestExit: testStatus,
  seededFailureCliExit: seededCliStatus,
  seededFailureExit: seededStatus,
  notThisFailureExit: negativeStatus,
  refusedLiveExit: liveStatus,
}));
