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
import { bindMerchantHttpDeliveryContracts } from "./http-delivery-evidence/bind-merchant-contracts.mjs";
import {
  DELIVERY,
  EXTRACT_CONTRACT,
  PAID_EVIDENCE_FILENAME,
  RESOURCES,
  SETTLEMENT_CLASS,
  VALIDATION_FILENAME,
  VALIDATOR_AUTHORITY,
  VALIDATOR_SOURCE,
  digestResponseBytes,
  evaluateResponseBytes,
  isHistoricalV1PaidSuccess,
  joinKey,
  openStore,
  parseNdjson,
} from "./http-delivery-evidence/index.mjs";
import { historicalV1Row } from "./http-delivery-evidence/test/helpers.mjs";
import { proveMountedDeliveryJoin } from "./ordinary-delivery-join-observe.mjs";

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

async function startMerchant({ dataDir, facilitatorUrl, settlementClass = "simulated" }) {
  const preloadPath = path.join(dataDir, "extract-fetch-hook.mjs");
  const longHtml = `<html><head><title>Long</title></head><body><p>${"x".repeat(2000)}</p></body></html>`;
  await writeFile(preloadPath, `
const nativeJsonStringify = JSON.stringify;
JSON.stringify = function httpDeliveryFixtureStringify(value, replacer, space) {
  if (
    value && typeof value === "object" && !Array.isArray(value)
    && (value.url === "https://invalid-json.example/" || value.url === "https://schema-fail.example/")
    && Object.hasOwn(value, "requestedUrl")
  ) {
    if (value.url === "https://invalid-json.example/") return "{not-json";
    return nativeJsonStringify({ ok: true });
  }
  return arguments.length === 1 ? nativeJsonStringify(value) : nativeJsonStringify(value, replacer, space);
};
globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = 50;
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input, init) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  const pages = {
    "https://ok.example/": { status: 200, url: "https://ok.example/", body: "<html><head><title>OK</title></head><body><p>hello</p></body></html>" },
    "https://403.example/": { status: 403, url: "https://403.example/", body: "<html><body><h1>Access Denied</h1><p>block copy</p></body></html>" },
    "https://long.example/": { status: 200, url: "https://long.example/", body: ${JSON.stringify(longHtml)} },
    "https://gzip.example/": { status: 200, url: "https://gzip.example/", body: "ignored", encoding: "gzip" },
    "https://slow.example/": { hang: true },
    "https://invalid-json.example/": { status: 200, url: "https://invalid-json.example/", body: "<html><head><title>Invalid</title></head><body><p>bad</p></body></html>" },
    "https://schema-fail.example/": { status: 200, url: "https://schema-fail.example/", body: "<html><head><title>Schema</title></head><body><p>gap</p></body></html>" },
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
  const env = {
    ...process.env,
    PORT: String(port),
    COMMERCE_DATA_DIR: dataDir,
    COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
    FACILITATOR: "xpay",
    FACILITATOR_URL: facilitatorUrl,
    MPP_SECRET_KEY: "",
    PUBLIC_URL: "https://agents.samedaydesk.com",
    NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
  };
  if (settlementClass == null) delete env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
  else env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = settlementClass;
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env,
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

async function waitForRows(file, minCount, predicate = null) {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const text = await readFile(file, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
    const rows = parseNdjson(text).filter((row) => !row?._unparseable);
    if (rows.length >= minCount && (predicate === null || predicate(rows))) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${minCount} rows in ${file}`);
}

function assertNoPrivateMaterial(row) {
  const text = JSON.stringify(row);
  for (const needle of ["ok.example", "403.example", "invalid-json.example", "schema-fail.example", "payment-signature", PAYER, "?url="]) {
    assert.equal(text.includes(needle), false, needle);
  }
  assert.equal(Object.hasOwn(row, "parsed"), false);
  assert.equal(row.usefulness, "unknown");
}

