import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const PAYMENT_HEADERS = ["payment-signature", "x-payment", "x-payment-signature"];
const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SAFE_REPLAY_HEADERS = new Set([
  "content-type",
  "payment-response",
  "payment-receipt",
  "x-payment-response",
  "x-payment-receipt",
]);

const DEFAULT_PAID_ROUTES = new Set([
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
]);

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value.join(",") : String(value || "");
}

function paymentHeader(headers) {
  return PAYMENT_HEADERS.map((name) => headerValue(headers, name)).find(Boolean) || "";
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
  const encoded = paymentHeader(headers);
  if (!encoded) return null;
  try {
    const payment = JSON.parse(Buffer.from(encoded.trim(), "base64").toString("utf8"));
    const id = payment?.extensions?.["payment-identifier"]?.info?.id;
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
    return { id: String(id), payer, terms };
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
    return parsed?.v === 1 && Array.isArray(parsed.records) ? parsed.records : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    return [];
  }
}

export function createIdempotencyReplay({
  dataDir = process.env.COMMERCE_DATA_DIR || path.join(process.cwd(), "data"),
  secret = process.env.COMMERCE_ACTOR_SECRET || randomBytes(32).toString("hex"),
  ttlMs = boundedInteger(process.env.IDEMPOTENCY_TTL_MS, 15 * 60_000, 60_000, 24 * 60 * 60_000),
  maxEntries = boundedInteger(process.env.IDEMPOTENCY_MAX_ENTRIES, 256, 1, 2_000),
  maxResponseBytes = boundedInteger(process.env.IDEMPOTENCY_MAX_RESPONSE_BYTES, 512 * 1024, 1_024, 2 * 1024 * 1024),
  routes = DEFAULT_PAID_ROUTES,
  now = () => Date.now(),
} = {}) {
  const storePath = path.join(dataDir, "idempotency-replay.json");
  const tempPath = path.join(dataDir, "idempotency-replay.tmp.json");
  let queue = Promise.resolve();

  const digest = (label, value) => createHmac("sha256", secret).update(`${label}:${value}`).digest("hex");

  function bindingFor({ method, url, headers }) {
    const payment = decodeReplayPayment(headers);
    if (!payment) return null;
    const canonicalUrl = canonicalReplayUrl(url);
    const material = JSON.stringify({
      v: 1,
      method: String(method || "GET").toUpperCase(),
      url: canonicalUrl,
      payer: payment.payer,
      ...payment.terms,
    });
    return {
      key: digest("payment-id", payment.id),
      fingerprint: digest("request", material),
      paymentId: payment.id,
      payer: payment.payer,
    };
  }

  async function mutate(operation) {
    let result;
    queue = queue.then(async () => {
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      await chmod(dataDir, 0o700).catch(() => {});
      const currentTime = now();
      const records = (await readStore(storePath)).filter((record) => Number(record.expiresAt) > currentTime);
      const mutation = await operation(records, currentTime);
      result = mutation.result;
      const bounded = mutation.records
        .sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
        .slice(0, maxEntries);
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
      const existing = records.find((record) => record.key === binding.key);
      if (!existing) return { records, result: { kind: "miss" } };
      if (existing.fingerprint !== binding.fingerprint) {
        return { records, result: { kind: "conflict" } };
      }
      return { records, result: { kind: "hit", record: existing } };
    });
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
      fingerprint: binding.fingerprint,
      createdAt,
      expiresAt: createdAt + ttlMs,
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

  async function middleware(req, res, next) {
    if (!routes.has(req.path)) return next();
    const binding = bindingFor({ method: req.method, url: publicRequestUrl(req), headers: req.headers });
    if (!binding) return next();

    const cached = await lookup(binding);
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
        return originalEnd(chunk, encoding, callback);
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
    return next();
  }

  return {
    middleware,
    bindingFor,
    lookup,
    store,
    storageStatus,
    flush: () => queue,
    storePath,
  };
}
