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

import { extractMcpOutputSchema } from "./extract.mjs";
import {
  DELIVERY,
  PAID_EVIDENCE_FILENAME,
  RESOURCES,
  SETTLEMENT_CLASS,
  VALIDATION_FILENAME,
  digestResponseBytes,
  isHistoricalV1PaidSuccess,
  joinKey,
  openStore,
  parseNdjson,
} from "./http-delivery-evidence/index.mjs";
import { historicalV1Row } from "./http-delivery-evidence/test/helpers.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const PRICE_ATOMIC = "5000";
const FAKE_TX = `0x${"3".repeat(64)}`;

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
      return send(200, { success: true, payer: PAYER, transaction: FAKE_TX, network: NETWORK });
    }
    return send(404, { error: "unexpected" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return { calls, close: () => new Promise((resolve) => server.close(resolve)), url: `http://127.0.0.1:${server.address().port}` };
}

async function startMerchant({ dataDir, facilitatorUrl }) {
  const preloadPath = path.join(dataDir, "extract-fetch-hook.mjs");
  const longHtml = `<html><head><title>Long</title></head><body><p>${"x".repeat(2000)}</p></body></html>`;
  await writeFile(preloadPath, `
globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = 50;
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input, init) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  const pages = {
    "https://ok.example/": { status: 200, url: "https://ok.example/", body: "<html><head><title>OK</title></head><body><p>hello</p></body></html>" },
    "https://403.example/": { status: 403, url: "https://403.example/", body: "<html><body><h1>Access Denied</h1><p>block copy</p></body></html>" },
    "https://long.example/": { status: 200, url: "https://long.example/", body: ${JSON.stringify(longHtml)} },
    "https://gzip.example/": { status: 200, url: "https://gzip.example/", body: "ignored", encoding: "gzip" },
    "https://slow.example/": { hang: true },
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
  const bytes = new TextEncoder().encode(page.body || "");
  let delivered = false;
  return {
    status: page.status,
    url: page.url,
    headers: {
      get(name) {
        const key = name.toLowerCase();
        if (key === "content-encoding") return page.encoding || "identity";
        if (key === "content-type") return "text/html; charset=utf-8";
        return null;
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            if (delivered) return { done: true };
            delivered = true;
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
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
      HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS: "simulated",
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
      reject(new Error(`startup exited: ${code}/${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
  });
  return { base: `http://127.0.0.1:${port}`, child };
}

async function stopChild(child) {
  if (!child) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2_000).unref();
  });
}

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "missing payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function testPayment(challenge) {
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
        info: { required: challenge.extensions?.["payment-identifier"]?.info?.required === true, id: `hde_${randomBytes(8).toString("hex")}` },
      },
    },
  })).toString("base64");
}

async function paidGet(base, route, target, extraHeaders = {}) {
  const unpaid = await fetch(`${base}${route}?url=${encodeURIComponent(target)}`);
  assert.equal(unpaid.status, 402);
  const challenge = decodePaymentRequired(unpaid);
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(accepted.amount, PRICE_ATOMIC);
  const payment = testPayment(challenge);
  const paid = await fetch(`${base}${route}?url=${encodeURIComponent(target)}`, {
    headers: { "payment-signature": extraHeaders.payment || payment, ...extraHeaders.headers },
  });
  const bytes = Buffer.from(await paid.arrayBuffer());
  let body = null;
  try { body = JSON.parse(bytes.toString("utf8")); } catch { body = null; }
  return { unpaid, paid, bytes, body, challenge, payment };
}

