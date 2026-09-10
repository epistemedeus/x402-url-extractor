import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { extractMcpOutputSchema, readMcpOutputSchema } from "./extract.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const PRICE_ATOMIC = "5000";

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
  const calls = { settle: 0, supported: 0, verify: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      return send(200, {
        kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, { isValid: true, payer: PAYER });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(200, {
        success: true,
        payer: PAYER,
        transaction: `0x${"3".repeat(64)}`,
        network: NETWORK,
      });
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

async function startMerchant({ dataDir, facilitatorUrl }) {
  const preloadPath = path.join(dataDir, "extract-fetch-hook.mjs");
  await writeFile(preloadPath, `
globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = 50;
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input, init) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  const pages = {
    "https://ok.example/": { status: 200, url: "https://ok.example/", body: "<html><head><title>OK</title></head><body><p>hello</p></body></html>" },
    "https://empty.example/": { status: 200, url: "https://empty.example/", body: "" },
    "https://204.example/": { status: 204, url: "https://204.example/", body: "" },
    "https://403.example/": { status: 403, url: "https://403.example/", body: "<html><body><h1>Access Denied</h1><p>block copy</p></body></html>" },
    "https://404.example/": { status: 404, url: "https://404.example/", body: "<html><body><h1>Not Found</h1><p>helpful missing copy</p></body></html>" },
    "https://429.example/": { status: 429, url: "https://429.example/", body: "rate limited", contentType: "text/plain" },
    "https://500.example/": { status: 500, url: "https://500.example/", body: "<html><body>internal error</body></html>" },
    "https://start.example/": { status: 200, url: "https://end.example/page", body: "<html><head><title>Final</title></head><body><p>after redirect</p></body></html>" },
    "https://slow.example/": { hang: true },
  };
  const page = pages[url];
  if (!page) {
    throw Object.assign(new Error("unmapped extract fixture"), { code: "fetch_error" });
  }
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
    headers: { get: (name) => name.toLowerCase() === "content-type" ? (page.contentType || "text/html; charset=utf-8") : null },
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
  return { base: `http://127.0.0.1:${port}`, child, output: () => output };
}

async function stopChild(child) {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
}

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "extract challenge omitted payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function testPayment(challenge) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.ok(accepted, "extract challenge omitted Base exact payment terms");
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  const paymentId = `extract_http_${randomBytes(8).toString("hex")}`;
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
        nonce,
      },
    },
    extensions: {
      "payment-identifier": {
        info: { required: challenge.extensions?.["payment-identifier"]?.info?.required === true, id: paymentId },
      },
    },
  })).toString("base64");
}

async function paidGet(base, route, target) {
  const unpaid = await fetch(`${base}${route}?url=${encodeURIComponent(target)}`);
  assert.equal(unpaid.status, 402);
  const challenge = decodePaymentRequired(unpaid);
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(accepted.amount, PRICE_ATOMIC);
  assert.equal(accepted.payTo, PAY_TO);
  const paid = await fetch(`${base}${route}?url=${encodeURIComponent(target)}`, {
    headers: { "payment-signature": testPayment(challenge) },
  });
  const body = await paid.json();
  return { paid, body, challenge };
}

test("paid extract and read preserve source HTTP semantics without a second payment path", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-http-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });

  const ok = await paidGet(merchant.base, "/extract", "https://ok.example/");
  assert.equal(ok.paid.status, 200, JSON.stringify(ok.body));
  const okParsed = extractMcpOutputSchema.safeParse(ok.body);
  assert.equal(okParsed.success, true, okParsed.success ? "" : JSON.stringify(okParsed.error.issues));
  assert.equal(ok.body.sourceOk, true, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 200);
  assert.equal(ok.body.requestedUrl, "https://ok.example/");
  assert.equal(facilitator.calls.verify, 1);
  assert.equal(facilitator.calls.settle, 1);

  const empty = await paidGet(merchant.base, "/extract", "https://empty.example/");
  const blocked = await paidGet(merchant.base, "/extract", "https://403.example/");
  const missing = await paidGet(merchant.base, "/extract", "https://404.example/");
  assert.equal(empty.body.ok, true, JSON.stringify(empty.body));
  assert.equal(empty.body.sourceOk, true);
  assert.equal(empty.body.status, 200);
  assert.equal(blocked.body.ok, true);
  assert.equal(blocked.paid.status, 200);
  assert.equal(blocked.body.status, 403);
  assert.equal(blocked.body.sourceOk, false);
  assert.equal(blocked.body.error.code, "http_403");
  assert.match(blocked.body.text, /block copy/);
  assert.equal(missing.body.status, 404);
  assert.equal(missing.body.error.code, "http_404");

  const noContent = await paidGet(merchant.base, "/extract", "https://204.example/");
  assert.equal(noContent.body.status, 204);
  assert.equal(noContent.body.sourceOk, true);

  const limited = await paidGet(merchant.base, "/extract", "https://429.example/");
  const down = await paidGet(merchant.base, "/extract", "https://500.example/");
  assert.equal(limited.body.status, 429);
  assert.equal(limited.body.error.code, "http_429");
  assert.equal(down.body.status, 500);
  assert.equal(down.body.error.code, "http_500");

  const redirected = await paidGet(merchant.base, "/extract", "https://start.example/");
  assert.equal(redirected.body.requestedUrl, "https://start.example/");
  assert.equal(redirected.body.finalUrl, "https://end.example/page");
  assert.equal(redirected.body.url, "https://end.example/page");

  const timedOut = await paidGet(merchant.base, "/extract", "https://slow.example/");
  assert.equal(timedOut.paid.status, 200);
  assert.equal(timedOut.body.ok, false);
  assert.equal(timedOut.body.status, null);
  assert.equal(timedOut.body.sourceOk, false);
  assert.equal(timedOut.body.error.code, "timeout");
  assert.equal(extractMcpOutputSchema.safeParse(timedOut.body).success, false);

  const markdown = await paidGet(merchant.base, "/read", "https://ok.example/");
  assert.equal(readMcpOutputSchema.safeParse(markdown.body).success, true, JSON.stringify(markdown.body));
  assert.equal(markdown.body.truncated, false);
  assert.equal(markdown.body.requestedUrl, "https://ok.example/");

  const readMissing = await paidGet(merchant.base, "/read", "https://404.example/");
  assert.equal(readMissing.body.status, 404);
  assert.equal(readMissing.body.sourceOk, false);

  assert.equal(facilitator.calls.verify, 11);
  assert.equal(facilitator.calls.settle, 11);
});
