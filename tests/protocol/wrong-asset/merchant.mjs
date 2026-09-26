import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";

import { HOST, NETWORK, REPO_ROOT, ROUTE } from "./paths.mjs";

const ACCOUNT = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const MPP_SECRET = "test-secret-key-test-secret-key-32";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

/**
 * Permissive loopback facilitator: verify and settle always succeed if called.
 * Wrong-asset must never reach /settle even though this facilitator would settle.
 */
async function startFakeFacilitator() {
  const calls = { settle: 0, supported: 0, verify: 0 };
  const state = { lastSettleBody: null, lastVerifyAccepted: null };
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
    const readJson = (callback) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { body = null; }
        callback(body);
      });
    };
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return readJson((body) => {
        state.lastVerifyAccepted = body?.paymentPayload?.accepted || body?.accepted || null;
        send(200, { isValid: true, payer: ACCOUNT.address });
      });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return readJson((body) => {
        state.lastSettleBody = {
          success: true,
          transaction: `0x${"3".repeat(64)}`,
          accepted: body?.paymentPayload?.accepted || body?.accepted || null,
        };
        send(200, {
          success: true,
          payer: ACCOUNT.address,
          transaction: `0x${"3".repeat(64)}`,
          network: NETWORK,
        });
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
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startMerchant({ dataDir, facilitatorUrl }) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `https://${HOST}`,
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      EXTRACT_BATCH_ENABLED: "0",
      LOCKFILE_PIN_DELTA_ENABLED: "0",
      IDEMPOTENCY_INFLIGHT_WAIT_MS: "50",
      MPP_SECRET_KEY: MPP_SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
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
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  await listening;
  return { base: `http://127.0.0.1:${port}`, child, port, output: () => output };
}

function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  if (!encoded) return null;
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

export async function withMerchant(fn) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "wrong-asset-"));
  const facilitator = await startFakeFacilitator();
  const merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const session = {
    dataDir,
    facilitator,
    host: HOST,
    route: ROUTE,
    advertised: null,
    origin: () => merchant.base,
    snapshot() {
      return { settle: facilitator.calls.settle, verify: facilitator.calls.verify };
    },
    async request(headers = {}) {
      return fetch(`${merchant.base}${ROUTE}`, {
        headers: { host: HOST, ...headers },
        signal: AbortSignal.timeout(15_000),
      });
    },
    async recordAttempt(phase, headers = {}, extra = {}) {
      const before = session.snapshot();
      const response = await session.request(headers);
      const text = await response.text();
      const body = parseBody(text);
      const after = session.snapshot();
      const settleDelta = after.settle - before.settle;
      return {
        seq: undefined,
        phase,
        httpStatus: response.status,
        replay: response.headers.get("x-payment-replay"),
        idempotency: response.headers.get("x-payment-idempotency"),
        hasPaymentResponse: Boolean(
          response.headers.get("payment-response")
          || response.headers.get("x-payment-response")
          || response.headers.get("payment-receipt"),
        ),
        charged: body && Object.hasOwn(body, "charged") ? body.charged : null,
        error: typeof body?.error === "string"
          ? body.error
          : typeof body?.invalidReason === "string"
            ? body.invalidReason
            : null,
        settleDelta,
        verifyDelta: after.verify - before.verify,
        transaction: typeof facilitator.state.lastSettleBody?.transaction === "string" && settleDelta > 0
          ? facilitator.state.lastSettleBody.transaction
          : null,
        paymentPresent: Boolean(headers["payment-signature"]),
        ...extra,
      };
    },
    async challenge() {
      const preview = await session.request();
      if (preview.status !== 402) {
        throw new Error(`expected unpaid 402, got ${preview.status}`);
      }
      const challenge = decodePaymentRequired(preview);
      if (!challenge) throw new Error("unpaid 402 omitted PAYMENT-REQUIRED");
      await preview.text();
      const accepted = (challenge.accepts || []).find((item) => item.network === NETWORK && item.scheme === "exact");
      if (!accepted) throw new Error("unpaid 402 omitted Base exact terms");
      session.advertised = accepted;
      return { challenge, accepted };
    },
    async credential(paymentId, mutateAccepted = null) {
      const { accepted: advertised } = session.advertised
        ? { accepted: session.advertised }
        : await session.challenge();
      const accepted = structuredClone(advertised);
      if (mutateAccepted) mutateAccepted(accepted);
      const nonce = `0x${randomBytes(32).toString("hex")}`;
      const header = Buffer.from(JSON.stringify({
        x402Version: 2,
        accepted,
        payload: {
          signature: `0x${"4".repeat(130)}`,
          authorization: {
            from: ACCOUNT.address,
            to: accepted.payTo,
            value: accepted.amount,
            validAfter: "0",
            validBefore: String(Math.floor(Date.now() / 1000) + 300),
            nonce,
          },
        },
        extensions: { "payment-identifier": { info: { required: false, id: paymentId } } },
      })).toString("base64");
      return {
        headers: { "payment-signature": header },
        advertised,
        accepted,
        paymentIdentity: {
          id: paymentId,
          payer: ACCOUNT.address,
          nonce,
          amount: accepted.amount,
          payTo: accepted.payTo,
          network: accepted.network,
          asset: accepted.asset,
          extra: accepted.extra ? { name: accepted.extra.name, version: accepted.extra.version } : null,
          advertisedExtra: advertised.extra
            ? { name: advertised.extra.name, version: advertised.extra.version }
            : null,
        },
      };
    },
  };

  try {
    return await fn(session);
  } finally {
    await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

export function numberAttempts(attempts) {
  return attempts.map((attempt, index) => ({ ...attempt, seq: index + 1 }));
}

export function traceBoundary(session) {
  return {
    paymentSent: false,
    liveFacilitator: false,
    checkoutMutated: false,
    published: false,
    neoTouched: false,
    facilitatorUrl: session.facilitator.url,
    source: "loopback server.js + permissive fake facilitator",
  };
}
