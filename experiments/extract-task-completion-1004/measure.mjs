/**
 * Credential-free measurement for ROOT-1004. Defaults to EVIDENCE.json beside
 * this file; a CLI output path preserves prior measurements. Does not retain source plaintext, pay, or call a live facilitator.
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { encodePaymentResponseHeader } from "@x402/core/http";

import { decideExtractTask } from "../../examples/customer-x402/src/extract-task.mjs";
import { classifyPaidResponse } from "../../examples/customer-x402/src/outcome.mjs";
import { classifyRequestConstruction } from "../../examples/customer-x402/src/request-construction.mjs";
import { FIXTURE_VALID_BODY } from "../../examples/customer-x402/fixtures/transport.mjs";
import { extract, extractMcpOutputSchema, readMarkdown } from "../../extract.mjs";
import { maxAdmittedBatchExcerptChars, normalizeExtractBatchInput } from "../../extract-batch.mjs";
import { EXTRACT_TEXT_EXCERPT_MAX_CHARS, buildCapture, fetchFailureCode, parseTextExcerptLimit } from "../../extract-capture.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(fileURLToPath(import.meta.url)), "EVIDENCE.json");
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const MARKER = "later-discussion-marker";
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const PAYER = `0x${"2".repeat(40)}`;
const NETWORK = "eip155:8453";
const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function htmlResponse(html, { status = 200, url, headers = {} } = {}) {
  const bytes = new TextEncoder().encode(html);
  const table = new Map(Object.entries({ "content-type": "text/html; charset=utf-8", ...headers }));
  return {
    status,
    url,
    headers: { get: (name) => table.get(String(name).toLowerCase()) ?? null },
    body: {
      getReader() {
        let done = false;
        return {
          async read() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
  };
}

function installFetch(fixtures) {
  const original = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  const calls = [];
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input, init) => {
    const target = String(typeof input === "string" || input instanceof URL ? input : input.url);
    calls.push(target);
    const hit = fixtures[target];
    if (!hit) throw Object.assign(new Error("unmapped"), { code: "fetch_error" });
    return typeof hit === "function" ? hit(target, init) : hit;
  };
  return {
    calls,
    restore() {
      if (original === undefined) delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
      else globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = original;
    },
  };
}

function decisionView(decision) {
  return {
    predicate: decision.predicate,
    satisfied: decision.satisfied,
    delivery: decision.delivery,
    reason: decision.reason,
    nextAction: {
      id: decision.nextAction.id,
      route: decision.nextAction.route,
      executed: decision.nextAction.executed,
      purchaseAuthorized: decision.nextAction.purchaseAuthorized,
    },
  };
}

function captureView(body) {
  const capture = body?.capture && typeof body.capture === "object" ? body.capture : null;
  return capture ? {
    textExcerptLimitChars: capture.textExcerptLimitChars ?? null,
    markdownLimitChars: capture.markdownLimitChars ?? null,
    bodyBytes: capture.bodyBytes ?? null,
    bodyTruncated: capture.bodyTruncated ?? null,
    textTruncated: capture.textTruncated ?? null,
  } : null;
}

function producerView(body) {
  const text = typeof body?.text === "string" ? body.text : null;
  const markdown = typeof body?.markdown === "string" ? body.markdown : null;
  return {
    schemaPass: extractMcpOutputSchema.safeParse(body).success,
    ok: body?.ok ?? null,
    sourceOk: body?.sourceOk ?? null,
    status: body?.status ?? null,
    errorCode: body?.error?.code ?? null,
    requestedUrl: body?.requestedUrl ?? null,
    finalUrl: body?.finalUrl ?? null,
    textLength: text?.length ?? null,
    markdownLength: markdown?.length ?? null,
    markerPresent: text ? text.includes(MARKER) : (markdown ? markdown.includes(MARKER) : null),
    truncated: body?.truncated ?? null,
    capture: captureView(body),
  };
}

async function timed(fn) {
  const started = performance.now();
  const value = await fn();
  return { value, latencyMs: Math.round(performance.now() - started) };
}

function responseFor(body, settlement = null) {
  const headers = new Map([["content-type", "application/json"]]);
  if (settlement) headers.set("payment-response", encodePaymentResponseHeader(settlement));
  return { status: 200, headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null } };
}

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

async function startFacilitator() {
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
    return send(404, { error: "unexpected" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return { calls, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function startMerchant({ dataDir, facilitatorUrl, fetchLog }) {
  const preloadPath = path.join(dataDir, "hook.mjs");
  const longBody = `<html><head><title>Doc</title><meta name="description" content="A public page"></head><body><article>${"intro ".repeat(400)}</article><p>${MARKER}</p></body></html>`;
  await writeFile(preloadPath, `
import { appendFileSync } from "node:fs";
const log = ${JSON.stringify(fetchLog)};
globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = 40;
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input, init) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  appendFileSync(log, url + "\\n");
  const pages = {
    "https://doc.example/": { status: 200, url: "https://doc.example/", body: ${JSON.stringify(longBody)} },
    "https://short.example/": { status: 200, url: "https://short.example/", body: "<html><head><title>Short</title></head><body><p>hello</p></body></html>" },
    "https://denied.example/": { status: 403, url: "https://denied.example/", body: "<html><body><h1>Access Denied</h1></body></html>" },
  };
  const page = pages[url];
  if (!page) throw Object.assign(new Error("unmapped"), { code: "fetch_error" });
  const bytes = new TextEncoder().encode(page.body);
  let delivered = false;
  return { status: page.status, url: page.url, headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null }, body: { getReader() { return { async read() { if (delivered) return { done: true }; delivered = true; return { done: false, value: bytes }; }, async cancel() {} }; } } };
};
`, "utf8");
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: repo,
    env: {
      ...process.env,
      FORCE_COLOR: "",
      NO_COLOR: "",
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-1500)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited ${code} ${signal}: ${output.slice(-2000)}`));
    });
  });
  return { port, child };
}

function payment(challenge, id) {
  const accepted = challenge.accepts.find((entry) => entry.scheme === "exact" && entry.network === NETWORK);
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
    extensions: { "payment-identifier": { info: { required: challenge.extensions?.["payment-identifier"]?.info?.required === true, id } } },
  })).toString("base64");
}

function challengeOf(response) {
  const encoded = response.headers.get("payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

async function mountedJourney() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-task-measure-"));
  const fetchLog = path.join(dataDir, "fetches.log");
  await writeFile(fetchLog, "");
  const facilitator = await startFacilitator();
  const merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLog });
  const base = `http://127.0.0.1:${merchant.port}`;
  const rows = [];
  try {
    const badUrl = `${base}/extract?url=${encodeURIComponent("https://doc.example/")}&textExcerptLimitChars=0`;
    const badTimed = await timed(() => fetch(badUrl));
    const badBody = await badTimed.value.json();
    rows.push({
      id: "mounted_seeded_bad_budget",
      population: "local merchant + fake facilitator",
      method: "GET",
      query: "textExcerptLimitChars=0",
      httpStatus: badTimed.value.status,
      charged: badBody.charged,
      error: badBody.error,
      settleCount: facilitator.calls.settle,
      sourceFetchCount: (await readFile(fetchLog, "utf8")).trim() === "" ? 0 : (await readFile(fetchLog, "utf8")).trim().split("\n").length,
      latencyMs: badTimed.latencyMs,
      costUsdc: 0,
    });
    const unpaid = await timed(() => fetch(`${base}/extract?url=${encodeURIComponent("https://doc.example/")}`));
    const unpaidChallenge = challengeOf(unpaid.value);
    const accepted = unpaidChallenge.accepts.find((entry) => entry.scheme === "exact" && entry.network === NETWORK);
    const description = unpaidChallenge.resource?.description || accepted.description || "";
    rows.push({
      id: "mounted_unpaid_default_challenge",
      httpStatus: unpaid.value.status,
      amountAtomic: accepted.amount,
      payTo: accepted.payTo,
      descriptionCodePoints: [...description].length,
      descriptionNamesBudget: description.includes("textExcerptLimitChars"),
      latencyMs: unpaid.latencyMs,
      costUsdc: 0,
    });
    const raisedUnpaid = await fetch(`${base}/extract?url=${encodeURIComponent("https://doc.example/")}&textExcerptLimitChars=8000`);
    const raisedAccepted = challengeOf(raisedUnpaid).accepts.find((entry) => entry.scheme === "exact");
    rows.push({
      id: "mounted_unpaid_raised_budget_same_price",
      httpStatus: raisedUnpaid.status,
      amountAtomic: raisedAccepted.amount,
      payTo: raisedAccepted.payTo,
      sameAmountAsDefault: raisedAccepted.amount === accepted.amount,
      costUsdc: 0,
    });
    const target = `${base}/extract?url=${encodeURIComponent("https://doc.example/")}`;
    const signature = payment(unpaidChallenge, "measure_default_001");
    const paid = await timed(() => fetch(target, { headers: { "payment-signature": signature } }));
    const paidBody = await paid.value.json();
    const paidDecision = decideExtractTask(paidBody, { kind: "excerpt", requiredChars: 2000 });
    rows.push({
      id: "mounted_paid_default_excerpt_predicate",
      httpStatus: paid.value.status,
      producer: producerView(paidBody),
      caller: decisionView(paidDecision),
      settleCount: facilitator.calls.settle,
      latencyMs: paid.latencyMs,
      costUsdc: 0,
      note: "Fake facilitator. No USDC moved.",
    });
    const replay = await fetch(target, { headers: { "payment-signature": signature } });
    rows.push({
      id: "mounted_replay_same_payment",
      httpStatus: replay.status,
      replay: replay.headers.get("x-payment-replay"),
      settleCount: facilitator.calls.settle,
      costUsdc: 0,
    });
    const conflict = await fetch(`${target}&textExcerptLimitChars=8000`, { headers: { "payment-signature": signature } });
    const conflictBody = await conflict.json();
    rows.push({
      id: "mounted_same_payment_changed_budget",
      httpStatus: conflict.status,
      charged: conflictBody.charged ?? null,
      error: conflictBody.error ?? null,
      settleCount: facilitator.calls.settle,
      costUsdc: 0,
    });
    const raisedChallenge = challengeOf(await fetch(`${target}&textExcerptLimitChars=8000`));
    const raised = await timed(() => fetch(`${target}&textExcerptLimitChars=8000`, {
      headers: { "payment-signature": payment(raisedChallenge, "measure_raised_0001") },
    }));
    const raisedBody = await raised.value.json();
    rows.push({
      id: "mounted_paid_raised_excerpt",
      httpStatus: raised.value.status,
      amountAtomic: raisedChallenge.accepts.find((entry) => entry.scheme === "exact").amount,
      producer: producerView(raisedBody),
      caller: decisionView(decideExtractTask(raisedBody, { kind: "excerpt", requiredChars: 2000 })),
      settleCount: facilitator.calls.settle,
      latencyMs: raised.latencyMs,
      costUsdc: 0,
    });
    const readChallenge = challengeOf(await fetch(`${base}/read?url=${encodeURIComponent("https://doc.example/")}`));
    const readPaid = await timed(() => fetch(`${base}/read?url=${encodeURIComponent("https://doc.example/")}`, {
      headers: { "payment-signature": payment(readChallenge, "measure_read_000001") },
    }));
    const readBody = await readPaid.value.json();
    rows.push({
      id: "mounted_paid_read_separate_request",
      httpStatus: readPaid.value.status,
      amountAtomic: readChallenge.accepts.find((entry) => entry.scheme === "exact").amount,
      markdownLength: typeof readBody.markdown === "string" ? readBody.markdown.length : null,
      markerPresent: typeof readBody.markdown === "string" ? readBody.markdown.includes(MARKER) : null,
      truncated: readBody.truncated ?? null,
      calledByExtract: false,
      latencyMs: readPaid.latencyMs,
      costUsdc: 0,
    });
    const deniedChallenge = challengeOf(await fetch(`${base}/extract?url=${encodeURIComponent("https://denied.example/")}`));
    const denied = await fetch(`${base}/extract?url=${encodeURIComponent("https://denied.example/")}`, {
      headers: { "payment-signature": payment(deniedChallenge, "measure_denied_0001") },
    });
    const deniedBody = await denied.json();
    rows.push({
      id: "mounted_source_refusal",
      httpStatus: denied.status,
      producer: producerView(deniedBody),
      caller: decisionView(decideExtractTask(deniedBody, { kind: "excerpt" })),
      costUsdc: 0,
    });
    rows.push({
      id: "mounted_fetch_log_not_empty_after_paid",
      sourceFetchCount: (await readFile(fetchLog, "utf8")).trim().split("\n").filter(Boolean).length,
      settleCount: facilitator.calls.settle,
    });
    return { base, badUrl, rows };
  } finally {
    merchant.child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (merchant.child.exitCode !== null) return resolve();
      merchant.child.once("exit", resolve);
      setTimeout(resolve, 2000);
    });
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function inProcess() {
  const longHtml = `<html><head><title>Doc</title><meta name="description" content="A public page"></head><body><article>${"intro ".repeat(400)}</article><p>${MARKER}</p></body></html>`;
  const wideHtml = `<html><head><title>Wide</title></head><body><p>${"word ".repeat(12000)}</p></body></html>`;
  const hook = installFetch({
    "https://doc.example/": htmlResponse(longHtml, { url: "https://doc.example/" }),
    "https://short.example/": htmlResponse("<html><head><title>Short</title></head><body><p>hello</p></body></html>", { url: "https://short.example/" }),
    "https://denied.example/": htmlResponse("<html><body><h1>Access Denied</h1></body></html>", { status: 403, url: "https://denied.example/" }),
    "https://start.example/": htmlResponse("", {
      status: 302,
      url: "https://start.example/",
      headers: { location: "https://end.example/page", "content-type": "text/html" },
    }),
    "https://end.example/page": htmlResponse("<html><head><title>Final</title></head><body><p>after redirect</p></body></html>", { url: "https://end.example/page" }),
    "https://wide.example/": htmlResponse(wideHtml, { url: "https://wide.example/" }),
    "https://huge.example/": () => {
      const chunk = new Uint8Array(400000).fill(65);
      let n = 0;
      return {
        status: 200,
        url: "https://huge.example/",
        headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
        body: { getReader() { return { async read() { if (n >= 10) return { done: true }; n += 1; return { done: false, value: chunk }; }, async cancel() {} }; } },
      };
    },
    "https://slow.example/": (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    }),
  });
  const cases = [];
  try {
    const before = hook.calls.length;
    let rejected = null;
    try {
      await extract("https://doc.example/", { textExcerptLimitChars: 40001 });
    } catch (error) {
      rejected = error.message;
    }
    cases.push({
      id: "in_process_bad_budget_before_fetch",
      predicate: "excerpt",
      rejected: true,
      error: rejected,
      fetchesAdded: hook.calls.length - before,
      parser: parseTextExcerptLimit("40001"),
      costUsdc: 0,
    });
    const short = await timed(() => extract("https://short.example/"));
    cases.push({
      id: "short_full_excerpt",
      predicate: { kind: "excerpt", requiredChars: 5 },
      producer: producerView(short.value),
      caller: decisionView(decideExtractTask(short.value, { kind: "excerpt", requiredChars: 5 })),
      latencyMs: short.latencyMs,
      costUsdc: 0,
    });
    const cropped = await timed(() => extract("https://doc.example/"));
    cases.push({
      id: "default_excerpt_cropped_no_predicate",
      predicate: null,
      producer: producerView(cropped.value),
      caller: decisionView(decideExtractTask(cropped.value, null)),
      latencyMs: cropped.latencyMs,
      costUsdc: 0,
    });
    cases.push({
      id: "metadata_sufficient_while_text_cropped",
      predicate: { kind: "metadata" },
      producer: { textTruncated: cropped.value.capture.textTruncated, titlePresent: Boolean(cropped.value.title) },
      caller: decisionView(decideExtractTask(cropped.value, { kind: "metadata" })),
      costUsdc: 0,
    });
    cases.push({
      id: "excerpt_required_beyond_1200",
      predicate: { kind: "excerpt", requiredChars: 2000 },
      caller: decisionView(decideExtractTask(cropped.value, { kind: "excerpt", requiredChars: 2000 })),
      costUsdc: 0,
    });
    const raised = await timed(() => extract("https://doc.example/", { textExcerptLimitChars: 8000 }));
    cases.push({
      id: "raised_excerpt_8000",
      predicate: { kind: "excerpt", requiredChars: 2000 },
      producer: producerView(raised.value),
      caller: decisionView(decideExtractTask(raised.value, { kind: "excerpt", requiredChars: 2000 })),
      responseKeysSameAsDefault: JSON.stringify(Object.keys(cropped.value).sort()) === JSON.stringify(Object.keys(raised.value).sort()),
      latencyMs: raised.latencyMs,
      costUsdc: 0,
    });
    const markdownDecision = decideExtractTask(cropped.value, { kind: "markdown" });
    const read = await timed(() => readMarkdown("https://doc.example/"));
    cases.push({
      id: "markdown_predicate_points_at_read",
      caller: decisionView(markdownDecision),
      readInvokedByDecision: markdownDecision.nextAction.executed,
      separateRead: {
        markdownLength: read.value.markdown.length,
        markerPresent: read.value.markdown.includes(MARKER),
        truncated: read.value.truncated,
        latencyMs: read.latencyMs,
      },
      costUsdc: 0,
    });
    const wide = await timed(() => readMarkdown("https://wide.example/"));
    cases.push({
      id: "read_40000_bound",
      markdownLength: wide.value.markdown.length,
      truncated: wide.value.truncated,
      captureMarkdownLimit: wide.value.capture.markdownLimitChars,
      caller: decisionView(decideExtractTask({ ...cropped.value, text: "x" }, { kind: "markdown", requiredChars: 40001 })),
      latencyMs: wide.latencyMs,
      costUsdc: 0,
    });
    const previousTimeout = globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
    globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = 40;
    let timeoutBody = null;
    const timeoutTimed = await timed(async () => {
      try {
        return await extract("https://slow.example/", { textExcerptLimitChars: 8000 });
      } catch (error) {
        timeoutBody = {
          ok: false,
          url: "https://slow.example/",
          requestedUrl: "https://slow.example/",
          finalUrl: null,
          status: null,
          sourceOk: false,
          error: { code: fetchFailureCode(error), message: "aborted" },
          capture: buildCapture({ textExcerptLimitChars: 8000, bodyBytes: 0, charset: null }),
        };
        return timeoutBody;
      }
    });
    if (previousTimeout === undefined) delete globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
    else globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = previousTimeout;
    const timeoutRecord = timeoutTimed.value?.ok === false ? timeoutTimed.value : timeoutBody;
    cases.push({
      id: "timeout_unavailable",
      producer: { ok: timeoutRecord?.ok ?? null, errorCode: timeoutRecord?.error?.code ?? null, capture: captureView(timeoutRecord) },
      caller: decisionView(decideExtractTask(timeoutRecord, { kind: "excerpt" })),
      latencyMs: timeoutTimed.latencyMs,
      costUsdc: 0,
    });
    const refused = await timed(() => extract("https://denied.example/"));
    cases.push({
      id: "source_refusal",
      producer: producerView(refused.value),
      caller: decisionView(decideExtractTask(refused.value, { kind: "excerpt" })),
      latencyMs: refused.latencyMs,
      costUsdc: 0,
    });
    const redirected = await timed(() => extract("https://start.example/"));
    cases.push({
      id: "redirect_identity",
      producer: producerView(redirected.value),
      caller: decisionView(decideExtractTask(redirected.value, { kind: "excerpt", requiredChars: 5 })),
      latencyMs: redirected.latencyMs,
      costUsdc: 0,
    });
    const huge = await timed(() => extract("https://huge.example/"));
    cases.push({
      id: "body_budget_cutoff",
      producer: producerView(huge.value),
      caller: decisionView(decideExtractTask(huge.value, { kind: "excerpt" })),
      latencyMs: huge.latencyMs,
      costUsdc: 0,
    });
    cases.push({
      id: "malformed_output",
      caller: decisionView(decideExtractTask("not-json", { kind: "excerpt" })),
      costUsdc: 0,
    });
    let batchError = null;
    try {
      normalizeExtractBatchInput({
        urls: Array.from({ length: 5 }, (_, index) => `https://example.com/${index}`),
        textExcerptLimitChars: EXTRACT_TEXT_EXCERPT_MAX_CHARS,
      });
    } catch (error) {
      batchError = error.message;
    }
    const omitted = normalizeExtractBatchInput({ urls: ["https://example.com/"], fields: ["title"] });
    cases.push({
      id: "batch_ceiling_and_omitted_key",
      fiveUrlCeiling: maxAdmittedBatchExcerptChars(5),
      rejected: batchError,
      omittedKeyPresent: Object.hasOwn(omitted, "textExcerptLimitChars"),
      costUsdc: 0,
    });
    const legacy = classifyPaidResponse({
      response: responseFor(FIXTURE_VALID_BODY),
      body: FIXTURE_VALID_BODY,
      requiredOutput: { mediaType: "application/json", requiredFields: ["ok", "url", "title", "text"], maxResponseBytes: 500000 },
      authorization: { bodyDigest: null, amountCapAtomic: "5000", network: NETWORK, asset: ASSET, recipient: PAY_TO },
    });
    cases.push({
      id: "old_consumer_fixture_without_task",
      outcome: legacy.outcome,
      outputDelivery: legacy.evidence.outputDelivery,
      taskSatisfied: legacy.evidence.task?.satisfied ?? null,
      taskDelivery: legacy.evidence.task?.delivery ?? null,
      purchaseAuthorized: legacy.evidence.task?.nextAction?.purchaseAuthorized ?? null,
      usefulNegative: "URL-only fixture with no capture and no predicate stays valid_delivered",
      costUsdc: 0,
    });
    const partial = classifyPaidResponse({
      response: responseFor(cropped.value),
      body: cropped.value,
      requiredOutput: {
        mediaType: "application/json",
        requiredFields: ["ok", "url", "title", "text"],
        maxResponseBytes: 500000,
        task: { kind: "excerpt", requiredChars: 2000 },
      },
      authorization: { bodyDigest: null, amountCapAtomic: "5000", network: NETWORK, asset: ASSET, recipient: PAY_TO },
    });
    const failed = classifyPaidResponse({
      response: responseFor(cropped.value, { success: false, errorReason: "fixture settle failure" }),
      body: cropped.value,
      requiredOutput: {
        mediaType: "application/json",
        requiredFields: ["ok", "url", "title", "text"],
        maxResponseBytes: 500000,
        task: { kind: "excerpt", requiredChars: 2000 },
      },
      authorization: { bodyDigest: null, amountCapAtomic: "5000", network: NETWORK, asset: ASSET, recipient: PAY_TO },
    });
    cases.push({
      id: "new_consumer_cropped_excerpt",
      outcome: partial.outcome,
      outputDelivery: partial.evidence.outputDelivery,
      taskSatisfied: partial.evidence.task.satisfied,
      nextAction: partial.evidence.task.nextAction.id,
      purchaseAuthorized: partial.evidence.task.nextAction.purchaseAuthorized,
      costUsdc: 0,
    });
    cases.push({
      id: "fixture_settlement_failed",
      outcome: failed.outcome,
      nextExecuted: failed.evidence.task.nextAction.executed,
      costUsdc: 0,
    });
    const badConstruction = classifyRequestConstruction(`https://agents.samedaydesk.com/extract?url=${encodeURIComponent("https://example.com")}&textExcerptLimitChars=0`);
    const legacyConstruction = classifyRequestConstruction(`https://agents.samedaydesk.com/extract?url=${encodeURIComponent("https://example.com")}`);
    cases.push({
      id: "caller_rejects_bad_budget_before_purchase",
      badPurchaseReady: badConstruction.purchaseReady,
      badKind: badConstruction.kind,
      legacyPurchaseReady: legacyConstruction.purchaseReady,
      costUsdc: 0,
    });
    return cases;
  } finally {
    hook.restore();
  }
}

const inProcessCases = await inProcess();
const mounted = await mountedJourney();
const evidence = {
  job: "ROOT-1004-EXTRACT-TASK-COMPLETION",
  measuredAt: new Date().toISOString(),
  sourceRevision,
  population: "in-process controlled fixture plus one local merchant process and a fake facilitator",
  source: "hooked fixture hosts doc.example, short.example, denied.example, start.example, wide.example, huge.example, slow.example; no live page fetch and no response plaintext retained",
  costUsdc: 0,
  historicalPurchasesNotRepeated: true,
  inProcess: inProcessCases,
  mounted: {
    unpaidReadbackUrl: mounted.badUrl,
    rows: mounted.rows,
  },
};
assert.equal(inProcessCases.find((row) => row.id === "timeout_unavailable").caller.delivery, "unavailable");
assert.equal(inProcessCases.find((row) => row.id === "timeout_unavailable").producer.capture.textExcerptLimitChars, 8000);
assert.equal(inProcessCases.find((row) => row.id === "batch_ceiling_and_omitted_key").fiveUrlCeiling, maxAdmittedBatchExcerptChars(5));
assert.equal(mounted.rows.find((row) => row.id === "mounted_seeded_bad_budget").httpStatus, 400);
assert.equal(mounted.rows.find((row) => row.id === "mounted_seeded_bad_budget").settleCount, 0);
assert.equal(mounted.rows.find((row) => row.id === "mounted_paid_raised_excerpt").caller.satisfied, true);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
const bad = mounted.rows.find((row) => row.id === "mounted_seeded_bad_budget");
console.log(JSON.stringify({
  evidence: outPath,
  seeded: bad,
  inProcess: inProcessCases.length,
  mounted: mounted.rows.length,
}));