function assertObservedValidation(row, bytes, { status = 200, settlementClass } = {}) {
  bindMerchantHttpDeliveryContracts();
  const evaluated = evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.EXTRACT,
    responseBytes: bytes,
    merchantHttpStatus: status,
    settlementClass,
  });
  assert.equal(row.method, "GET");
  assert.equal(row.resource, RESOURCES.EXTRACT);
  assert.equal(row.contractName, EXTRACT_CONTRACT);
  assert.equal(row.responseDigest, digestResponseBytes(bytes));
  assert.equal(row.responseByteLength, bytes.length);
  assert.equal(row.merchantHttpStatus, status);
  assert.equal(row.deliveryClass, evaluated.deliveryClass);
  assert.equal(row.validatorVerdict, evaluated.validatorVerdict);
  assert.equal(row.validatorAuthority, VALIDATOR_AUTHORITY);
  assert.equal(row.validatorSource, VALIDATOR_SOURCE);
  assert.deepEqual(row.counters, evaluated.counters);
  assert.equal(row.settlementClass, settlementClass);
  assertNoPrivateMaterial(row);
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
  assert.equal(okValidation.paidEvidenceId, liveOk.id);
  assert.equal(joinKey(liveOk), joinKey({ method: "GET", resource: RESOURCES.EXTRACT, responseDigest: okValidation.responseDigest }));

  const secondOk = await paidGet(merchant.base, "/extract", "https://ok.example/");
  assert.equal(secondOk.paid.status, 200);
  const v1After = await waitForRows(path.join(dataDir, PAID_EVIDENCE_FILENAME), liveV1.length + 2);
  assert.equal(new Set(v1After.map((row) => row.id)).size, v1After.length);

  const joined = await openStore(dataDir).join({ currentValidatorVerdict: "validated" });
  assert.equal(joined.length, v1After.length);
  const historical = joined.find((row) => row.historical?.id === prior.id);
  assert.equal(historical.historical.validatorVerdict, "not_checked");
  assert.equal(historical.validations.length, 0);
  const firstJoined = joined.find((row) => row.historical.id === liveOk.id);
  const secondJoined = joined.find((row) => row.historical.id !== liveOk.id && row.historical.id !== prior.id && row.historical.route === "/extract");
  assert.ok(firstJoined);
  assert.ok(secondJoined);
  assert.notEqual(firstJoined.historical.id, secondJoined.historical.id);
  assert.ok(firstJoined.validations.every((item) => item.paidEvidenceId === firstJoined.historical.id));
  assert.ok(secondJoined.validations.every((item) => item.paidEvidenceId === secondJoined.historical.id));

  const proved = await proveMountedDeliveryJoin(dataDir);
  assert.equal(proved.producerUnchanged, true);
  assert.equal(proved.identicalBodyDistinct, true);
  assert.equal(proved.foreignRefused, true);
  assert.ok(proved.classes.includes("full_bounded_capture"));
  assert.ok(proved.classes.includes("truncated_partial"));
  assert.ok(proved.classes.includes("source_refusal"));
  const joinedOk = proved.isolated.find((item) => item.id === liveOk.id);
  assert.equal(joinedOk.disposition, "exact_join");
  assert.equal(joinedOk.responseDigest, digestResponseBytes(ok.bytes));
  assert.equal(joinedOk.deliveryClass, "full_bounded_capture");
  assert.equal(proved.identicalBodyDistinct, true);
});

test("paid extract records invalid JSON and schema failure from the observed bytes", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "http-delivery-schema-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, settlementClass: null });

  const invalid = await paidGet(merchant.base, "/extract", "https://invalid-json.example/");
  assert.equal(invalid.paid.status, 200);
  assert.equal(invalid.bytes.toString("utf8"), "{not-json");
  assert.equal(invalid.body, null);

  const schemaFail = await paidGet(merchant.base, "/extract", "https://schema-fail.example/");
  assert.equal(schemaFail.paid.status, 200);
  assert.equal(schemaFail.bytes.toString("utf8"), "{\"ok\":true}");
  assert.equal(extractMcpOutputSchema.safeParse(schemaFail.body).success, false);

  const v1 = await waitForRows(path.join(dataDir, PAID_EVIDENCE_FILENAME), 2);
  const validations = await waitForRows(path.join(dataDir, VALIDATION_FILENAME), 2);
  assert.equal(validations.length, 2);
  const invalidRow = validations.find((row) => row.responseDigest === digestResponseBytes(invalid.bytes));
  const schemaRow = validations.find((row) => row.responseDigest === digestResponseBytes(schemaFail.bytes));
  assert.ok(invalidRow);
  assert.ok(schemaRow);
  assertObservedValidation(invalidRow, invalid.bytes, { settlementClass: SETTLEMENT_CLASS.REAL_UNVERIFIED });
  assertObservedValidation(schemaRow, schemaFail.bytes, { settlementClass: SETTLEMENT_CLASS.REAL_UNVERIFIED });
  assert.equal(invalidRow.deliveryClass, DELIVERY.MALFORMED_BODY);
  assert.equal(schemaRow.deliveryClass, DELIVERY.MALFORMED_BODY);
  assert.equal(invalidRow.validatorVerdict, "invalid");
  assert.equal(schemaRow.validatorVerdict, "invalid");
  assert.notEqual(invalidRow.counters.schemaErrors, schemaRow.counters.schemaErrors);
  assert.equal(invalidRow.settlementReference, FAKE_TX);
  assert.equal(schemaRow.settlementReference, FAKE_TX);

  for (const row of [invalidRow, schemaRow]) {
    const paid = v1.find((item) => item.id === row.paidEvidenceId);
    assert.ok(paid);
    assert.equal(paid.validatorVerdict, "not_checked");
    assert.equal(paid.responseDigest, row.responseDigest);
    assert.equal(paid.settlementReference, row.settlementReference);
    assert.equal(paid.requestDigest, row.requestDigest);
    assert.equal(paid.route, "/extract");
  }
  assert.notEqual(invalidRow.paidEvidenceId, schemaRow.paidEvidenceId);
  const joined = await openStore(dataDir).join({ currentValidatorVerdict: "validated" });
  assert.equal(joined.length, 2);
  for (const item of joined) {
    assert.equal(item.validations.length, 1);
    assert.equal(item.validations[0].paidEvidenceId, item.historical.id);
    assert.equal(item.historical.validatorVerdict, "not_checked");
  }
});

