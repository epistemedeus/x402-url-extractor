import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  FORBIDDEN_CHAIN_PACKAGES,
  PINNED_X402,
  REPO_ROOT,
  X402_PACKAGES,
  packageJson,
  packageLock,
} from "./helpers.mjs";

test("root package.json pins every @x402/* dependency to 2.26.0", () => {
  const pkg = packageJson();
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of X402_PACKAGES) {
    assert.equal(declared[name], PINNED_X402, name);
  }
  for (const name of FORBIDDEN_CHAIN_PACKAGES) {
    assert.equal(name in declared, false, `${name} must not be required for exact USDC`);
  }
});

test("lockfile resolves root @x402/* packages to 2.26.0 without extra chains", () => {
  const lock = packageLock();
  const root = lock.packages[""];
  const declared = { ...root.dependencies, ...root.devDependencies };
  for (const name of X402_PACKAGES) {
    assert.equal(declared[name], PINNED_X402, name);
    const entry = lock.packages[`node_modules/${name}`];
    assert.equal(entry?.version, PINNED_X402, `lock ${name}`);
    const short = name.slice("@x402/".length);
    assert.match(
      entry?.resolved ?? "",
      new RegExp(`/@x402/${short}/-/${short}-${PINNED_X402}\\.tgz`),
    );
  }
  for (const name of FORBIDDEN_CHAIN_PACKAGES) {
    assert.equal(`node_modules/${name}` in lock.packages, false, name);
  }
});

test("installed @x402 packages are 2.26.0 and do not pull Casper/Cardano/Celo/XRPL", () => {
  const names = readdirSync(join(REPO_ROOT, "node_modules", "@x402"));
  assert.deepEqual(names.sort(), ["core", "evm", "express", "extensions", "fetch", "mcp"]);
  for (const short of names) {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "node_modules", "@x402", short, "package.json"), "utf8"));
    assert.equal(pkg.version, PINNED_X402, `@x402/${short}`);
  }
});

test("Python x402 is not a present dependency, so 2.23.0 is not required this week", () => {
  const pyproject = join(REPO_ROOT, "integrations", "agentverse-a2a", "pyproject.toml");
  assert.equal(existsSync(pyproject), true);
  const text = readFileSync(pyproject, "utf8");
  assert.equal(/\bx402\s*==/.test(text), false);
  assert.equal(existsSync(join(REPO_ROOT, "requirements.txt")), false);
});
