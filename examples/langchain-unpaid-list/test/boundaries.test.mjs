import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { admitDiscoveryUrl, admitOrigin } from "../src/url-guard.mjs";
import { listUnpaidResources } from "../src/list.mjs";
import { UnpaidListError } from "../src/errors.mjs";
import { jsonResponse } from "./helpers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

test("example sources do not implement checkout, payment send, or wallet load", () => {
  const files = walk(join(ROOT, "src")).concat(walk(join(ROOT, "bin")));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /signTypedData|privateKeyToAccount|createWalletClient|from ["']@x402\/fetch["']/);
    assert.doesNotMatch(text, /process\.env\.[A-Z0-9_]*PRIVATE/);
    assert.doesNotMatch(text, /headers\s*:\s*\{[^}]*payment-signature/i);
  }
});

test("paid extract URLs are not valid discovery URLs", () => {
  assert.throws(() => admitDiscoveryUrl("https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com"), UnpaidListError);
  assert.throws(() => admitOrigin("http://agents.samedaydesk.com"), UnpaidListError);
  assert.throws(() => admitOrigin("https://user:pass@agents.samedaydesk.com"), UnpaidListError);
  assert.throws(() => admitOrigin("mcp://agents.samedaydesk.com"), UnpaidListError);
});

test("live fetch uses GET accept-json only and rejects payment headers on the caller", async () => {
  const calls = [];
  await assert.rejects(() => listUnpaidResources({
    origin: "https://agents.samedaydesk.com",
    headers: { "payment-signature": "deadbeef" },
    fetchImpl: async (input, init) => {
      calls.push(init);
      return jsonResponse({ x402Version: 2, items: [] });
    },
  }), (error) => {
    assert.equal(error.code, "payment_intent_refused");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("HTTP 200 paid-looking body from live discovery is still rejected", async () => {
  await assert.rejects(() => listUnpaidResources({
    url: "https://agents.samedaydesk.com/.well-known/x402",
    fetchImpl: async () => jsonResponse({ ok: true, title: "Example", text: "paid extract" }),
  }), (error) => {
    assert.equal(error.code, "catalog_malformed");
    return true;
  });
});