test("restart keeps the same paid-evidence join and does not backfill history", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "http-delivery-restart-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const prior = historicalV1Row({
    id: "33333333-3333-4333-8333-333333333333",
    responseDigest: "a".repeat(64),
    settlementReference: `0x${"b".repeat(64)}`,
  });
  const paidPath = path.join(dataDir, PAID_EVIDENCE_FILENAME);
  const validationPath = path.join(dataDir, VALIDATION_FILENAME);
  await writeFile(paidPath, `${JSON.stringify(prior)}\n`, "utf8");

  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const first = await paidGet(merchant.base, "/extract", "https://ok.example/");
  assert.equal(first.paid.status, 200);
  await waitForRows(validationPath, 1);
  await waitForRows(paidPath, 2);
  const paidBefore = await readFile(paidPath, "utf8");
  const validationBefore = await readFile(validationPath, "utf8");
  await stopChild(merchant.child);
  merchant.child = null;
  assert.equal(await readFile(paidPath, "utf8"), paidBefore);
  assert.equal(await readFile(validationPath, "utf8"), validationBefore);

  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  assert.equal(await readFile(paidPath, "utf8"), paidBefore);
  assert.equal(await readFile(validationPath, "utf8"), validationBefore);
  const joinedBefore = await openStore(dataDir).join({ currentValidatorVerdict: "validated" });
  const historical = joinedBefore.find((row) => row.historical.id === prior.id);
  assert.equal(historical.historical.validatorVerdict, "not_checked");
  assert.equal(historical.validations.length, 0);
  const live = joinedBefore.find((row) => row.historical.id !== prior.id);
  assert.equal(live.validations.length, 1);
  assert.equal(live.validations[0].paidEvidenceId, live.historical.id);
  assert.equal(live.validations[0].responseDigest, live.historical.responseDigest);
  assert.equal(live.historical.validatorVerdict, "not_checked");

  const second = await paidGet(merchant.base, "/extract", "https://ok.example/");
  assert.equal(second.paid.status, 200);
  const paidAfter = await waitForRows(paidPath, 3);
  const validationsAfter = await waitForRows(validationPath, 2);
  const paidText = await readFile(paidPath, "utf8");
  const validationText = await readFile(validationPath, "utf8");
  assert.equal(paidText.startsWith(paidBefore), true);
  assert.equal(validationText.startsWith(validationBefore), true);
  assert.equal(new Set(paidAfter.map((row) => row.id)).size, paidAfter.length);
  assert.equal(validationsAfter.length, 2);
  const joinedAfter = await openStore(dataDir).join({ currentValidatorVerdict: "validated" });
  assert.equal(joinedAfter.find((row) => row.historical.id === prior.id).validations.length, 0);
  for (const item of joinedAfter) {
    if (item.historical.id === prior.id) continue;
    assert.equal(item.validations.length, 1);
    assert.equal(item.validations[0].paidEvidenceId, item.historical.id);
    assert.equal(item.validations[0].responseDigest, item.historical.responseDigest);
    assert.equal(item.historical.validatorVerdict, "not_checked");
    assertNoPrivateMaterial(item.validations[0]);
  }
});

