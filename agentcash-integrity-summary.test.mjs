import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sellerIntegrityAuditOutputSchema } from "./seller-integrity-audit.mjs";
import { CDP_RESOURCE_DESCRIPTION_MAX_CODE_POINTS } from "./x402-resource-compat.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const ROUTE = "/commerce/seller-integrity-audit";
export const SELLER_INTEGRITY_AUDIT_AGENTCASH_SUMMARY = "x402 and MPP seller integrity audit for one exact paid GET or POST route after a buyer integration fails, a seller changes the route, or before the next paid retry or release. Returns machine_buyable, contract_ready, or repair_required with exact repair actions. Checks constructible non-secret input, live unpaid GET terms, optional Bazaar metadata, and buyer-required success paths. Uses no credential or target payment, follows no redirect, and sends no target POST.";

function agentCashIngestedSummary(operation) {
  return operation.summary ?? operation.description;
}

function decodePaymentRequiredHeader(header) {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

test("seller-integrity audit summary is exact, bounded, and byte-identical across OpenAPI and machine discovery", { timeout: 60_000 }, async (t) => {
  assert.equal(SELLER_INTEGRITY_AUDIT_AGENTCASH_SUMMARY.length, 469);
  assert.ok(SELLER_INTEGRITY_AUDIT_AGENTCASH_SUMMARY.length <= CDP_RESOURCE_DESCRIPTION_MAX_CODE_POINTS);
  assert.ok(SELLER_INTEGRITY_AUDIT_AGENTCASH_SUMMARY.includes("x402 and MPP seller integrity audit"));
  assert.equal(SELLER_INTEGRITY_AUDIT_AGENTCASH_SUMMARY.includes("referral"), false);

  const dataDir = await mkdtemp(path.join(tmpdir(), "agentcash-integrity-summary-"));
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: "https://agents.samedaydesk.com",
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`server exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
  });

  const base = `http://127.0.0.1:${port}`;
  const [openapi, manifest, challengeResponse] = await Promise.all([
    fetch(`${base}/openapi.json`).then((response) => response.json()),
    fetch(`${base}/.well-known/x402`).then((response) => response.json()),
    fetch(`${base}${ROUTE}`),
  ]);
  assert.equal(challengeResponse.status, 402);

  const operation = openapi.paths[ROUTE].get;
  const openApiSummary = operation.summary;
  assert.equal(openApiSummary, SELLER_INTEGRITY_AUDIT_AGENTCASH_SUMMARY);
  assert.equal(agentCashIngestedSummary(operation), SELLER_INTEGRITY_AUDIT_AGENTCASH_SUMMARY);

  const manifestItem = manifest.items.find((item) => item.resource.routeTemplate === ROUTE);
  assert.ok(manifestItem);
  assert.equal(manifestItem.resource.description, SELLER_INTEGRITY_AUDIT_AGENTCASH_SUMMARY);

  const encodedChallenge = challengeResponse.headers.get("payment-required");
  assert.ok(encodedChallenge);
  const challenge = decodePaymentRequiredHeader(encodedChallenge);
  assert.equal(challenge.resource.description, SELLER_INTEGRITY_AUDIT_AGENTCASH_SUMMARY);

  const outputSchema = sellerIntegrityAuditOutputSchema();
  assert.ok(outputSchema.properties.referralOffer);
  assert.ok(outputSchema.required.includes("referralOffer"));
});