async function waitForRows(file, minCount) {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const text = await readFile(file, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
    const rows = parseNdjson(text).filter((row) => !row?._unparseable);
    if (rows.length >= minCount) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${minCount} rows in ${file}`);
}

test("mounted extract captures HTTP delivery evidence without changing v1 paid-success bytes", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "http-delivery-http-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const prior = historicalV1Row({
    id: "22222222-2222-4222-8222-222222222222",
    responseDigest: "f".repeat(64),
    settlementReference: `0x${"a".repeat(64)}`,
  });
  await writeFile(path.join(dataDir, PAID_EVIDENCE_FILENAME), `${JSON.stringify(prior)}\n`, "utf8");

  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });

  const ok = await paidGet(merchant.base, "/extract", "https://ok.example/");
  assert.equal(ok.paid.status, 200);
  assert.equal(extractMcpOutputSchema.safeParse(ok.body).success, true);
  assert.equal(digestResponseBytes(ok.bytes), digestResponseBytes(ok.bytes));

  const refused = await paidGet(merchant.base, "/extract", "https://403.example/");
  assert.equal(refused.paid.status, 200);
  assert.equal(refused.body.sourceOk, false);

  const truncated = await paidGet(merchant.base, "/extract", "https://long.example/");
  assert.equal(truncated.body.capture.textTruncated, true);

  const gzip = await paidGet(merchant.base, "/extract", "https://gzip.example/");
  assert.equal(gzip.body.ok, false);

  const timedOut = await paidGet(merchant.base, "/extract", "https://slow.example/");
  assert.equal(timedOut.body.error.code, "timeout");

  const replay = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://ok.example/")}`, {
    headers: { "payment-signature": ok.payment },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-payment-replay"), "hit");
  assert.equal(facilitator.calls.settle, 5);

  const v1 = await waitForRows(path.join(dataDir, PAID_EVIDENCE_FILENAME), 6);
  const liveV1 = v1.filter((row) => row.id !== prior.id);
  assert.ok(liveV1.length >= 5);
  for (const row of liveV1) {
    assert.equal(isHistoricalV1PaidSuccess(row, { currentValidatorVerdict: "validated" }), true);
    assert.equal(row.validatorVerdict, "not_checked");
    assert.equal(row.validatorAuthority, "none");
    assert.equal(row.validatorSource, "http_runtime_not_checked");
    assert.deepEqual(Object.keys(row).sort(), [
      "credentialFingerprint", "id", "method", "originClass", "payerClass", "paymentProtocol",
      "requestDigest", "requestStartedAt", "responseDigest", "responseFinishedAt", "route",
      "runtimeAttribution", "settlementReference", "source", "v", "validatorAuthority",
      "validatorSource", "validatorVerdict",
    ]);
  }

  const validations = await waitForRows(path.join(dataDir, VALIDATION_FILENAME), 5);
  const byClass = Object.fromEntries(validations.map((row) => [row.deliveryClass, row]));
  assert.equal(byClass[DELIVERY.FULL_BOUNDED_CAPTURE]?.usefulness, "unknown");
  assert.equal(byClass[DELIVERY.SOURCE_REFUSAL]?.counters.sourceRefusalMarks, 1);
  assert.ok(byClass[DELIVERY.TRUNCATED_PARTIAL]?.counters.truncateMarks >= 1);
  assert.equal(byClass[DELIVERY.UNSUPPORTED_CONTENT]?.deliveryClass, DELIVERY.UNSUPPORTED_CONTENT);
  assert.equal(byClass[DELIVERY.TRANSPORT_FAILURE]?.deliveryClass, DELIVERY.TRANSPORT_FAILURE);
  for (const row of validations) {
    assert.equal(row.settlementClass, SETTLEMENT_CLASS.SIMULATED);
    assert.equal(row.usefulness, "unknown");
    assert.equal(Object.hasOwn(row, "parsed"), false);
    assert.equal(JSON.stringify(row).includes("ok.example"), false);
  }

  const okValidation = validations.find((row) => row.deliveryClass === DELIVERY.FULL_BOUNDED_CAPTURE);
  assert.equal(okValidation.responseDigest, digestResponseBytes(ok.bytes));
  const liveOk = liveV1.find((row) => row.responseDigest === okValidation.responseDigest);
  assert.ok(liveOk);
  assert.equal(joinKey(liveOk), joinKey({ method: "GET", resource: RESOURCES.EXTRACT, responseDigest: okValidation.responseDigest }));

  const joined = await openStore(dataDir).join({ currentValidatorVerdict: "validated" });
  const historical = joined.find((row) => row.historical?.id === prior.id);
  assert.equal(historical.historical.validatorVerdict, "not_checked");
  assert.equal(historical.validations.length, 0);
});
