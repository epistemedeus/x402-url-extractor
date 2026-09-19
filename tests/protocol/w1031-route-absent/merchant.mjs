import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ABSENT_PROBES, PRESENT_CONTROL, SDS } from "./constants.mjs";
import { REPO_ROOT } from "./paths.mjs";

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
  if (child.exitCode === null && child.signalCode !== null) return;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
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
        kinds: [{ network: SDS.network, scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(500, { error: "w1031-route-absent must not verify" });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(500, { error: "w1031-route-absent must not settle" });
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
      PUBLIC_URL: SDS.origin,
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      EXTRACT_BATCH_ENABLED: "0",
      LOCKFILE_PIN_DELTA_ENABLED: "0",
      MPP_SECRET_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 25_000);
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

function headerObservation(response) {
  const headers = {};
  const headerNames = [];
  for (const [key, value] of response.headers.entries()) {
    const name = String(key).toLowerCase();
    headerNames.push(name);
    headers[name] = value;
  }
  return {
    headers,
    headerNames,
    hasPaymentRequiredHeader: headerNames.includes("payment-required"),
  };
}

async function observe(base, { method, path, headers = {}, body, paymentSignatureSent = false }) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return {
    request: { method, path, paymentSignatureSent },
    observation: {
      httpStatus: response.status,
      method,
      path,
      contentType: response.headers.get("content-type"),
      ...headerObservation(response),
      body: parsed,
      text: text.slice(0, 400),
    },
  };
}

function fakePaymentSignature() {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: SDS.network,
      amount: SDS.amountAtomic,
      asset: SDS.asset,
      payTo: SDS.payTo,
    },
    payload: {
      signature: `0x${"4".repeat(130)}`,
      authorization: {
        from: `0x${"2".repeat(40)}`,
        to: SDS.payTo,
        value: SDS.amountAtomic,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"5".repeat(64)}`,
      },
    },
  })).toString("base64");
}

export async function withMerchant(fn) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "w1031-route-absent-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  try {
    merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
    const session = {
      origin: merchant.base,
      calls: facilitator.calls,
      snapshot: () => ({ ...facilitator.calls }),
      observe: (spec) => observe(merchant.base, spec),
    };
    return await fn(session);
  } finally {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

export async function probeColdSurface(session) {
  const presentHit = await session.observe({
    method: PRESENT_CONTROL.method,
    path: PRESENT_CONTROL.path,
  });
  const absentHits = [];
  for (const probe of ABSENT_PROBES) {
    const headers = probe.method === "POST" ? { "content-type": "application/json" } : {};
    const body = probe.method === "POST" ? JSON.stringify({ urls: ["https://example.com/"] }) : undefined;
    absentHits.push({
      probe,
      ...(await session.observe({ method: probe.method, path: probe.path, headers, body })),
    });
  }
  const invented = ABSENT_PROBES.find((probe) => probe.id === "invented");
  const signatureHit = await session.observe({
    method: invented.method,
    path: invented.path,
    headers: { "PAYMENT-SIGNATURE": fakePaymentSignature() },
    paymentSignatureSent: true,
  });
  const x402 = await fetch(`${session.origin}/.well-known/x402`, { signal: AbortSignal.timeout(8_000) });
  const actions = await fetch(`${session.origin}/api/actions`, { signal: AbortSignal.timeout(8_000) });
  const catalogJson = await x402.json();
  const actionsJson = await actions.json();
  return {
    presentHit,
    absentHits,
    signatureHit,
    catalog: {
      items: catalogJson.items || [],
      actions: actionsJson.actions || [],
    },
    counters: session.snapshot(),
    origin: session.origin,
  };
}
