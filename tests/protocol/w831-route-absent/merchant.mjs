import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";

import { ABSENT_ROUTE, DECLARED_PAID_ROUTE, SDS } from "./constants.mjs";
import { REPO_ROOT } from "./paths.mjs";

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

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function headerNames(response) {
  return [...response.headers.keys()].map((name) => name.toLowerCase());
}

async function startFakeFacilitator() {
  const calls = { settle: 0, supported: 0, verify: 0 };
  const server = createHttpServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      return send(200, {
        kinds: [{ network: SDS.network, scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, { isValid: true, payer: ACCOUNT.address });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(200, {
        success: true,
        payer: ACCOUNT.address,
        transaction: `0x${"3".repeat(64)}`,
        network: SDS.network,
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
      PUBLIC_URL: `https://${SDS.host}`,
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

function encodeSignature(accepted, paymentId) {
  const nonce = `0x${"5".repeat(64)}`;
  return Buffer.from(JSON.stringify({
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
}

export async function withMerchant(fn) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "w831-route-absent-"));
  const facilitator = await startFakeFacilitator();
  const merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  let advertised = null;

  const session = {
    dataDir,
    facilitator,
    host: SDS.host,
    network: SDS.network,
    origin: () => merchant.base,
    snapshot() {
      return { settle: facilitator.calls.settle, verify: facilitator.calls.verify };
    },
    async request(targetPath, { method = "GET", headers = {} } = {}) {
      return fetch(`${merchant.base}${targetPath}`, {
        method,
        headers: { host: SDS.host, ...headers },
        signal: AbortSignal.timeout(15_000),
      });
    },
    async recordAttempt(phase, targetPath, { method = "GET", headers = {}, fields = {} } = {}) {
      const before = session.snapshot();
      const response = await session.request(targetPath, { method, headers });
      const text = await response.text();
      const body = parseBody(text);
      const challenge = decodePaymentRequired(response);
      const after = session.snapshot();
      const names = headerNames(response);
      const accepted = (challenge?.accepts || []).find((item) => item.network === SDS.network && item.scheme === "exact");
      if (accepted && !advertised) {
        advertised = {
          offeredNetwork: accepted.network,
          accepted,
        };
      }
      const httpStatus = response.status;
      const paymentRequired = Boolean(challenge) || names.includes("payment-required");
      return {
        seq: undefined,
        phase,
        method,
        path: targetPath.split("?")[0],
        httpStatus,
        hasPaymentRequired: paymentRequired,
        hasPaymentResponse: Boolean(
          response.headers.get("payment-response")
          || response.headers.get("x-payment-response")
          || response.headers.get("payment-receipt"),
        ),
        charged: body && Object.hasOwn(body, "charged") ? body.charged : null,
        payable: httpStatus === 402 || paymentRequired,
        routeAbsent: httpStatus !== 402 && !paymentRequired && targetPath.split("?")[0] !== DECLARED_PAID_ROUTE,
        error: typeof body?.error === "string" ? body.error : null,
        offeredNetwork: accepted?.network ?? null,
        settleDelta: after.settle - before.settle,
        verifyDelta: after.verify - before.verify,
        paymentPresent: Boolean(headers["payment-signature"]),
        ...fields,
      };
    },
    async wellKnownRoutes() {
      const response = await session.request("/.well-known/x402");
      const body = parseBody(await response.text());
      const items = Array.isArray(body?.items) ? body.items : [];
      return items.map((item) => item?.resource?.routeTemplate).filter(Boolean);
    },
    async credential(paymentId) {
      if (!advertised) {
        const unpaid = await session.request(DECLARED_PAID_ROUTE);
        const challenge = decodePaymentRequired(unpaid);
        await unpaid.arrayBuffer();
        const accepted = (challenge?.accepts || []).find((item) => item.network === SDS.network && item.scheme === "exact");
        if (!accepted) throw new Error("declared paid route omitted Base exact terms");
        advertised = { offeredNetwork: accepted.network, accepted };
      }
      return {
        headers: { "payment-signature": encodeSignature(advertised.accepted, paymentId) },
        offeredNetwork: advertised.offeredNetwork,
        accepted: advertised.accepted,
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
    source: "loopback server.js + fake facilitator",
  };
}

export { ABSENT_ROUTE };
