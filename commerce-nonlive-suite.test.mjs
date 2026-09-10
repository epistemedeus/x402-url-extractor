import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const REQUIRED_NONLIVE_FILES = Object.freeze([
  "commerce-nonlive-suite.test.mjs",
  "commerce-trust.test.mjs",
  "commerce-payment-evidence.test.mjs",
  "commerce-settlement-reconciler.test.mjs",
  "commerce-settlement-source-delivery.test.mjs",
  "settlement-proof.test.mjs",
  "purchase-evidence-manifest.test.mjs",
  "payment-offer-preflight.test.mjs",
  "discovery-drift.test.mjs",
  "transaction-receipt.test.mjs",
  "circle-gateway-route.test.mjs",
  "commerce-rare-funnel.mounted.test.mjs",
]);

const SKIPPED_LIVE_SCRIPTS = Object.freeze([
  "test:claude-marketplace:live",
  "test:goose-native:live",
]);

const MOCKED_CLIENT_FILES = Object.freeze([
  "commerce-settlement-reconciler.test.mjs",
  "commerce-settlement-source-delivery.test.mjs",
  "settlement-proof.test.mjs",
  "transaction-receipt.test.mjs",
]);

function parseNodeTestFiles(script) {
  assert.equal(typeof script, "string");
  assert.match(script, /^node --test\b/);
  return script.replace(/^node --test\s+/, "").split(/\s+/).filter(Boolean);
}

test("test:nonlive owns local commerce unit paths and excludes live payment scripts", () => {
  const files = parseNodeTestFiles(pkg.scripts["test:nonlive"]);
  for (const file of REQUIRED_NONLIVE_FILES) {
    assert.equal(files.includes(file), true, `missing ${file}`);
    assert.equal(existsSync(join(ROOT, file)), true, `${file} must exist`);
  }
  assert.equal(files.includes("commerce-events.test.mjs"), false);
  assert.equal(files.some((file) => file.endsWith(".live.test.mjs")), false);
  for (const name of SKIPPED_LIVE_SCRIPTS) {
    assert.equal(typeof pkg.scripts[name], "string", name);
    assert.match(pkg.scripts[name], /\.live\.test\.mjs/);
    assert.equal(files.includes(pkg.scripts[name].replace(/^node --test\s+/, "")), false, name);
  }
});

test("mounted rare-funnel is in npm test and test:nonlive without joining live scripts", () => {
  assert.match(pkg.scripts.test, /(?:^|\s)commerce-rare-funnel\.mounted\.test\.mjs(?:\s|$)/);
  assert.match(pkg.scripts["test:nonlive"], /(?:^|\s)commerce-rare-funnel\.mounted\.test\.mjs(?:\s|$)/);
  assert.doesNotMatch(pkg.scripts.test, /\.live\.test\.mjs/);
  assert.doesNotMatch(pkg.scripts["test:nonlive"], /\.live\.test\.mjs/);
});

test("non-live suite files do not target live MCP or construct provider RPC clients", () => {
  for (const file of parseNodeTestFiles(pkg.scripts["test:nonlive"])) {
    if (file === "commerce-nonlive-suite.test.mjs") continue;
    assert.equal(existsSync(join(ROOT, file)), true, `${file} must exist`);
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.equal(source.includes("LIVE_MCP_URL"), false, file);
    assert.equal(source.includes("https://agents.samedaydesk.com/mcp"), false, file);
    assert.doesNotMatch(source, /createPublicClient\s*\(/, file);
  }
  for (const file of MOCKED_CLIENT_FILES) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.match(source, /client:\s*client(?:For)?\(/, file);
  }
});
