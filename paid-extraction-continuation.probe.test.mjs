import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BASE_USDC, SCHEMA_VERSION } from "./commerce-settlement-reconciler.mjs";
import { PAID_EVIDENCE_FILENAME, parseNdjson } from "./http-delivery-evidence/historical.mjs";
import { PROSPECTIVE_FILENAME, readProspectiveDelivery, retainProspectiveDeliveries } from "./commerce-prospective-delivery.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const NETWORK = "eip155:8453";
const PAYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ADVERTISED_ORIGIN = "https://agents.samedaydesk.com";
const SDK_ROOT = "/tmp/root175-continuation-sdk-2.16.0";

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function startFacilitator() {
  const calls = { settle: 0, verify: 0, transactions: [] };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      return send(200, { kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, { isValid: true, payer: PAYER });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      const transaction = `0x${calls.settle.toString(16).padStart(64, "a")}`;
      calls.transactions.push(transaction);
      return send(200, {
        success: true,
        payer: PAYER,
        transaction,
        network: NETWORK,
      });
    }
    return send(404, { error: "unexpected" });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        calls,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
    server.once("error", reject);
  });
}

async function startMerchant({ dataDir, facilitatorUrl, feedbackKey }) {
  const preloadPath = path.join(dataDir, "extract-fetch-hook.mjs");
  await writeFile(preloadPath, `
const html = (title) => "<html><head><title>" + title + "</title></head><body><p>" + title + "</p></body></html>";
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  const titles = { "https://ok.example/": "OK", "https://other.example/": "Other" };
  if (!titles[url]) throw Object.assign(new Error("unmapped extract fixture"), { code: "fetch_error" });
  const bytes = new TextEncoder().encode(html(titles[url]));
  let delivered = false;
  return {
    status: 200,
    url: "https://fixture.example/" + titles[url],
    headers: { get(name) {
      const key = String(name).toLowerCase();
      if (key === "content-type") return "text/html; charset=utf-8";
      if (key === "content-encoding") return "identity";
      return null;
    } },
    body: { getReader() { return { async read() {
      if (delivered) return { done: true };
      delivered = true;
      return { done: false, value: bytes };
    }, async cancel() {} }; } },
  };
};
`, "utf8");
  const port = await unusedPort();
  const existingNodeOptions = String(process.env.NODE_OPTIONS || "").trim();
  let output = "";
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: ADVERTISED_ORIGIN,
      HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS: "simulated",
      CALLER_RESULT_FEEDBACK_KEY: feedbackKey,
      NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-40_000); });
  child.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-40_000); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-1500)}`)), 30_000);
    const finish = () => {
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    finish();
    child.stdout.on("data", finish);
    child.stderr.on("data", finish);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited ${code}/${signal}: ${output.slice(-2000)}`));
    });
  });
  return { base: `http://127.0.0.1:${port}`, child, output: () => output };
}

async function ensureSdk() {
  const marker = path.join(SDK_ROOT, "node_modules", "@x402", "fetch", "package.json");
  try {
    await readFile(marker, "utf8");
    return;
  } catch {
    // Install the official client packages away from the merchant checkout.
  }
  const { mkdir } = await import("node:fs/promises");
  await mkdir(SDK_ROOT, { recursive: true });
  await writeFile(path.join(SDK_ROOT, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: {
      "@modelcontextprotocol/sdk": "1.30.0",
      "@x402/evm": "2.16.0",
      "@x402/extensions": "2.16.0",
      "@x402/fetch": "2.16.0",
      "@x402/mcp": "2.16.0",
      viem: "2.55.11",
    },
  }), "utf8");
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: SDK_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(output.slice(-2000)))));
  });
}

async function installConsumer(outDir) {
  await ensureSdk();
  const root = await mkdtemp(path.join(tmpdir(), "root175-consumer-"));
  const { cp, mkdir, symlink } = await import("node:fs/promises");
  await cp(path.join(cwd, "caller-result-client", "src"), path.join(root, "client"), { recursive: true });
  await cp(path.join(cwd, "paid-extraction-continuation.consumer.mjs"), path.join(root, "consumer.mjs"));
  await symlink(path.join(SDK_ROOT, "node_modules"), path.join(root, "node_modules"));
  await mkdir(outDir, { recursive: true });
  return root;
}

function runConsumer(root, mode, config) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["consumer.mjs", mode, config], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`consumer timed out: ${stderr.slice(-1500)}`));
    }, 60_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.includes("ok")) resolve({ stdout, stderr });
      else reject(new Error(`consumer ${mode} exited ${code}: ${stderr.slice(-2000)}\n${stdout.slice(-500)}`));
    });
  });
}

