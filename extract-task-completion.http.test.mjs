import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const PRICE_ATOMIC = "5000";
const MARKER = "later-discussion-marker";

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
  const calls = { settle: 0, verify: 0 };
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
      return send(200, { success: true, payer: PAYER, transaction: `0x${"3".repeat(64)}`, network: NETWORK });
    }
    return send(404, { error: "unexpected_test_facilitator_request" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function startMerchant({ dataDir, facilitatorUrl, fetchLog }) {
  const preloadPath = path.join(dataDir, "extract-fetch-hook.mjs");
  await writeFile(preloadPath, `
import { appendFileSync } from "node:fs";
const log = ${JSON.stringify(fetchLog)};
globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = 40;
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input, init) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  appendFileSync(log, url + "\\n");
  const longBody = "<html><head><title>Doc</title></head><body><article>" + "intro ".repeat(400) + "</article><p>${MARKER}</p></body></html>";
  const pages = {
    "https://doc.example/": { status: 200, url: "https://doc.example/", body: longBody },
    "https://short.example/": { status: 200, url: "https://short.example/", body: "<html><head><title>Short</title></head><body><p>hello</p></body></html>" },
    "https://denied.example/": { status: 403, url: "https://denied.example/", body: "<html><body><h1>Access Denied</h1></body></html>" },
    "https://slow.example/": { hang: true },
    "https://huge.example/": { huge: true },
  };
  const page = pages[url];
  if (!page) throw Object.assign(new Error("unmapped extract fixture"), { code: "fetch_error" });
  if (page.hang) {
    return new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      }, { once: true });
    });
  }
  if (page.huge) {
    const chunk = new Uint8Array(400000).fill(65);
    let n = 0;
    return {
      status: 200,
      url,
      headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null },
      body: { getReader() { return { async read() { if (n >= 10) return { done: true }; n += 1; return { done: false, value: chunk }; }, async cancel() {} }; } },
    };
  }
  const bytes = new TextEncoder().encode(page.body || "");
  let delivered = false;
  return {
    status: page.status,
    url: page.url,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null },
    body: { getReader() { return { async read() { if (delivered) return { done: true }; delivered = true; return { done: false, value: bytes }; }, async cancel() {} }; } },
  };
};
`, "utf8");
  const port = await unusedPort();
  const existingNodeOptions = String(process.env.NODE_OPTIONS || "").trim();
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
      NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-40_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
  });
  return { base: `http://127.0.0.1:${port}`, child };
}

async function stopChild(child) {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2_000).unref();
  });
}

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "challenge omitted payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function testPayment(challenge, id) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.ok(accepted);
  return Buffer.from(JSON.stringify({
    x402Version: 2,
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
        info: { required: challenge.extensions?.["payment-identifier"]?.info?.required === true, id },
      },
    },
  })).toString("base64");
}

