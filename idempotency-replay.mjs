import { createHash, createHmac, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Credential } from "mppx";

const PAYMENT_HEADERS = ["payment-signature", "x-payment", "x-payment-signature"];
const settlementContext = new AsyncLocalStorage();

// Observe the existing facilitator call, without replacing either payment rail.
// The possible-spend marker is durable BEFORE the external mutation begins.
export function trackReplaySettlementAttempts(client) {
  return new Proxy(client, {
    get(target, key) {
      if (key === "settle") return async (...args) => {
        await settlementContext.getStore()?.();
        return target.settle(...args);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function replaySettlementWasAttempted() {
  return settlementContext.getStore()?.attempted === true;
}

function retainedDeliveryFields(record) {
  if (!record?.settlementAttempted || !record.precomputedBodyBase64) return {};
  const bytes = Buffer.from(record.precomputedBodyBase64, "base64");
  if (createHash("sha256").update(bytes).digest("hex") !== record.precomputedBodySha256) return {};
  try {
    return { settlementConfirmed: false, delivery: { ...JSON.parse(bytes.toString("utf8")), charged: null } };
  } catch { return {}; }
}

function persistentReplaySecret(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "idempotency-replay.key");
  try { writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const key = readFileSync(file, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("invalid persisted replay key");
  return key;
}
const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SAFE_REPLAY_HEADERS = new Set([
  "content-type",
  "payment-response",
  "payment-receipt",
  "x-payment-response",
  "x-payment-receipt",
]);

export const DEFAULT_PAID_ROUTES = new Set([
  "/extract",
  "/read",
  "/scan",
  "/schemaforge",
  "/enrich",
  "/wallet-enrich",
  "/deep-audit",
  "/defi/morpho-position",
  "/defi/morpho-protection",
  "/defi/morpho-market-underwrite",
  "/defi/morpho-preliquidation-replay",
  "/work/opportunity-preflight",
  "/distribution/agent-discoverability-audit",
  "/commerce/payment-offer-preflight",
  "/commerce/settlement-proof",
  "/chain/transaction-receipt",
  "/chain/solana-transaction-receipt",
  "/security/wallet-policy-conformance",
  "/security/stateful-wallet-policy-conformance",
]);

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value.join(",") : String(value || "");
}

function x402PaymentHeader(headers) {
  return PAYMENT_HEADERS.map((name) => headerValue(headers, name)).find(Boolean) || "";
}

function mppPaymentHeader(headers) {
  return Credential.extractPaymentScheme(headerValue(headers, "authorization")) || "";
}

function normalizeAddress(value) {
  const candidate = String(value || "");
  return EVM_ADDRESS_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

export function canonicalReplayUrl(value) {
  const url = new URL(value);
  url.hash = "";
  const entries = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  url.search = "";
  for (const [key, entryValue] of entries) url.searchParams.append(key, entryValue);
  return url.toString();
}

export function decodeReplayPayment(headers) {
  const encoded = x402PaymentHeader(headers);
  if (encoded) {
    try {
      const payment = JSON.parse(Buffer.from(encoded.trim(), "base64").toString("utf8"));
      const suppliedId = payment?.extensions?.["payment-identifier"]?.info?.id;
      const id = suppliedId == null ? createHash("sha256").update(encoded.trim()).digest("hex") : suppliedId;
      const payer = normalizeAddress(payment?.payload?.authorization?.from || payment?.payload?.from);
      const accepted = payment?.accepted;
      if (!PAYMENT_ID_PATTERN.test(String(id || "")) || !payer || payment?.x402Version !== 2) return null;
      if (!accepted || typeof accepted !== "object") return null;
      const terms = {
        scheme: String(accepted.scheme || ""),
        network: String(accepted.network || ""),
        asset: normalizeAddress(accepted.asset),
        amount: String(accepted.amount || ""),
        payTo: normalizeAddress(accepted.payTo),
      };
      if (terms.scheme !== "exact" || !terms.network || !terms.asset || !/^\d+$/.test(terms.amount) || !terms.payTo) {
        return null;
      }
      return {
        id: String(id),
        hasPaymentIdentifier: suppliedId != null,
        payer,
        protocol: "x402",
        credentialBinding: createHash("sha256").update(encoded.trim()).digest("hex"),
        validUntilMs: Number(payment?.payload?.authorization?.validBefore) * 1000,
        authorizationIdentity: /^0x[a-fA-F0-9]{64}$/.test(String(payment?.payload?.authorization?.nonce || ""))
          ? JSON.stringify([terms.network, terms.asset, payer, payment.payload.authorization.nonce.toLowerCase()]) : null,
        terms,
      };
    } catch {
      return null;
    }
  }

  const authorization = mppPaymentHeader(headers);
  if (!authorization) return null;
  try {
    const credential = Credential.deserialize(authorization);
    const request = credential?.challenge?.request;
    const details = request?.methodDetails;
    const payer = normalizeAddress(credential?.payload?.from);
    const payTo = normalizeAddress(request?.recipient);
    const asset = normalizeAddress(request?.currency);
    const amount = String(request?.amount || "");
    const chainId = Number(details?.chainId);
    if (credential?.challenge?.method !== "evm" || credential?.challenge?.intent !== "charge") return null;
    if (!payer || !payTo || !asset || !/^\d+$/.test(amount) || !Number.isSafeInteger(chainId) || chainId <= 0) {
      return null;
    }
    if (normalizeAddress(credential?.payload?.to) !== payTo || String(credential?.payload?.value || "") !== amount) {
      return null;
    }
    return {
      id: createHash("sha256").update(authorization).digest("hex"),
      payer,
      protocol: "mpp",
      credentialBinding: createHash("sha256").update(authorization).digest("hex"),
      validUntilMs: Number(credential?.payload?.validBefore) * 1000,
      terms: {
        scheme: "evm-charge",
        network: `eip155:${chainId}`,
        asset,
        amount,
        payTo,
      },
    };
  } catch {
    return null;
  }
}

function publicRequestUrl(req) {
  const forwardedProto = headerValue(req.headers, "x-forwarded-proto").split(",", 1)[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = headerValue(req.headers, "x-forwarded-host").split(",", 1)[0].trim()
    || headerValue(req.headers, "host")
    || "localhost";
  return canonicalReplayUrl(`${protocol}://${host}${req.originalUrl || req.url || req.path || "/"}`);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const candidate = Number(value);
  return Number.isInteger(candidate) && candidate >= minimum && candidate <= maximum ? candidate : fallback;
}

async function readStore(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed?.v !== 1 || !Array.isArray(parsed.records)) throw new Error("invalid replay store");
    return parsed.records;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function createIdempotencyReplay({
  dataDir = process.env.COMMERCE_DATA_DIR || path.join(process.cwd(), "data"),
  secret = process.env.COMMERCE_ACTOR_SECRET,
  ttlMs = boundedInteger(process.env.IDEMPOTENCY_TTL_MS, 15 * 60_000, 60_000, 24 * 60 * 60_000),
  maxEntries = boundedInteger(process.env.IDEMPOTENCY_MAX_ENTRIES, 256, 1, 2_000),
  maxResponseBytes = boundedInteger(process.env.IDEMPOTENCY_MAX_RESPONSE_BYTES, 512 * 1024, 1_024, 2 * 1024 * 1024),
  routes = DEFAULT_PAID_ROUTES,
  inFlightPaths = routes,
  requiredReplayPaths = new Set(),
  publicUrl,
  inFlightWaitMs = boundedInteger(process.env.IDEMPOTENCY_INFLIGHT_WAIT_MS, 15_000, 50, 60_000),
  now = () => Date.now(),
} = {}) {
  const storePath = path.join(dataDir, "idempotency-replay.json");
  const tempPath = path.join(dataDir, "idempotency-replay.tmp.json");
  let queue = Promise.resolve();
  const replaySecret = secret || persistentReplaySecret(dataDir);

  const digest = (label, value) => createHmac("sha256", replaySecret).update(`${label}:${value}`).digest("hex");

  function bindingFor({ method, url, headers, bodyBytes }) {
    const payment = decodeReplayPayment(headers);
    if (!payment) return null;
    const requestUrl = new URL(url);
    if (publicUrl) {
      const origin = new URL(publicUrl);
      requestUrl.protocol = origin.protocol;
      requestUrl.host = origin.host;
      requestUrl.port = origin.port;
    }
    const canonicalUrl = canonicalReplayUrl(requestUrl.href);
    const normalizedMethod = String(method || "GET").toUpperCase();
    const hasRequestBody = !["GET", "HEAD"].includes(normalizedMethod);
    const requestBody = Buffer.isBuffer(bodyBytes)
      ? bodyBytes
      : Buffer.from(bodyBytes == null ? "" : String(bodyBytes));
    const material = JSON.stringify({
      v: 2,
      method: normalizedMethod,
      url: canonicalUrl,
      bodySha256: hasRequestBody ? createHash("sha256").update(requestBody).digest("hex") : null,
      payer: payment.payer,
      credentialBinding: payment.credentialBinding,
      ...payment.terms,
    });
    return {
      key: digest("payment-id", payment.id),
      credentialKey: payment.authorizationIdentity ? digest("authorization", payment.authorizationIdentity) : null,
      fingerprint: digest("request", material),
      paymentId: payment.id,
      payer: payment.payer,
      validUntilMs: payment.validUntilMs,
      protected: inFlightPaths.has(new URL(canonicalUrl).pathname),
      hasPaymentIdentifier: payment.protocol !== "x402" || payment.hasPaymentIdentifier,
    };
  }

  async function mutate(operation) {
    let result;
    queue = queue.catch(() => {}).then(async () => {
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      await chmod(dataDir, 0o700).catch(() => {});
      const currentTime = now();
      const records = (await readStore(storePath)).filter((record) => Number(record.expiresAt) > currentTime);
      const mutation = await operation(records, currentTime);
      result = mutation.result;
      const protectedRecords = mutation.records.filter((record) => record.protected);
      if (protectedRecords.length > maxEntries) throw new Error("replay capacity exhausted");
      const bounded = [...protectedRecords, ...mutation.records.filter((record) => !record.protected)
        .sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
        .slice(0, maxEntries - protectedRecords.length)];
      await writeFile(tempPath, `${JSON.stringify({ v: 1, records: bounded })}\n`, { encoding: "utf8", mode: 0o600 });
      await chmod(tempPath, 0o600).catch(() => {});
      await rename(tempPath, storePath);
      await chmod(storePath, 0o600).catch(() => {});
    });
    await queue;
    return result;
  }

  async function lookup(binding) {
    if (!binding) return { kind: "miss" };
    return mutate(async (records) => {
      const existing = records.find((record) => record.key === binding.key || (binding.credentialKey && record.credentialKey === binding.credentialKey));
      if (!existing) return { records, result: { kind: "miss" } };
      if (existing.fingerprint !== binding.fingerprint) {
        return { records, result: { kind: "conflict" } };
      }
      if (existing.pending) return { records, result: { kind: "pending", record: existing } };
      return { records, result: { kind: "hit", record: existing } };
    });
  }

  async function claim(binding) {
    if (!binding) return { kind: "miss" };
    return mutate(async (records, currentTime) => {
      const existing = records.find((record) => record.key === binding.key || (binding.credentialKey && record.credentialKey === binding.credentialKey));
      if (!existing) {
        if (Number.isFinite(binding.validUntilMs) && binding.validUntilMs <= currentTime) return { records, result: { kind: "expired" } };
        if (records.filter((record) => record.protected).length >= maxEntries) return { records, result: { kind: "capacity" } };
        const record = {
          v: 1,
          key: binding.key,
          credentialKey: binding.credentialKey,
          fingerprint: binding.fingerprint,
          pending: true,
          protected: true,
          createdAt: currentTime,
          expiresAt: Math.max(currentTime + ttlMs, Number.isFinite(binding.validUntilMs) ? binding.validUntilMs + 60_000 : 0),
        };
        return { records: [record, ...records], result: { kind: "miss", reserved: true } };
      }
      if (existing.fingerprint !== binding.fingerprint) {
        return { records, result: { kind: "conflict" } };
      }
      if (existing.pending) return { records, result: { kind: "pending", record: existing } };
      return { records, result: { kind: "hit", record: existing } };
    });
  }

  async function release(binding) {
    if (!binding) return false;
    return mutate(async (records) => ({
      records: records.filter((record) => !(
        record.key === binding.key
        && record.pending
        && record.fingerprint === binding.fingerprint
      )),
      result: true,
    }));
  }

  async function store(binding, { status, headers, body }) {
    if (!binding || status < 200 || status >= 300) return false;
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
    if (!payload.length || payload.length > maxResponseBytes) return false;
    const safeHeaders = {};
    for (const [name, value] of Object.entries(headers || {})) {
      const normalized = name.toLowerCase();
      if (SAFE_REPLAY_HEADERS.has(normalized) && value != null) safeHeaders[normalized] = String(value);
    }
    if (!safeHeaders["payment-response"] && !safeHeaders["payment-receipt"] && !safeHeaders["x-payment-response"]) {
      return false;
    }
    const createdAt = now();
    const record = {
      v: 1,
      key: binding.key,
      credentialKey: binding.credentialKey,
      fingerprint: binding.fingerprint,
      protected: binding.protected === true,
      createdAt,
      expiresAt: Math.max(createdAt + ttlMs, Number.isFinite(binding.validUntilMs) ? binding.validUntilMs + 60_000 : 0),
      status,
      headers: safeHeaders,
      bodyBase64: payload.toString("base64"),
      bodySha256: createHash("sha256").update(payload).digest("hex"),
    };
    return mutate(async (records) => ({
      records: [record, ...records.filter((entry) => entry.key !== record.key)],
      result: true,
    }));
  }

  async function storageStatus() {
    return mutate(async (records) => ({
      records,
      result: {
        ready: true,
        activeEntries: records.length,
        ttlSeconds: Math.floor(ttlMs / 1_000),
        maxEntries,
        maxResponseBytes,
        privacy: "HMAC-bound payment IDs and request fingerprints; response bodies expire and storage is mode 0600",
      },
    })).catch(() => ({
      ready: false,
      activeEntries: null,
      ttlSeconds: Math.floor(ttlMs / 1_000),
      maxEntries,
      maxResponseBytes,
    }));
  }

  const publicProfile = Object.freeze({
    ttlSeconds: Math.floor(ttlMs / 1_000),
    mismatchStatus: 409,
    requestBinding: Object.freeze([
      "method",
      "canonical_url",
      "exact_raw_body_sha256",
      "payer",
      "payment_terms",
      "exact_settled_credential",
    ]),
  });

  async function middleware(req, res, next) {
    if (!routes.has(req.path)) return next();
    const binding = bindingFor({
      method: req.method,
      url: publicRequestUrl(req),
      headers: req.headers,
      bodyBytes: req.rawBody,
    });
    if (!binding) {
      if (requiredReplayPaths.has(req.path) && (x402PaymentHeader(req.headers) || mppPaymentHeader(req.headers))) {
        return res.status(400).json({ ok: false, error: "replayable_payment_credential_required", charged: false });
      }
      return next();
    }

    const useInFlight = inFlightPaths.has(req.path);
    // Batch (and any requiredReplayPaths route) needs an explicit x402 payment-identifier
    // for durable replay. MPP bindings set hasPaymentIdentifier via non-x402 protocol.
    // Keep expiry/TTL as a separate classification from a missing identifier.
    if (requiredReplayPaths.has(req.path) && !binding.hasPaymentIdentifier) {
      return res.status(400).json({ ok: false, error: "payment_identifier_required", charged: false });
    }
    if (requiredReplayPaths.has(req.path) && (!Number.isFinite(binding.validUntilMs) || binding.validUntilMs > now() + ttlMs)) {
      return res.status(400).json({ ok: false, error: "bounded_payment_validity_required", charged: false });
    }
    let cached = useInFlight ? await claim(binding) : await lookup(binding);
    if (cached.kind === "expired" || cached.kind === "capacity") {
      return res.status(cached.kind === "expired" ? 409 : 503).json({ ok: false, error: `payment_replay_${cached.kind}`, charged: false });
    }
    if (cached.kind === "pending") {
      const deadline = Date.now() + inFlightWaitMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        cached = await lookup(binding);
        if (cached.kind !== "pending") break;
      }
      if (cached.kind === "pending" || cached.kind === "miss") {
        res.set("Cache-Control", "no-store");
        res.set("X-Payment-Idempotency", "in_flight");
        return res.status(503).json({
          ok: false,
          error: "payment_execution_in_flight_or_unknown",
          charged: null,
          newSettlementAttempt: false,
          ...retainedDeliveryFields(cached.record),
          boundary: "Matching execution is active or unresolved. This request did not settle or fetch again. Any retained delivery is an unconfirmed precomputed result, not a paid-fulfillment claim. Reconcile the original attempt; do not create a replacement payment automatically.",
        });
      }
    }
    if (cached.kind === "conflict") {
      res.set("Cache-Control", "no-store");
      res.set("X-Payment-Idempotency", "conflict");
      return res.status(409).json({
        ok: false,
        error: "payment_identifier_request_conflict",
        charged: false,
        boundary: "The payment identifier is already bound to a different canonical request, payer, or payment term.",
      });
    }
    if (cached.kind === "hit") {
      for (const [name, value] of Object.entries(cached.record.headers || {})) res.set(name, value);
      res.set("Cache-Control", "no-store");
      res.set("X-Payment-Replay", "hit");
      res.set("X-Payment-Idempotency", "replay");
      return res.status(cached.record.status).send(Buffer.from(cached.record.bodyBase64, "base64"));
    }

    const chunks = [];
    let settlementAttempted = false;
    const markSettlementAttempt = async () => {
      if (!cached.reserved) return;
      settlementAttempted = true;
      markSettlementAttempt.attempted = true;
      const candidate = res.locals?.replayPrecomputedDelivery;
      const candidateBytes = candidate ? Buffer.from(JSON.stringify(candidate)) : null;
      if (candidateBytes && candidateBytes.length > maxResponseBytes) {
        throw new Error("precomputed delivery exceeds replay capacity");
      }
      await mutate(async (records) => ({
        records: records.map((record) => record.key === binding.key && record.fingerprint === binding.fingerprint
          ? { ...record, settlementAttempted: true,
            ...(candidateBytes ? {
              precomputedBodyBase64: candidateBytes.toString("base64"),
              precomputedBodySha256: createHash("sha256").update(candidateBytes).digest("hex"),
            } : {}),
          } : record),
        result: true,
      }));
    };
    let capturedBytes = 0;
    let overflow = false;
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const capture = (chunk, encoding) => {
      if (chunk == null || overflow) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === "string" ? encoding : undefined);
      capturedBytes += buffer.length;
      if (capturedBytes > maxResponseBytes) {
        overflow = true;
        chunks.length = 0;
      } else {
        chunks.push(buffer);
      }
    };
    res.write = function(chunk, encoding, callback) {
      capture(chunk, encoding);
      return originalWrite(chunk, encoding, callback);
    };
    let endScheduled = false;
    res.end = function(chunk, encoding, callback) {
      capture(chunk, encoding);
      const responseHeaders = res.getHeaders?.() || {};
      const hasSettlementProof = Boolean(
        responseHeaders["payment-response"]
        || responseHeaders["payment-receipt"]
        || responseHeaders["x-payment-response"],
      );
      if (endScheduled || overflow || res.statusCode < 200 || res.statusCode >= 300 || !hasSettlementProof) {
        const finish = () => {
          if (settlementAttempted && res.statusCode >= 400 && res.locals?.replayPrecomputedDelivery && !res.headersSent) {
            const body = JSON.stringify({
              ok: false, error: "payment_settlement_unknown", charged: null,
              settlementConfirmed: false, newSettlementAttempt: true,
              delivery: { ...res.locals.replayPrecomputedDelivery, charged: null },
              boundary: "Precomputed comparison only. Settlement is unconfirmed; do not create a replacement payment automatically.",
            });
            // An attempted settlement is not a new unpaid challenge. Returning
            // 402 here invites clients to authorize a replacement payment.
            res.statusCode = 503;
            res.removeHeader("Payment-Required");
            res.removeHeader("WWW-Authenticate");
            res.removeHeader("Content-Length");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            return originalEnd(body, "utf8", callback);
          }
          return originalEnd(chunk, encoding, callback);
        };
        if (cached.reserved && !settlementAttempted && !hasSettlementProof) {
          endScheduled = true;
          void release(binding).catch(() => {}).finally(finish);
          return res;
        }
        return finish();
      }
      endScheduled = true;
      void store(binding, {
        status: res.statusCode,
        headers: responseHeaders,
        body: Buffer.concat(chunks),
      })
        .catch((error) => console.error(`idempotency replay write failed: ${error.message}`))
        .finally(() => originalEnd(chunk, encoding, callback));
      return res;
    };
    return settlementContext.run(markSettlementAttempt, () => next());
  }

  return {
    middleware,
    bindingFor,
    lookup,
    claim,
    release,
    store,
    storageStatus,
    publicProfile,
    flush: () => queue,
    storePath,
  };
}