test("one receipt's validation stays on that paid event across replay and nearby 402s", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "http-delivery-causal-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const attemptsPath = path.join(dataDir, "commerce-events.ndjson");
  const validationPath = path.join(dataDir, VALIDATION_FILENAME);
  const paidPath = path.join(dataDir, PAID_EVIDENCE_FILENAME);

  const firstChallenge = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://ok.example/")}`);
  assert.equal(firstChallenge.status, 402);
  const good = await paidGet(merchant.base, "/extract", "https://ok.example/");
  assert.equal(good.paid.status, 200);
  assert.equal(extractMcpOutputSchema.safeParse(good.body).success, true);
  const secondChallenge = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://403.example/")}`);
  assert.equal(secondChallenge.status, 402);
  await waitForRows(validationPath, 1);
  const validationBeforeReplay = await readFile(validationPath, "utf8");

  const replay = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://ok.example/")}`, {
    headers: { "payment-signature": good.payment },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-payment-replay"), "hit");
  const replayBytes = Buffer.from(await replay.arrayBuffer());
  assert.equal(digestResponseBytes(replayBytes), digestResponseBytes(good.bytes));
  await waitForRows(attemptsPath, 1, (rows) => rows.some((row) => row.replayed === true && row.route === "/extract" && row.status === 200));
  assert.equal(await readFile(validationPath, "utf8"), validationBeforeReplay);
  assert.equal(facilitator.calls.settle, 1);

  const refused = await paidGet(merchant.base, "/extract", "https://403.example/");
  assert.equal(refused.paid.status, 200);
  assert.equal(refused.body.sourceOk, false);
  const again = await paidGet(merchant.base, "/extract", "https://ok.example/");
  assert.equal(again.paid.status, 200);
  assert.equal(facilitator.calls.settle, 3);

  const paid = await waitForRows(paidPath, 3);
  const validations = await waitForRows(validationPath, 3);
  const attempts = await waitForRows(attemptsPath, 1, (rows) => rows.some((row) => row.replayed === true));
  assert.equal(paid.length, 3);
  assert.equal(validations.length, 3);
  const challengeIds = new Set(attempts.filter((row) => row.status === 402 || row.result === "challenge").map((row) => row.id));
  const replayIds = new Set(attempts.filter((row) => row.replayed === true).map((row) => row.id));
  assert.ok(challengeIds.size >= 2);
  assert.ok(replayIds.size >= 1);
  for (const row of validations) {
    assert.equal(challengeIds.has(row.paidEvidenceId), false);
    assert.equal(replayIds.has(row.paidEvidenceId), false);
    const event = paid.find((item) => item.id === row.paidEvidenceId);
    assert.ok(event);
    assert.equal(event.responseDigest, row.responseDigest);
    assert.equal(event.requestDigest, row.requestDigest);
    assert.equal(event.settlementReference, row.settlementReference);
    assert.equal(event.settlementReference, FAKE_TX);
    assert.equal(row.settlementClass, SETTLEMENT_CLASS.SIMULATED);
    assert.equal(event.validatorVerdict, "not_checked");
    assertNoPrivateMaterial(row);
  }
  assert.equal(new Set(validations.map((row) => row.paidEvidenceId)).size, 3);
  const goodRow = validations.find((row) => row.responseDigest === digestResponseBytes(good.bytes));
  const refusedRow = validations.find((row) => row.responseDigest === digestResponseBytes(refused.bytes));
  const againRow = validations.find((row) => row.responseDigest === digestResponseBytes(again.bytes));
  assert.equal(goodRow.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);
  assert.equal(refusedRow.deliveryClass, DELIVERY.SOURCE_REFUSAL);
  assert.equal(againRow.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);
  assert.notEqual(goodRow.paidEvidenceId, againRow.paidEvidenceId);
  assert.notEqual(goodRow.paidEvidenceId, refusedRow.paidEvidenceId);
  const joined = await openStore(dataDir).join({ currentValidatorVerdict: "validated" });
  assert.equal(joined.length, 3);
  for (const item of joined) {
    assert.equal(item.validations.length, 1);
    assert.equal(item.validations[0].paidEvidenceId, item.historical.id);
    assert.equal(item.validations[0].responseDigest, item.historical.responseDigest);
  }
});
