import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://agents.samedaydesk.com";
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const OPERATION = "/commerce/seller-integrity-audit?origin=https%3A%2F%2Fexample.com&route=%2Fextract&method=GET";

function decodeChallenge(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "live unpaid response omitted payment-required");
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  }
}

test("production seller-integrity challenge stays unpaid and documents the existing operation", { timeout: 30_000 }, async () => {
  const response = await fetch(`${ORIGIN}${OPERATION}`, {
    method: "GET",
    redirect: "manual",
    headers: { accept: "application/json" },
  });
  assert.equal(response.status, 402);
  assert.equal(response.headers.get("payment-signature"), null);
  const challenge = decodeChallenge(response);
  const accept = challenge.accepts.find((item) => item.scheme === "exact" && item.network === "eip155:8453");
  assert.ok(accept, "live challenge omitted the Base exact accept");
  assert.equal(accept.amount, "10000");
  assert.equal(String(accept.payTo).toLowerCase(), PAY_TO.toLowerCase());
  const link = response.headers.get("link") || "";
  assert.match(link, /service-desc/);
  assert.match(link, /purchase-evidence/);
  const evidence = await fetch(`${ORIGIN}/.well-known/agent-payment-evidence.json`, {
    headers: { accept: "application/json" },
  });
  assert.equal(evidence.status, 200);
  const manifest = await evidence.json();
  assert.equal(
    manifest.operations.some((item) => item.method === "GET" && item.path === "/commerce/seller-integrity-audit"),
    true,
  );
});

test("live-unpaid client sends no payment header", { timeout: 30_000 }, async () => {
  const child = spawn(process.execPath, ["examples/paid-useful-journey/cli.mjs", "live-unpaid", "--origin", ORIGIN], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, 0, stderr || stdout);
  const body = JSON.parse(stdout);
  assert.equal(body.status, 402);
  assert.equal(body.paymentSent, false);
  assert.equal(body.revenueRecognized, false);
  assert.equal(body.amount, "10000");
  assert.equal(String(body.payTo).toLowerCase(), PAY_TO.toLowerCase());
  assert.equal(body.serviceDesc, true);
  assert.equal(body.purchaseEvidence, true);
});
