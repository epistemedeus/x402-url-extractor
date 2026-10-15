import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createCallerResultFeedbackService } from "../../../caller-result-feedback.mjs";
import { CALLER_RESULT_FEEDBACK_HEADER } from "../../../caller-result-client/src/contract.mjs";
import { callerResultFeedbackPublicContract } from "../../../caller-result-feedback.mjs";
import { PAID_EVIDENCE_FILENAME } from "../../../http-delivery-evidence/historical.mjs";
import { VALIDATION_FILENAME } from "../../../http-delivery-evidence/store.mjs";
import { OBSERVATION_FILENAME } from "../src/contract.mjs";

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const NETWORK = "eip155:8453";
const PAYER = `0x${"2".repeat(40)}`;

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

async function startFakeFacilitator() {
  const calls = { settle: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      return send(200, { kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    }
    if (req.method === "POST" && req.url === "/verify") return send(200, { isValid: true, payer: PAYER });
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(200, {
        success: true,
        payer: PAYER,
        transaction: `0x${calls.settle.toString(16).padStart(64, "0")}`,
        network: NETWORK,
      });
    }
    return send(404, { error: "unexpected" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function startMerchant({ dataDir, facilitatorUrl, feedbackKey }) {
  const preloadPath = path.join(dataDir, "feedback-fetch-hook.mjs");
  await writeFile(preloadPath, `
const html = (title) => "<html><head><title>" + title + "</title></head><body><p>" + title + "</p></body></html>";
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  const title = url.includes("other") ? "Other" : "OK";
  const bytes = new TextEncoder().encode(html(title));
  let delivered = false;
  return {
    status: 200,
    url,
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
      PUBLIC_URL: "https://agents.samedaydesk.com",
      HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS: "simulated",
      CALLER_RESULT_FEEDBACK_KEY: feedbackKey,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-20000); });
  child.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-20000); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-1500)}`)), 20000);
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
      reject(new Error(`startup exited ${code}/${signal}: ${output.slice(-1500)}`));
    });
  });
  return { base: `http://127.0.0.1:${port}`, child };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function paymentHeader(challenge) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(accepted.amount, "5000");
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    ...(challenge.resource ? { resource: challenge.resource } : {}),
    accepted,
    payload: {
      signature: `0x${"4".repeat(130)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: `0x${randomBytes(32).toString("hex")}`,
      },
    },
    extensions: {
      "payment-identifier": {
        info: {
          required: challenge.extensions?.["payment-identifier"]?.info?.required === true,
          id: `uso_${randomBytes(8).toString("hex")}`,
        },
      },
    },
  })).toString("base64");
}

async function paidExtract(base, target) {
  const unpaid = await fetch(`${base}/extract?url=${encodeURIComponent(target)}`);
  assert.equal(unpaid.status, 402);
  const challenge = JSON.parse(Buffer.from(unpaid.headers.get("payment-required"), "base64").toString("utf8"));
  const paid = await fetch(`${base}/extract?url=${encodeURIComponent(target)}`, {
    headers: { "payment-signature": paymentHeader(challenge) },
  });
  const bytes = Buffer.from(await paid.arrayBuffer());
  return { paid, bytes, body: JSON.parse(bytes.toString("utf8")) };
}

async function observationRows(dataDir) {
  const text = await readFile(path.join(dataDir, OBSERVATION_FILENAME), "utf8").catch((error) => (
    error?.code === "ENOENT" ? "" : Promise.reject(error)
  ));
  return text.split("\n").filter((line) => line.trim());
}

test("D3 the branch server discovers, accepts, replays, and restarts the extension", { timeout: 180000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "ae14-uso-mount-"));
  const feedbackKey = randomBytes(32).toString("hex");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, feedbackKey });
  const first = await paidExtract(merchant.base, "https://ok.example/");
  assert.equal(first.paid.status, 200);
  const link = first.paid.headers.get("link") || "";
  const part = link.split(",").find((item) => item.includes('rel="useful-service-observation"'));
  assert.ok(part);
  const href = part.match(/<([^>]+)>/)[1];
  const token = first.paid.headers.get("x-samedaydesk-caller-result-feedback");
  assert.equal(first.bytes.includes(token), false);
  const contract = await (await fetch(`${merchant.base}${href}`)).json();
  const canonical = callerResultFeedbackPublicContract();
  for (const [key, value] of Object.entries(canonical)) assert.deepEqual(contract[key], value);
  const extensionBody = {
    disposition: contract.dispositions[0],
    reasonCategory: contract.reasonCategories[0],
    retainedUse: contract.usefulServiceObservation.retainedUse[0],
    nextTask: { relation: "none", taskRef: "none" },
    originLabel: contract.usefulServiceObservation.originLabels[0],
  };
  const submitted = await fetch(`${merchant.base}${href}`, {
    method: "POST",
    headers: { "content-type": "application/json", [CALLER_RESULT_FEEDBACK_HEADER]: token },
    body: JSON.stringify(extensionBody),
  });
  const submittedBody = await submitted.json();
  assert.equal(submitted.status, 200, JSON.stringify(submittedBody));
  assert.equal(submittedBody.retainedUse, "retained");
  assert.equal(submittedBody.idempotentReplay, false);
  assert.equal(submittedBody.usefulness, "unknown");
  const replay = await fetch(`${merchant.base}${href}`, {
    method: "POST",
    headers: { "content-type": "application/json", [CALLER_RESULT_FEEDBACK_HEADER]: token },
    body: JSON.stringify(extensionBody),
  });
  const replayBody = await replay.json();
  assert.equal(replay.status, 200);
  assert.equal(replayBody.idempotentReplay, true);
  assert.equal((await observationRows(dataDir)).length, 1);

  const second = await paidExtract(merchant.base, "https://other.example/");
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const text = await readFile(path.join(dataDir, PAID_EVIDENCE_FILENAME), "utf8").catch(() => "");
    if (text.split("\n").filter(Boolean).length >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const secondToken = second.paid.headers.get("x-samedaydesk-caller-result-feedback");
  const aloneDir = await mkdtemp(path.join(tmpdir(), "ae14-uso-alone-"));
  await cp(path.join(dataDir, PAID_EVIDENCE_FILENAME), path.join(aloneDir, PAID_EVIDENCE_FILENAME));
  await cp(path.join(dataDir, VALIDATION_FILENAME), path.join(aloneDir, VALIDATION_FILENAME));
  const oldBody = { disposition: "useful", reasonCategory: "matched_task" };
  const oldResponse = await fetch(`${merchant.base}/commerce/caller-result-feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", [CALLER_RESULT_FEEDBACK_HEADER]: secondToken },
    body: JSON.stringify(oldBody),
  });
  const oldJson = await oldResponse.json();
  const direct = await createCallerResultFeedbackService({
    dataDir: aloneDir,
    key: feedbackKey,
    now: () => Date.now(),
  }).submit({
    token: secondToken,
    body: oldBody,
    rawBody: Buffer.from(JSON.stringify(oldBody)),
    query: {},
  });
  assert.equal(oldResponse.status, direct.statusCode);
  assert.equal(JSON.stringify(oldJson), JSON.stringify(direct.body));
  assert.equal(Object.hasOwn(oldJson, "retainedUse"), false);
  await rm(aloneDir, { recursive: true, force: true });

  const listed = await fetch(`${merchant.base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const listedText = await listed.text();
  assert.equal(listed.status, 200);
  assert.equal(listedText.includes("usefulServiceObservation"), false);
  assert.equal(listedText.includes(CALLER_RESULT_FEEDBACK_HEADER), false);

  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, feedbackKey });
  const afterRestart = await fetch(`${merchant.base}${href}`, {
    method: "POST",
    headers: { "content-type": "application/json", [CALLER_RESULT_FEEDBACK_HEADER]: token },
    body: JSON.stringify(extensionBody),
  });
  const afterBody = await afterRestart.json();
  assert.equal(afterRestart.status, 200, JSON.stringify(afterBody));
  assert.equal(afterBody.idempotentReplay, true);
  assert.equal((await observationRows(dataDir)).length, 1);
});
