import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) stack.push(full);
      else files.push(full);
    }
  }
  return files.sort();
}

test("example has no payment, checkout, publish, neo, or wallet implementation", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.doesNotMatch(JSON.stringify(pkg), /@x402\/fetch|viem|wallet/);

  const sources = walkFiles(join(ROOT, "src")).concat([
    join(ROOT, "bin/cli.mjs"),
    join(ROOT, "package.json"),
  ]);
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes("@x402/fetch"), false, relative(ROOT, file));
    assert.equal(text.includes("privateKeyToAccount"), false, relative(ROOT, file));
    if (!file.endsWith("redact.mjs")) {
      assert.equal(text.includes("PAYMENT-SIGNATURE"), false, relative(ROOT, file));
    }
    assert.doesNotMatch(text, /Mcp-Method/);
    assert.doesNotMatch(text, /2026-07-28/);
    assert.doesNotMatch(text, /\btools\/call\b.*fetchImpl|\bfetchImpl.*tools\/call/);
  }
});

test("README keeps unpaid discovery separate from payment authority", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /npm start/);
  assert.match(readme, /never.*pay/i);
  assert.match(readme, /--approve/);
  assert.match(readme, /not an Anthropic official directory listing/i);
  assert.match(readme, /Listing and install grant no payment authority/);
  assert.doesNotMatch(readme, /CUSTOMER_X402_PRIVATE_KEY/);
  assert.doesNotMatch(readme, /neomorphic/);
});

test("default commands do not mention checkout, publish, or neo as features", () => {
  const cli = readFileSync(join(ROOT, "bin/cli.mjs"), "utf8");
  assert.match(cli, /--checkout/);
  assert.match(cli, /refused/);
  assert.match(cli, /touches neo/);
});
