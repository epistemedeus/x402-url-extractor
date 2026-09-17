import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  PIN_DIR,
  PINS_PATH,
  REPO_ROOT,
  evaluateRepoPins,
  loadPins,
  pythonX402Present,
  readJson,
} from "./evaluate.mjs";

const pins = loadPins();

test("pin versions are recorded for every root @x402 SDK", () => {
  assert.equal(pins.schema, "samedaydesk.x402-sdk-pin.v1");
  assert.equal(pins.x402, "2.16.0");
  assert.deepEqual(Object.keys(pins.packages), [
    "@x402/core",
    "@x402/evm",
    "@x402/express",
    "@x402/extensions",
    "@x402/mcp",
    "@x402/fetch",
  ]);
  for (const [name, pin] of Object.entries(pins.packages)) {
    assert.equal(pin.version, pins.x402, name);
    const short = name.slice("@x402/".length);
    assert.equal(pin.resolved, `https://registry.npmjs.org/@x402/${short}/-/${short}-${pins.x402}.tgz`);
    assert.match(pin.integrity, /^sha512-/);
  }
  assert.equal(existsSync(PINS_PATH), true);
  assert.equal(existsSync(join(PIN_DIR, "fixtures", "seeded-drift.json")), true);
});

test("repo package.json and lockfile match the recorded x402 pins", () => {
  const result = evaluateRepoPins();
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
  assert.equal(result.code, "pins-match");
  assert.equal(result.x402, "2.16.0");
});

test("also-declared companion SDKs stay exact and extra chains stay out", () => {
  const pkg = readJson(join(REPO_ROOT, "package.json"));
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [name, version] of Object.entries(pins.alsoDeclared)) {
    assert.equal(declared[name], version, name);
  }
  for (const name of pins.forbidden) {
    assert.equal(name in declared, false, name);
  }
  assert.equal(pythonX402Present(REPO_ROOT), false);
});

test("installed @x402 packages match the recorded 2.16.0 pin when present", () => {
  const dir = join(REPO_ROOT, "node_modules", "@x402");
  if (!existsSync(dir)) {
    assert.ok(true, "node_modules/@x402 absent; lockfile pin still recorded");
    return;
  }
  const names = readdirSync(dir);
  assert.deepEqual(names.sort(), ["core", "evm", "express", "extensions", "fetch", "mcp"]);
  for (const short of names) {
    const pkg = JSON.parse(readFileSync(join(dir, short, "package.json"), "utf8"));
    assert.equal(pkg.version, pins.x402, `@x402/${short}`);
  }
});
