/**
 * Caller journey against an owned loopback merchant.
 *
 * Uses runAuthorizedPurchase and reportCallerResult. The paid response token
 * comes from server.js. The feedback post is served by the mounted
 * /commerce/caller-result-feedback handler. Settlement rows are written by
 * createCommerceSettlementReconciler. The receipt client is in-process and
 * synthetic: there is no chain transfer, production signer, model call, or
 * public-host feedback post.
 *
 * The cold fixture recipe still invents a token and accepts its own post.
 * This recipe is the one that receives server authority and prospective binding.
 *
 * From examples/customer-x402, after npm ci, with the merchant install at the
 * repository root:
 *   node recipes/caller-result-feedback-loopback.mjs
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbiItem } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  BASE_USDC,
  createCommerceSettlementReconciler,
} from "../../../commerce-settlement-reconciler.mjs";
import {
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_PATH,
  CALLER_RESULT_FEEDBACK_ROTATED_FILENAME,
  CALLER_RESULT_FEEDBACK_TTL_MS,
  createCallerResultFeedbackService,
  issueCallerResultFeedbackToken,
} from "../../../caller-result-feedback.mjs";
import { PAID_EVIDENCE_FILENAME } from "../../../http-delivery-evidence/historical.mjs";
import { VALIDATION_FILENAME } from "../../../http-delivery-evidence/store.mjs";
import { PROSPECTIVE_FILENAME } from "../../../commerce-prospective-delivery.mjs";
import { normalizeAuthorization } from "../src/authorization.mjs";
import {
  bindCallerResultFeedback,
  reportCallerResult,
} from "../src/caller-result.mjs";
import { DEFAULT_AUTHORIZATION, LIVE_ORIGIN, LIVE_RECIPIENT } from "../src/constants.mjs";
import { runAuthorizedPurchase } from "../src/purchase.mjs";
import { bindGetExtractResourceUrl } from "../src/request-construction.mjs";
import { safeJson } from "../src/redact.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, "..");
const MERCHANT = path.join(PKG, "..", "..");
const NETWORK = "eip155:8453";
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const PURCHASES = 5;

const state = {
  merchant: null,
  facilitator: null,
  dataDir: "",
  feedbackKey: "",
  tokens: [],
};

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

async function startFacilitator(payer) {
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
      return send(200, { isValid: true, payer });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(200, {
        success: true,
        payer,
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
    calls,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startMerchant({ dataDir, facilitatorUrl, feedbackKey, actorSecret }) {
  const preloadPath = path.join(dataDir, "feedback-fetch-hook.mjs");
  await writeFile(preloadPath, `
const html = (title) => "<html><head><title>" + title + "</title></head><body><p>" + title + " page</p></body></html>";
const page = (title) => {
  const bytes = new TextEncoder().encode(html(title));
  let delivered = false;
  return {
    status: 200,
    url: "https://fixture.example/" + title,
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
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  const titles = {
    "https://ok.example/": "OK",
    "https://other.example/": "Other",
    "https://third.example/": "Third",
  };
  if (!titles[url]) throw Object.assign(new Error("unmapped extract fixture"), { code: "fetch_error" });
  return page(titles[url]);
};
`, "utf8");
  const port = await unusedPort();
  const existingNodeOptions = String(process.env.NODE_OPTIONS || "").trim();
  let output = "";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: MERCHANT,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      COMMERCE_ACTOR_SECRET: actorSecret,
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: LIVE_ORIGIN,
      HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS: "simulated",
      CALLER_RESULT_FEEDBACK_KEY: feedbackKey,
      NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const onData = (chunk) => {
    output = `${output}${chunk}`.slice(-80_000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const ready = () => output.includes(`x402-merchant listening on :${port}`);
    const finish = () => {
      if (!ready()) return;
      clearTimeout(timer);
      resolve();
    };
    finish();
    child.stdout.on("data", finish);
    child.stderr.on("data", finish);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited: ${code}/${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
  });
  return {
    base: `http://127.0.0.1:${port}`,
    child,
    output: () => output,
  };
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

function proxyToMerchant(merchantBase, book) {
  const origin = new URL(merchantBase);
  return async (input, init) => {
    const request = input instanceof Request && init == null ? input : new Request(input, init);
    const publicUrl = new URL(request.url);
    book.seen.push(publicUrl.href);
    if (publicUrl.origin !== LIVE_ORIGIN) {
      throw new Error(`unexpected public client target: ${publicUrl.origin}`);
    }
    if (publicUrl.hostname === "evil.example") book.evilFollowed = true;
    const paidHeader = request.headers.has("payment-signature") || request.headers.has("PAYMENT-SIGNATURE");
    if (publicUrl.pathname === CALLER_RESULT_FEEDBACK_PATH) {
      book.feedbackPosts.push({
        url: publicUrl.href,
        search: publicUrl.search,
        paidHeader,
        method: request.method,
      });
    } else if (paidHeader) {
      book.paidSends += 1;
    }
    const body = ["GET", "HEAD"].includes(request.method) ? null : Buffer.from(await request.arrayBuffer());
    const headers = Object.fromEntries(request.headers.entries());
    headers.host = publicUrl.host;
    headers["x-forwarded-host"] = publicUrl.host;
    headers["x-forwarded-proto"] = "https";
    if (body) headers["content-length"] = String(body.length);
    const response = await new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: origin.hostname,
        port: origin.port,
        path: `${publicUrl.pathname}${publicUrl.search}`,
        method: request.method,
        headers,
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value == null) continue;
            if (Array.isArray(value)) value.forEach((entry) => responseHeaders.append(name, entry));
            else responseHeaders.set(name, value);
          }
          if (responseHeaders.has(CALLER_RESULT_FEEDBACK_HEADER)) {
            const token = responseHeaders.get(CALLER_RESULT_FEEDBACK_HEADER);
            if (token) state.tokens.push(token);
            responseHeaders.append("link", `<https://evil.example${CALLER_RESULT_FEEDBACK_PATH}>; rel="caller-result-feedback"`);
          }
          resolve(new Response(Buffer.concat(chunks), {
            status: res.statusCode || 500,
            headers: responseHeaders,
          }));
        });
      });
      req.on("error", reject);
      req.setTimeout(20_000, () => req.destroy(new Error("local merchant request timed out")));
      if (body) req.write(body);
      req.end();
    });
    return response;
  };
}

function freshBook() {
  return { seen: [], feedbackPosts: [], paidSends: 0, evilFollowed: false };
}

function receiptClient(payer, amount) {
  return {
    async getTransactionReceipt() {
      return {
        status: "success",
        blockNumber: 1n,
        logs: [{
          address: getAddress(BASE_USDC),
          topics: encodeEventTopics({
            abi: [TRANSFER],
            eventName: "Transfer",
            args: { from: getAddress(payer), to: getAddress(LIVE_RECIPIENT) },
          }),
          data: encodeAbiParameters([{ type: "uint256" }], [amount]),
        }],
      };
    },
    async getBlock() {
      return { timestamp: BigInt(Math.floor(Date.now() / 1000)) };
    },
  };
}

async function waitForRows(file, minCount, label) {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const text = await readFile(file, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
    const rows = text.split("\n").filter((line) => line.trim().length > 0);
    if (rows.length >= minCount) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${minCount} ${label}`);
}

async function waitForPaidEvents(file, minCount) {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const text = await readFile(file, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
    const rows = text.split("\n").filter((line) => line.trim().length > 0).flatMap((line) => {
      try {
        const row = JSON.parse(line);
        return row?.result === "paid_success" ? [row] : [];
      } catch {
        return [];
      }
    });
    if (rows.length >= minCount) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${minCount} paid commerce events`);
}

function coldRead(dataDir) {
  const run = spawnSync(process.execPath, [
    path.join(MERCHANT, "commerce-prospective-delivery-cold.mjs"),
    dataDir,
  ], { cwd: MERCHANT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

function publicSlice(packet) {
  return {
    decision: packet.decision,
    comparable: packet.comparable,
    usefulness: packet.usefulness,
    technical: packet.technical,
    declaredFeedback: packet.declaredFeedback,
    declaredTaskClass: packet.declaredTaskClass,
    technicalRevisions: packet.technicalRevisions,
    amountAtomic: packet.bindsToParent?.amountAtomic ?? null,
    reconciledSettlements: packet.bindsToParent?.reconciledSettlements ?? null,
    historicalBackfill: packet.coverage?.historicalBackfill ?? null,
    historicalComplete: packet.coverage?.historicalComplete ?? null,
    customerAttribution: packet.customerAttribution,
    recognizedIncomeAtomic: packet.recognizedIncomeAtomic,
    technicalValidationIsNotUsefulness: packet.boundaries?.technicalValidationIsNotUsefulness ?? null,
  };
}

function bearerClaims(token) {
  const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  return {
    channel: payload.c,
    method: payload.m,
    route: payload.r,
    expiresAtMs: payload.x,
  };
}

function reportView(report) {
  return {
    accepted: report.accepted === true,
    idempotentReplay: report.idempotentReplay === true,
    disposition: report.disposition ?? null,
    reasonCategory: report.reasonCategory ?? null,
    usefulness: report.usefulness ?? null,
    charged: report.charged === true,
    payerIdentity: report.payerIdentity === true,
    code: report.code ?? null,
    retainedDisposition: report.retainedDisposition ?? null,
    deliveryPreserved: report.deliveryPreserved === true,
    repurchaseAuthorized: report.repurchaseAuthorized === true,
    paymentAttempted: report.paymentAttempted === true,
    taskSubmitted: report.taskSubmitted === true,
  };
}

async function purchaseOne({ account, fetchImpl, target }) {
  const result = await runAuthorizedPurchase({
    authorization: normalizeAuthorization({
      ...DEFAULT_AUTHORIZATION,
      url: bindGetExtractResourceUrl(target),
    }),
    account,
    fetchImpl,
    approve: true,
    timeoutMs: 20_000,
  });
  if (result.outcome !== "valid_delivered") {
    throw new Error(`purchase outcome ${result.outcome}: ${result.evidence?.outputReason || result.message || "unavailable"}`);
  }
  if (result.callerResultFeedback?.available !== true) {
    throw new Error(`server capability was not received: ${result.callerResultFeedback?.reason || "missing"}`);
  }
  return result;
}

async function cleanup() {
  await stopChild(state.merchant?.child);
  state.merchant = null;
  if (state.facilitator) await state.facilitator.close();
  state.facilitator = null;
  if (state.dataDir) await rm(state.dataDir, { recursive: true, force: true });
}

try {
  const account = privateKeyToAccount(generatePrivateKey());
  const feedbackKey = randomBytes(32).toString("hex");
  const actorSecret = randomBytes(32).toString("hex");
  state.feedbackKey = feedbackKey;
  state.dataDir = await mkdtemp(path.join(tmpdir(), "caller-loopback-"));
  state.facilitator = await startFacilitator(account.address);
  state.merchant = await startMerchant({
    dataDir: state.dataDir,
    facilitatorUrl: state.facilitator.url,
    feedbackKey,
    actorSecret,
  });
  const book = freshBook();
  const fetchImpl = proxyToMerchant(state.merchant.base, book);
  const targets = [
    "https://ok.example/",
    "https://other.example/",
    "https://third.example/",
    "https://ok.example/",
    "https://other.example/",
  ];
  const bought = [];
  for (const target of targets) {
    bought.push(await purchaseOne({ account, fetchImpl, target }));
  }
  assert.equal(state.facilitator.calls.settle, PURCHASES);
  assert.equal(book.feedbackPosts.length, 0);
  assert.equal(book.paidSends, PURCHASES);
  assert.equal(book.evilFollowed, false);
  assert.equal(book.seen.some((url) => url.includes("evil.example")), false);
  for (const result of bought) {
    assert.equal(result.evidence.outputValid, true);
    assert.equal(result.evidence.outputDelivery, "useful");
    assert.notEqual(result.evidence.task?.satisfied, true);
    assert.equal(result.callerResultFeedback.automatic, false);
    assert.equal(result.callerResultFeedback.usefulness, "unknown");
    assert.equal(result.callerResultFeedback.charged, false);
    assert.equal(result.paymentSent, true);
    assert.equal(safeJson(result).includes(state.tokens.at(-1)), false);
  }
  assert.equal(state.tokens.length, PURCHASES);
  const presented = bought.map((_result, index) => {
    const token = state.tokens[index];
    assert.equal(typeof token, "string");
    const claims = bearerClaims(token);
    assert.equal(claims.channel, "http");
    assert.equal(claims.method, "GET");
    assert.equal(claims.route, "/extract");
    assert.equal(claims.expiresAtMs > Date.now(), true);
    return claims;
  });

  await waitForRows(path.join(state.dataDir, PAID_EVIDENCE_FILENAME), PURCHASES, "paid evidence");
  await waitForRows(path.join(state.dataDir, VALIDATION_FILENAME), PURCHASES, "validation");
  await waitForPaidEvents(path.join(state.dataDir, "commerce-events.ndjson"), PURCHASES);
  const paidEvents = await waitForPaidEvents(path.join(state.dataDir, "commerce-events.ndjson"), PURCHASES);
  const amountText = paidEvents.find((row) => /^\d+$/.test(String(row.settlementAmountAtomic || "")))?.settlementAmountAtomic || "5000";
  assert.equal(amountText, "5000");

  await stopChild(state.merchant.child);
  state.merchant = null;
  const validationPath = path.join(state.dataDir, VALIDATION_FILENAME);
  const parkedPath = `${validationPath}.parked`;
  await rename(validationPath, parkedPath);
  const reconciler = createCommerceSettlementReconciler({
    actorSecret,
    client: receiptClient(account.address, BigInt(amountText)),
    dataDir: state.dataDir,
    settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
    treasury: LIVE_RECIPIENT,
  });
  const settled = await reconciler.reconcile();
  assert.equal(settled.ledger.reconciledSettlements, PURCHASES, JSON.stringify(settled.issues));
  assert.equal(settled.ledger.amountAtomic, String(PURCHASES * 5000));
  const beforeResponse = coldRead(state.dataDir);
  assert.equal(beforeResponse.technical.unknown, PURCHASES);
  assert.equal(beforeResponse.technical.validated_response, 0);
  assert.equal(beforeResponse.declaredFeedback.absent, PURCHASES);
  assert.equal(beforeResponse.technicalRevisions, 0);
  assert.equal(beforeResponse.usefulness, "unknown");

  await rename(parkedPath, validationPath);
  const responded = await reconciler.reconcile();
  assert.equal(responded.ledger.reconciledSettlements, PURCHASES);
  assert.equal(responded.ledger.amountAtomic, String(PURCHASES * 5000));
  const afterResponse = coldRead(state.dataDir);
  assert.equal(afterResponse.technical.validated_response, PURCHASES);
  assert.equal(afterResponse.technical.unknown, 0);
  assert.equal(afterResponse.declaredFeedback.absent, PURCHASES);
  assert.equal(afterResponse.declaredFeedback.declared_useful, 0);
  assert.equal(afterResponse.technicalRevisions, PURCHASES);
  assert.equal(afterResponse.usefulness, "unknown");

  state.merchant = await startMerchant({
    dataDir: state.dataDir,
    facilitatorUrl: state.facilitator.url,
    feedbackKey,
    actorSecret,
  });
  const live = freshBook();
  const liveFetch = proxyToMerchant(state.merchant.base, live);
  const postsBeforeExplicitReport = live.feedbackPosts.length;
  const seeded = await reportCallerResult(bought[0], { disposition: "useful_delivered" }, { fetchImpl: liveFetch });
  assert.equal(seeded.code, "disposition_rejected");
  assert.equal(live.feedbackPosts.length, 0);

  const useful = await reportCallerResult(bought[0], {
    disposition: "useful",
    reasonCategory: "matched_task",
  }, { fetchImpl: liveFetch });
  assert.equal(useful.accepted, true);
  assert.equal(useful.disposition, "useful");
  assert.equal(useful.usefulness, "unknown");
  assert.equal(useful.idempotentReplay, false);
  assert.equal(useful.paymentAttempted, false);
  assert.equal(useful.taskSubmitted, false);
  assert.equal(bought[0].outcome, "valid_delivered");

  const duplicate = await reportCallerResult(bought[0], {
    disposition: "useful",
    reasonCategory: "matched_task",
  }, { fetchImpl: liveFetch });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.idempotentReplay, true);
  assert.equal(duplicate.paymentAttempted, false);

  const conflict = await reportCallerResult(bought[0], {
    disposition: "not_useful",
    reasonCategory: "wrong_output",
  }, { fetchImpl: liveFetch });
  assert.equal(conflict.code, "conflicting_statement");
  assert.equal(conflict.accepted, false);
  assert.equal(conflict.retainedDisposition, "useful");
  assert.equal(conflict.repurchaseAuthorized, false);
  assert.equal(bought[0].paymentSent, true);

  const notUseful = await reportCallerResult(bought[1], {
    disposition: "not_useful",
    reasonCategory: "missing_field",
  }, { fetchImpl: liveFetch });
  assert.equal(notUseful.accepted, true);
  assert.equal(notUseful.disposition, "not_useful");
  assert.equal(notUseful.usefulness, "unknown");
  assert.equal(notUseful.taskSubmitted, false);

  const paidPath = path.join(state.dataDir, PAID_EVIDENCE_FILENAME);
  const originalPaid = await readFile(paidPath, "utf8");
  try {
    const lines = originalPaid.trim().split("\n").map((line) => JSON.parse(line));
    for (const row of lines) row.route = "/read";
    await writeFile(paidPath, `${lines.map((row) => JSON.stringify(row)).join("\n")}\n`);
    const mismatch = await reportCallerResult(bought[0], {
      disposition: "useful",
      reasonCategory: "matched_task",
    }, { fetchImpl: liveFetch });
    assert.equal(mismatch.code, "route_mismatch");
    assert.equal(mismatch.paymentAttempted, false);
    assert.equal(bought[0].outcome, "valid_delivered");
  } finally {
    await writeFile(paidPath, originalPaid);
  }
  const restored = await reportCallerResult(bought[0], {
    disposition: "useful",
    reasonCategory: "matched_task",
  }, { fetchImpl: liveFetch });
  assert.equal(restored.accepted, true);
  assert.equal(restored.idempotentReplay, true);

  const foreignToken = issueCallerResultFeedbackToken({
    key: feedbackKey,
    eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    method: "GET",
    route: "/extract",
    requestDigest: "1".repeat(64),
    responseDigest: "2".repeat(64),
  });
  assert.equal(typeof foreignToken, "string");
  state.tokens.push(foreignToken);
  const foreignResult = {};
  bindCallerResultFeedback(foreignResult, {
    response: new Response("{}", {
      status: 200,
      headers: { [CALLER_RESULT_FEEDBACK_HEADER]: foreignToken },
    }),
    resourceUrl: bindGetExtractResourceUrl("https://ok.example/"),
  });
  assert.equal(foreignResult.callerResultFeedback.available, true);
  const foreign = await reportCallerResult(foreignResult, { disposition: "useful" }, { fetchImpl: liveFetch });
  assert.equal(foreign.code, "missing_capture");
  assert.equal(foreign.accepted, false);
  assert.equal(foreign.paymentAttempted, false);

  const expiredToken = issueCallerResultFeedbackToken({
    key: feedbackKey,
    eventId: randomUUID(),
    method: "GET",
    route: "/extract",
    requestDigest: "3".repeat(64),
    responseDigest: "4".repeat(64),
    now: Date.now() - CALLER_RESULT_FEEDBACK_TTL_MS - 5_000,
  });
  assert.equal(typeof expiredToken, "string");
  state.tokens.push(expiredToken);
  const expiredResult = {};
  bindCallerResultFeedback(expiredResult, {
    response: new Response("{}", {
      status: 200,
      headers: { [CALLER_RESULT_FEEDBACK_HEADER]: expiredToken },
    }),
    resourceUrl: bindGetExtractResourceUrl("https://ok.example/"),
  });
  const expired = await reportCallerResult(expiredResult, { disposition: "not_useful" }, { fetchImpl: liveFetch });
  assert.equal(expired.code, "expired_capability");
  assert.equal(expired.accepted, false);
  assert.equal(expired.deliveryPreserved, true);
  assert.equal(expired.repurchaseAuthorized, false);

  const failed = await reportCallerResult(bought[3], { disposition: "useful" }, {
    fetchImpl: async () => {
      throw new Error("socket hang up");
    },
  });
  assert.equal(failed.code, "transport_failed");
  assert.equal(failed.accepted, false);
  assert.equal(failed.paymentAttempted, false);
  assert.equal(bought[3].outcome, "valid_delivered");
  assert.equal(bought[3].paymentSent, true);
  assert.equal(state.facilitator.calls.settle, PURCHASES);
  assert.equal(live.feedbackPosts.every((post) => post.paidHeader === false), true);
  assert.equal(live.feedbackPosts.every((post) => post.search === ""), true);
  assert.equal(live.feedbackPosts.every((post) => post.url === `${LIVE_ORIGIN}${CALLER_RESULT_FEEDBACK_PATH}`), true);
  assert.equal(live.seen.some((url) => url.includes("evil.example")), false);
  assert.equal(live.paidSends, 0);

  await stopChild(state.merchant.child);
  state.merchant = null;
  const feedbackPath = path.join(state.dataDir, "caller-result-feedback.ndjson");
  const beforeRotation = await stat(feedbackPath);
  assert.equal(beforeRotation.size >= 256, true);
  const rotating = createCallerResultFeedbackService({
    dataDir: state.dataDir,
    key: feedbackKey,
    maxFileBytes: beforeRotation.size,
  });
  const rotationBook = freshBook();
  const rotationFetch = async (input, init) => {
    const request = input instanceof Request && init == null ? input : new Request(input, init);
    const url = new URL(request.url);
    rotationBook.seen.push(url.href);
    if (url.origin !== LIVE_ORIGIN || url.pathname !== CALLER_RESULT_FEEDBACK_PATH) {
      throw new Error(`rotation transport refused ${url.origin}${url.pathname}`);
    }
    const raw = await request.text();
    const posted = await rotating.submit({
      token: request.headers.get(CALLER_RESULT_FEEDBACK_HEADER) || "",
      body: JSON.parse(raw),
      rawBody: raw,
      query: {},
    });
    rotationBook.feedbackPosts.push({
      url: url.href,
      search: url.search,
      paidHeader: request.headers.has("payment-signature"),
      method: request.method,
    });
    return new Response(JSON.stringify(posted.body), {
      status: posted.statusCode,
      headers: { "content-type": "application/json" },
    });
  };
  const rotatedReport = await reportCallerResult(bought[4], {
    disposition: "useful",
    reasonCategory: "saved_a_step",
  }, { fetchImpl: rotationFetch });
  assert.equal(rotatedReport.accepted, true);
  assert.equal(rotatedReport.idempotentReplay, false);
  assert.equal(rotatedReport.usefulness, "unknown");
  const rotatedPath = path.join(state.dataDir, CALLER_RESULT_FEEDBACK_ROTATED_FILENAME);
  const rotatedInfo = await stat(rotatedPath);
  const currentInfo = await stat(feedbackPath);
  assert.equal(rotatedInfo.isFile(), true);
  assert.equal(currentInfo.size > 0, true);
  assert.equal(currentInfo.size < rotatedInfo.size, true);

  state.merchant = await startMerchant({
    dataDir: state.dataDir,
    facilitatorUrl: state.facilitator.url,
    feedbackKey,
    actorSecret,
  });
  const restarted = freshBook();
  const restartedFetch = proxyToMerchant(state.merchant.base, restarted);
  const replay = await reportCallerResult(bought[0], {
    disposition: "useful",
    reasonCategory: "matched_task",
  }, { fetchImpl: restartedFetch });
  assert.equal(replay.accepted, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.paymentAttempted, false);
  assert.equal(state.facilitator.calls.settle, PURCHASES);
  assert.equal(restarted.paidSends, 0);
  const merchantOutput = state.merchant.output();
  assert.equal(merchantOutput.includes(feedbackKey), false);
  assert.equal(state.tokens.some((token) => merchantOutput.includes(token)), false);

  await stopChild(state.merchant.child);
  state.merchant = null;
  const fresh = coldRead(state.dataDir);
  assert.equal(fresh.decision, "prospective");
  assert.equal(fresh.comparable, true);
  assert.equal(fresh.usefulness, "unknown");
  assert.equal(fresh.technical.validated_response, PURCHASES);
  assert.equal(fresh.declaredFeedback.declared_useful, 2);
  assert.equal(fresh.declaredFeedback.declared_not_useful, 1);
  assert.equal(fresh.declaredFeedback.absent, 2);
  assert.equal(fresh.declaredFeedback.rejected, 0);
  assert.equal(fresh.declaredTaskClass.absent, PURCHASES);
  assert.equal(fresh.technicalRevisions, PURCHASES);
  assert.equal(fresh.coverage.historicalBackfill, false);
  assert.equal(fresh.coverage.historicalComplete, false);
  assert.equal(fresh.bindsToParent.amountAtomic, String(PURCHASES * 5000));
  assert.equal(fresh.bindsToParent.reconciledSettlements, PURCHASES);
  assert.equal(fresh.customerAttribution, null);
  assert.equal(fresh.recognizedIncomeAtomic, null);
  assert.equal(fresh.boundaries.technicalValidationIsNotUsefulness, true);
  const rawProspective = await readFile(path.join(state.dataDir, PROSPECTIVE_FILENAME), "utf8");
  const rawFeedback = `${await readFile(rotatedPath, "utf8")}\n${await readFile(feedbackPath, "utf8")}`;
  for (const token of state.tokens) {
    assert.equal(rawProspective.includes(token), false);
    assert.equal(rawFeedback.includes(token), false);
  }
  assert.equal(rawProspective.includes(feedbackKey), false);
  assert.equal(rawFeedback.includes(feedbackKey), false);
  assert.equal(rawProspective.includes("https://"), false);
  assert.equal(rawProspective.includes("http://"), false);

  const summary = {
    recipe: "caller-result-feedback-loopback",
    productionPayment: false,
    productionHost: false,
    chainTransfer: false,
    productionSigner: false,
    llm: false,
    accountFile: false,
    host: "loopback",
    fixtureScope: "owned loopback server.js, fake facilitator, in-process synthetic receipt, fixture HTML pages",
    hostedSource: "not contacted; public aggregate not rewritten",
    purchases: PURCHASES,
    outcomes: bought.map((result) => result.outcome),
    outputValid: bought.map((result) => result.evidence.outputValid),
    technicalDelivery: bought.map((result) => result.evidence.outputDelivery),
    taskSatisfied: bought.map((result) => result.evidence.task?.satisfied === true),
    postsBeforeExplicitReport,
    paymentSends: book.paidSends,
    paymentSendsAfterReports: state.facilitator.calls.settle,
    capabilityAvailable: bought.length,
    bearerMatchedPaidCapture: presented.every((claims) => claims.method === "GET" && claims.route === "/extract"),
    clockStillOpenAtReport: true,
    seededFailure: reportView(seeded),
    useful: reportView(useful),
    duplicate: reportView(duplicate),
    conflict: reportView(conflict),
    notUseful: reportView(notUseful),
    routeMismatch: "route_mismatch",
    restoredReplay: reportView(restored),
    foreign: reportView(foreign),
    expired: reportView(expired),
    reportFailure: reportView(failed),
    absentPurchaseReported: false,
    rotation: {
      rotated: true,
      restarted: true,
      report: reportView(rotatedReport),
      replay: reportView(replay),
    },
    evilFollowed: book.evilFollowed || live.evilFollowed,
    feedbackUrl: `${LIVE_ORIGIN}${CALLER_RESULT_FEEDBACK_PATH}`,
    beforeResponse: publicSlice(beforeResponse),
    afterResponse: publicSlice(afterResponse),
    cold: publicSlice(fresh),
    taskSubmitted: false,
    visitorEntryInvoked: false,
  };
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  assert.equal(text.includes(feedbackKey), false);
  assert.equal(text.includes(actorSecret), false);
  assert.equal(state.tokens.some((token) => text.includes(token)), false);
  assert.equal(text.includes("evil.example"), false);
  assert.equal(text.includes("https://ok.example"), false);
  assert.equal(text.includes(account.address), false);
  process.stdout.write(text);
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  const redacted = state.tokens.reduce(
    (clean, token) => clean.split(token).join("[caller-capability-redacted]"),
    message.split(state.feedbackKey).join("[feedback-key-redacted]"),
  );
  process.stderr.write(`${redacted}\n`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