test("mounted extract budget is rejected before payment and does not silently buy /read", { timeout: 90_000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-task-http-"));
  const fetchLog = path.join(dataDir, "fetches.log");
  await writeFile(fetchLog, "");
  const facilitator = await startFakeFacilitator();
  const merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLog });
  try {
    const badValues = ["0", "40001", "nope", "1.2"];
    for (const value of badValues) {
      const bad = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://doc.example/")}&textExcerptLimitChars=${value}`);
      const body = await bad.json();
      assert.equal(bad.status, 400, JSON.stringify(body));
      assert.equal(body.charged, false);
      assert.match(body.error, /textExcerptLimitChars/);
    }
    const duplicate = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://doc.example/")}&textExcerptLimitChars=100&textExcerptLimitChars=200`);
    assert.equal(duplicate.status, 400);
    assert.equal((await duplicate.json()).charged, false);
    assert.equal(facilitator.calls.settle, 0);
    assert.equal(await readFile(fetchLog, "utf8"), "");

    const unpaid = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://doc.example/")}`);
    assert.equal(unpaid.status, 402);
    const challenge = decodePaymentRequired(unpaid);
    const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
    assert.equal(accepted.amount, PRICE_ATOMIC);
    assert.equal(accepted.payTo, PAY_TO);
    assert.match(challenge.resource?.description || accepted.description || "", /textExcerptLimitChars|1,200|1200/);

    const payment = testPayment(challenge, "extract_task_default");
    const target = `${merchant.base}/extract?url=${encodeURIComponent("https://doc.example/")}`;
    const paid = await fetch(target, { headers: { "payment-signature": payment } });
    const cropped = await paid.json();
    assert.equal(paid.status, 200);
    assert.equal(cropped.capture.textExcerptLimitChars, 1200);
    assert.equal(cropped.capture.textTruncated, true);
    assert.equal(cropped.text.includes(MARKER), false);
    assert.equal(facilitator.calls.settle, 1);

    const replay = await fetch(target, { headers: { "payment-signature": payment } });
    const replayed = await replay.json();
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("x-payment-replay"), "hit");
    assert.equal(replayed.text, cropped.text);
    assert.equal(facilitator.calls.settle, 1);

    const conflict = await fetch(`${target}&textExcerptLimitChars=8000`, { headers: { "payment-signature": payment } });
    const conflictBody = await conflict.json();
    assert.equal(conflict.status, 409);
    assert.equal(conflictBody.charged, false);
    assert.equal(facilitator.calls.settle, 1);
    assert.equal((await readFile(fetchLog, "utf8")).trim().split("\n").length, 1);

    const raisedChallenge = decodePaymentRequired(await fetch(`${target}&textExcerptLimitChars=8000`));
    const raisedAccepted = raisedChallenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
    assert.equal(raisedAccepted.amount, PRICE_ATOMIC);
    assert.equal(raisedAccepted.payTo, PAY_TO);
    const raised = await fetch(`${target}&textExcerptLimitChars=8000`, {
      headers: { "payment-signature": testPayment(raisedChallenge, "extract_task_raised") },
    });
    const raisedBody = await raised.json();
    assert.equal(raised.status, 200);
    assert.equal(raisedBody.capture.textExcerptLimitChars, 8000);
    assert.equal(raisedBody.text.includes(MARKER), true);
    assert.equal(raisedBody.capture.textTruncated, false);
    assert.equal(facilitator.calls.settle, 2);

    const readUnpaid = await fetch(`${merchant.base}/read?url=${encodeURIComponent("https://doc.example/")}`);
    assert.equal(readUnpaid.status, 402);
    const readChallenge = decodePaymentRequired(readUnpaid);
    const readPaid = await fetch(`${merchant.base}/read?url=${encodeURIComponent("https://doc.example/")}`, {
      headers: { "payment-signature": testPayment(readChallenge, "extract_task_read") },
    });
    const markdown = await readPaid.json();
    assert.equal(readPaid.status, 200);
    assert.equal(markdown.markdown.includes(MARKER), true);
    assert.equal(markdown.truncated, false);

    const deniedChallenge = decodePaymentRequired(await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://denied.example/")}`));
    const denied = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://denied.example/")}`, {
      headers: { "payment-signature": testPayment(deniedChallenge, "extract_task_denied") },
    });
    const deniedBody = await denied.json();
    assert.equal(denied.status, 200);
    assert.equal(deniedBody.ok, true);
    assert.equal(deniedBody.sourceOk, false);
    assert.equal(deniedBody.error.code, "http_403");

    const slowChallenge = decodePaymentRequired(await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://slow.example/")}`));
    const slow = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://slow.example/")}`, {
      headers: { "payment-signature": testPayment(slowChallenge, "extract_task_slow") },
    });
    const slowBody = await slow.json();
    assert.equal(slow.status, 200);
    assert.equal(slowBody.ok, false);
    assert.equal(slowBody.error.code, "timeout");

    const hugeChallenge = decodePaymentRequired(await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://huge.example/")}`));
    const huge = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://huge.example/")}`, {
      headers: { "payment-signature": testPayment(hugeChallenge, "extract_task_huge") },
    });
    const hugeBody = await huge.json();
    assert.equal(huge.status, 200);
    assert.equal(hugeBody.capture.bodyTruncated, true);
    assert.equal(hugeBody.capture.textTruncated, true);

    const shortChallenge = decodePaymentRequired(await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://short.example/")}`));
    const short = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://short.example/")}`, {
      headers: { "payment-signature": testPayment(shortChallenge, "extract_task_short") },
    });
    const shortBody = await short.json();
    assert.equal(short.status, 200);
    assert.equal(shortBody.capture.textTruncated, false);
    assert.equal(shortBody.text, "hello");
    assert.equal(shortBody.requestedUrl, "https://short.example/");
  } finally {
    await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