async function waitForText(file, needle) {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const text = await readFile(file, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
    if (text.includes(needle)) return text;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out waiting for ${path.basename(file)} ${needle}`);
}

test("a cold official client can continue one paid extract, and silence is not the same as no offer", { timeout: 180_000 }, async (t) => {
  await ensureSdk();
  const offeredDir = await mkdtemp(path.join(tmpdir(), "root175-offered-"));
  const withheldDir = await mkdtemp(path.join(tmpdir(), "root175-withheld-"));
  const consumerOut = await mkdtemp(path.join(tmpdir(), "root175-out-"));
  const feedbackKey = randomBytes(32).toString("hex");
  const facilitator = await startFacilitator();
  let merchant = await startMerchant({ dataDir: offeredDir, facilitatorUrl: facilitator.url, feedbackKey });
  const consumer = await installConsumer(consumerOut);
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(offeredDir, { recursive: true, force: true });
    await rm(withheldDir, { recursive: true, force: true });
    await rm(consumerOut, { recursive: true, force: true });
    await rm(consumer, { recursive: true, force: true });
  });

  const httpConfig = path.join(consumerOut, "http.json");
  await writeFile(httpConfig, JSON.stringify({
    base: merchant.base,
    target: "https://ok.example/",
    advertisedOrigin: ADVERTISED_ORIGIN,
    outDir: `${consumerOut}/`,
  }));
  await runConsumer(consumer, "http", httpConfig);
  const httpResult = JSON.parse(await readFile(path.join(consumerOut, "result.json"), "utf8"));
  assert.equal(httpResult.status, 200);
  assert.equal(httpResult.feedbackHeader, true);
  assert.equal(httpResult.feedbackLink, true);
  assert.equal(httpResult.capabilityAvailable, true);
  assert.equal(httpResult.capabilityCharged, false);
  assert.equal(httpResult.reportOffered, true);
  assert.equal(httpResult.retrieveOffered, true);
  assert.equal(httpResult.paidTaskCharged, true);
  assert.equal(httpResult.bodyHasCapability, false);
  assert.equal(httpResult.reported, false);
  assert.equal(facilitator.calls.settle, 1);
  const capability = await readFile(path.join(consumerOut, "capability.txt"), "utf8");
  const offeredJournal = await waitForText(path.join(offeredDir, PROSPECTIVE_FILENAME), "\"continuationTransmission\":\"transmitted\"");
  assert.equal(offeredJournal.includes("not_transmitted"), false);
  assert.equal(offeredJournal.includes(capability), false);
  assert.equal(offeredJournal.includes(feedbackKey), false);
  assert.equal(offeredJournal.includes("https://ok.example"), false);

  const bare = await fetch(`${merchant.base}/commerce/caller-result-feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ disposition: "useful" }),
  });
  assert.equal(bare.status, 401);
  const forged = await fetch(`${merchant.base}/commerce/caller-result-feedback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-samedaydesk-caller-result-feedback": "not-a-token",
    },
    body: JSON.stringify({ disposition: "useful" }),
  });
  assert.equal(forged.status, 401);
  const forgedBody = await forged.json();
  assert.equal(forgedBody.accepted, false);

  const beforeReplay = await readFile(path.join(offeredDir, PROSPECTIVE_FILENAME), "utf8");
  await runConsumer(consumer, "replay", httpConfig);
  const replayResult = JSON.parse(await readFile(path.join(consumerOut, "result.json"), "utf8"));
  assert.equal(replayResult.status, 200);
  assert.equal(replayResult.replay, "hit");
  assert.equal(replayResult.feedbackHeader, false);
  assert.equal(facilitator.calls.settle, 1);
  const afterReplay = await readFile(path.join(offeredDir, PROSPECTIVE_FILENAME), "utf8");
  assert.equal(afterReplay, beforeReplay);

  const settlesBeforeMcp = facilitator.calls.settle;
  const mcpConfig = path.join(consumerOut, "mcp.json");
  await writeFile(mcpConfig, JSON.stringify({
    base: merchant.base,
    target: "https://other.example/",
    advertisedOrigin: ADVERTISED_ORIGIN,
    outDir: consumerOut,
  }));
  await runConsumer(consumer, "mcp", mcpConfig);
  const mcpResult = JSON.parse(await readFile(path.join(consumerOut, "mcp-result.json"), "utf8"));
  assert.equal(mcpResult.paymentMade, true);
  assert.equal(mcpResult.isError, false);
  assert.equal(mcpResult.returnedCapability, false);
  assert.equal(mcpResult.capabilityPresent, false);
  assert.equal(mcpResult.reportOffered, false);
  assert.equal(mcpResult.retrieveOffered, true);
  assert.equal(mcpResult.paidTaskCharged, true);
  assert.equal(mcpResult.reported, false);
  assert.equal(mcpResult.recovery.called, true);
  assert.equal(mcpResult.recovery.isError, false);
  assert.equal(facilitator.calls.settle, settlesBeforeMcp + 1);
  const mixedJournal = await waitForText(
    path.join(offeredDir, PROSPECTIVE_FILENAME),
    "\"continuationTransmission\":\"not_transmitted\"",
  );
  assert.equal(mixedJournal.includes("\"continuationTransmission\":\"transmitted\""), true);
  assert.equal(mixedJournal.includes(capability), false);
  assert.equal(mixedJournal.includes(feedbackKey), false);
  assert.equal(mixedJournal.includes("https://"), false);

  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir: offeredDir, facilitatorUrl: facilitator.url, feedbackKey });
  const survived = await readFile(path.join(offeredDir, PROSPECTIVE_FILENAME), "utf8");
  assert.equal(survived.includes("\"continuationTransmission\":\"transmitted\""), true);
  assert.equal(survived.includes("\"continuationTransmission\":\"not_transmitted\""), true);

  const ledgerRows = facilitator.calls.transactions.slice(0, 2).map((reference, index) => ({
    schemaVersion: SCHEMA_VERSION,
    state: "reconciled",
    sourceEventId: `10061017-1017-4017-8017-${String(index + 1).padStart(12, "0")}`,
    sourceEventTimestamp: "2026-10-17T12:00:00.000Z",
    route: index === 0 ? "/extract" : "/mcp",
    protocol: "x402",
    paymentClass: "unclassified",
    settlementReference: reference,
    network: NETWORK,
    asset: BASE_USDC,
    amountAtomic: "10000",
  }));
  const ledger = `${ledgerRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  await writeFile(path.join(offeredDir, "commerce-settlements.ndjson"), ledger, { mode: 0o600 });
  await retainProspectiveDeliveries({
    dataDir: offeredDir,
    settlementReferences: ledgerRows.map((row) => row.settlementReference),
    now: Date.parse("2026-10-17T15:00:00.000Z"),
  });
  const packet = await readProspectiveDelivery({
    dataDir: offeredDir,
    ledger,
    generatedAt: "2026-10-17T15:00:00.000Z",
  });
  assert.equal(packet.continuationTransmission.transmitted, 1);
  assert.equal(packet.continuationTransmission.not_transmitted, 1);
  assert.equal(packet.declaredFeedback.absent, 2);
  assert.equal(packet.declaredFeedback.declared_useful, 0);
  assert.equal(packet.declaredFeedback.declared_not_useful, 0);
  assert.equal(packet.usefulness, "unknown");
  assert.equal(packet.customerAttribution, null);
  assert.equal(packet.recognizedIncomeAtomic, null);
  assert.equal(packet.independentRepeat, null);
  assert.equal(packet.boundaries.continuationTransmissionIsNotClientObservation, true);
  assert.equal(packet.boundaries.omittedContinuationTransmissionIsUnknown, true);
  const published = JSON.stringify(packet);
  assert.equal(published.includes(capability), false);
  assert.equal(published.includes(feedbackKey), false);
  assert.equal(published.includes("https://ok.example"), false);
  assert.equal(published.includes(ledgerRows[0].settlementReference), false);

  const withheldOut = path.join(consumerOut, "withheld");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(withheldOut, { recursive: true });
  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir: withheldDir, facilitatorUrl: facilitator.url, feedbackKey: "" });
  const withheldConfig = path.join(consumerOut, "withheld.json");
  await writeFile(withheldConfig, JSON.stringify({
    base: merchant.base,
    target: "https://ok.example/",
    advertisedOrigin: ADVERTISED_ORIGIN,
    outDir: withheldOut,
  }));
  const settlesBeforeWithheld = facilitator.calls.settle;
  await runConsumer(consumer, "http", withheldConfig);
  const withheldResult = JSON.parse(await readFile(path.join(withheldOut, "result.json"), "utf8"));
  assert.equal(withheldResult.status, 200);
  assert.equal(withheldResult.feedbackHeader, false);
  assert.equal(withheldResult.capabilityAvailable, false);
  assert.equal(withheldResult.reportOffered, false);
  assert.equal(withheldResult.reported, false);
  assert.equal(facilitator.calls.settle, settlesBeforeWithheld + 1);
  const withheldJournal = await waitForText(
    path.join(withheldDir, PROSPECTIVE_FILENAME),
    "\"continuationTransmission\":\"not_transmitted\"",
  );
  assert.equal(withheldJournal.includes("\"continuationTransmission\":\"transmitted\""), false);
  assert.equal(withheldJournal.includes(feedbackKey), false);
  const paidEvidence = await readFile(path.join(offeredDir, PAID_EVIDENCE_FILENAME), "utf8");
  assert.equal(paidEvidence.includes(capability), false);
  assert.equal(parseNdjson(paidEvidence).some((row) => row?.settlementReference), true);
});
