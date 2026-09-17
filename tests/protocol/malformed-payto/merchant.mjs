import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";

import { HOST, NETWORK, REPO_ROOT, ROUTE } from "./paths.mjs";
import { classifyPayTo, facilitatorVerifyFromPayTo } from "./payto.mjs";

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

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve(null);
      }
    });
  });
}

function extractAuthorization(body) {
  if (!body || typeof body !== "object") return null;
  const payload = body.paymentPayload || body;
  const inner = payload.payload || payload;
  return inner.authorization || inner.payload?.authorization || null;
}

function extractQuotedPayTo(body) {
  const requirements = body?.paymentRequirements || body?.paymentPayload?.accepted;
  const list = Array.isArray(requirements) ? requirements : requirements ? [requirements] : [];
  return list[0]?.payTo ?? body?.paymentPayload?.accepted?.payTo ?? null;
}

function extractPayer(auth) {
  return typeof auth?.from === "string" ? auth.from : ACCOUNT.address;
}

async function startFakeFacilitator() {
  const calls = { settle: 0, supported: 0, verify: 0 };
  const state = {
    lastVerifyBody: null,
    lastVerifyResponse: null,
    lastSettleBody: null,
    lastAuthorization: null,
  };
  const server = createHttpServer(async (req, res) => {
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
      const body = await readJsonBody(req);
      state.lastVerifyBody = body;
      const auth = extractAuthorization(body);
      state.lastAuthorization = auth;
      const response = facilitatorVerifyFromPayTo({
        quoted: extractQuotedPayTo(body),
        authorizationTo: auth?.to,
        payer: extractPayer(auth),
      });
      state.lastVerifyResponse = response;
      return send(200, response);
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      const body = await readJsonBody(req);
      const auth = extractAuthorization(body);
      const check = facilitatorVerifyFromPayTo({
        quoted: extractQuotedPayTo(body),
        authorizationTo: auth?.to,
        payer: extractPayer(auth),
      });
      if (!check.isValid) {
        const response = {
          success: false,
          errorReason: check.invalidReason || classifyPayTo(auth?.to).status,
          transaction: "",
          network: NETWORK,
        };
        state.lastSettleBody = response;
        return send(200, response);
      }
      const response = {
        success: true,
        payer: extractPayer(auth),
        transaction: `0x${"3".repeat(64)}`,
        network: NETWORK,
      };
      state.lastSettleBody = response;
      return send(200, response);
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

function decodePaymentRequired(encoded) {
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export async function withMerchant(options, fn) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "malformed-payto-"));
  const facilitator = await startFakeFacilitator();
  let merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const session = {
    dataDir,
    facilitator,
    host: HOST,
    route: ROUTE,
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
      const challenge = decodePaymentRequired(response.headers.get("payment-required"));
      const accepted = Array.isArray(challenge?.accepts)
        ? challenge.accepts.find((item) => item.network === NETWORK && item.scheme === "exact")
        : null;
      const auth = extra.authorization
        || (headers["payment-signature"] ? facilitator.state.lastAuthorization : null);
      return {
        seq: undefined,
        phase,
        httpStatus: response.status,
        replay: response.headers.get("x-payment-replay"),
        hasPaymentResponse: Boolean(
          response.headers.get("payment-response")
          || response.headers.get("x-payment-response")
          || response.headers.get("payment-receipt"),
        ),
        charged: body && Object.hasOwn(body, "charged") ? body.charged : null,
        error: typeof body?.error === "string" ? body.error : (typeof challenge?.error === "string" ? challenge.error : null),
        settleDelta,
        verifyDelta: after.verify - before.verify,
        paymentPresent: Boolean(headers["payment-signature"]),
        payTo: extra.payTo ?? accepted?.payTo ?? extra.quotedPayTo ?? null,
        quotedPayTo: extra.quotedPayTo ?? accepted?.payTo ?? extra.payTo ?? null,
        acceptedPayTo: extra.acceptedPayTo ?? null,
        authorizationTo: extra.authorizationTo ?? auth?.to ?? null,
        invalidReason: after.verify > before.verify
          ? facilitator.state.lastVerifyResponse?.invalidReason ?? null
          : null,
        invalidMessage: after.verify > before.verify
          ? facilitator.state.lastVerifyResponse?.invalidMessage ?? null
          : null,
        verifyIsValid: after.verify > before.verify
          ? facilitator.state.lastVerifyResponse?.isValid ?? null
          : null,
        accepted: accepted || extra.accepted || null,
      };
    },
    async unpaidChallenge() {
      const attempt = await session.recordAttempt("unpaid");
      if (attempt.httpStatus !== 402) {
        throw new Error(`expected unpaid 402, got ${attempt.httpStatus}`);
      }
      if (!attempt.accepted) throw new Error("unpaid 402 omitted Base exact terms");
      return { attempt, accepted: attempt.accepted };
    },
    credential({
      paymentId,
      accepted,
      acceptedPayTo,
      authorizationTo,
    }) {
      const cloned = { ...accepted };
      if (acceptedPayTo !== undefined) cloned.payTo = acceptedPayTo;
      const to = authorizationTo !== undefined ? authorizationTo : cloned.payTo;
      const nonce = `0x${"5".repeat(64)}`;
      const header = Buffer.from(JSON.stringify({
        x402Version: 2,
        accepted: cloned,
        payload: {
          signature: `0x${"4".repeat(130)}`,
          authorization: {
            from: ACCOUNT.address,
            to,
            value: cloned.amount,
            validAfter: "0",
            validBefore: String(Math.floor(Date.now() / 1000) + 300),
            nonce,
          },
        },
        extensions: { "payment-identifier": { info: { required: false, id: paymentId } } },
      })).toString("base64");
      return {
        headers: { "payment-signature": header },
        authorization: {
          from: ACCOUNT.address,
          to,
          value: cloned.amount,
          validAfter: "0",
          validBefore: String(Math.floor(Date.now() / 1000) + 300),
          nonce,
        },
        acceptedPayTo: cloned.payTo,
        authorizationTo: to,
        quotedPayTo: accepted.payTo,
        paymentIdentity: {
          id: paymentId,
          payer: ACCOUNT.address,
          nonce,
          amount: cloned.amount,
          payTo: cloned.payTo,
          network: cloned.network,
          asset: cloned.asset,
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
    facilitatorUrl: session.facilitator.url,
    source: "loopback server.js + payTo-aware fake facilitator",
  };
}
