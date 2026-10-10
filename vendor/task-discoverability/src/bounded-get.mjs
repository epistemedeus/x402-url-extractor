import { buildSearchUrl } from "./collect.mjs";
import { parseCount } from "./counts.mjs";
import { SOURCE } from "./pins.mjs";

export const LIMITS = Object.freeze({
  timeoutMs: 8000,
  maxBytes: 262144,
  maxRedirects: 3,
});

const FILTER_KEYS = ["type", "payTo", "scheme", "network", "extensions"];

function refused(url, reason, extra = {}) {
  return {
    state: "refused",
    reason,
    networkSent: false,
    credentialSent: false,
    officialLiveRead: false,
    method: "GET",
    url,
    httpStatus: null,
    bytes: null,
    elapsedMs: null,
    startedAt: null,
    completedAt: null,
    timeoutMs: LIMITS.timeoutMs,
    maxBytes: LIMITS.maxBytes,
    redirectsFollowed: 0,
    body: null,
    ...extra,
  };
}

function normalizeParams(params) {
  if (!params || typeof params.query !== "string" || params.query.trim() === "") {
    return { error: "query-required", params: null };
  }
  const next = { query: params.query };
  for (const key of FILTER_KEYS) {
    if (params[key] === undefined || params[key] === null) continue;
    if (typeof params[key] !== "string" || params[key].trim() === "") {
      return { error: `blank-filter:${key}`, params: next };
    }
    next[key] = params[key];
  }
  if (params.limit !== undefined && params.limit !== null) {
    const parsed = parseCount(params.limit);
    if (parsed.state !== "measured" || parsed.value === 0) return { error: "limit-invalid", params: next };
    next.limit = parsed.value;
  }
  if (params.cursor !== undefined && params.cursor !== null) {
    if (typeof params.cursor !== "string" || params.cursor.trim() === "") return { error: "cursor-invalid", params: next };
    next.cursor = params.cursor;
  }
  return { params: next };
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === want) return value;
  }
  return null;
}

function sameRequest(current, next) {
  return next.protocol === "https:"
    && next.host === current.host
    && next.pathname === current.pathname
    && next.search === current.search
    && next.username === ""
    && next.password === ""
    && next.hash === "";
}

function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function streamOf(response) {
  const body = response && response.body;
  if (!body || typeof body.getReader !== "function") return null;
  return body;
}

function asChunk(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

async function readStream(response, maxBytes, signal) {
  const reader = response.body.getReader();
  const onAbort = () => {
    reader.cancel("timeout").catch(() => {});
  };
  if (signal) {
    if (signal.aborted) {
      await reader.cancel("timeout");
      throw abortError();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (signal && signal.aborted) throw abortError();
      if (next.done) break;
      const chunk = asChunk(next.value);
      if (!chunk) {
        await reader.cancel("stream-failed").catch(() => {});
        const error = new Error("stream-failed");
        error.code = "stream-failed";
        throw error;
      }
      if (total + chunk.byteLength > maxBytes) {
        await reader.cancel("body-cap");
        return {
          oversized: true,
          bytes: total + chunk.byteLength,
          text: null,
          bodyBound: "stream",
        };
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
    return {
      oversized: false,
      bytes: total,
      text: Buffer.concat(chunks, total).toString("utf8"),
      bodyBound: "stream",
    };
  } catch (error) {
    if (error && (error.name === "AbortError" || error.code === "stream-failed")) {
      error.bodyBound = "stream";
      throw error;
    }
    await reader.cancel("stream-failed").catch(() => {});
    const failed = new Error("stream-failed");
    failed.code = "stream-failed";
    failed.bodyBound = "stream";
    throw failed;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

async function readBuffered(response, maxBytes) {
  let bytes;
  if (typeof response.arrayBuffer === "function") {
    bytes = Buffer.from(await response.arrayBuffer());
  } else if (typeof response.text === "function") {
    bytes = Buffer.from(String(await response.text()));
  } else {
    bytes = Buffer.alloc(0);
  }
  if (bytes.byteLength > maxBytes) {
    return { oversized: true, bytes: bytes.byteLength, text: null, bodyBound: "buffered-fallback" };
  }
  return {
    oversized: false,
    bytes: bytes.byteLength,
    text: bytes.toString("utf8"),
    bodyBound: "buffered-fallback",
  };
}

async function readBody(response, maxBytes, signal) {
  if (streamOf(response)) return readStream(response, maxBytes, signal);
  return readBuffered(response, maxBytes);
}

async function releaseUnread(response) {
  const body = response && response.body;
  if (!body || typeof body.cancel !== "function" || body.locked) return;
  try {
    await body.cancel("unread");
  } catch {
    // A closed stream has nothing left to stop.
  }
}

export async function collectBounded(params, options = {}) {
  const normalized = normalizeParams(params);
  let url = null;
  if (normalized.params) {
    try {
      url = buildSearchUrl(normalized.params, options.baseUrl);
    } catch (error) {
      return refused(null, error.code || "unverified-search-route");
    }
  }
  if (normalized.error) return refused(url, normalized.error);
  if (options.allowLive !== true) return refused(url, "live-query-not-requested");
  if (typeof options.fetchImpl !== "function") return refused(url, "fetch-not-supplied");

  const timeoutMs = options.timeoutMs || LIMITS.timeoutMs;
  const maxBytes = options.maxBytes || LIMITS.maxBytes;
  const maxRedirects = options.maxRedirects ?? LIMITS.maxRedirects;
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  let redirectsFollowed = 0;
  let current = new URL(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let networkSent = false;
  try {
    for (;;) {
      networkSent = true;
      const response = await options.fetchImpl(current.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "manual",
        signal: controller.signal,
      });
      const status = Number.isInteger(response.status) ? response.status : null;
      if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
        await releaseUnread(response);
        const location = headerGet(response.headers, "location");
        let next;
        try {
          next = new URL(String(location), current);
        } catch {
          return finish({
            state: "invalid",
            reason: "redirect-invalid",
            url: current.toString(),
            httpStatus: status,
            networkSent,
            startedAt,
            startedMs,
            redirectsFollowed,
            timeoutMs,
            maxBytes,
          });
        }
        if (!sameRequest(current, next)) {
          return finish({
            state: "refused",
            reason: "redirect-off-request",
            url: current.toString(),
            httpStatus: status,
            networkSent,
            startedAt,
            startedMs,
            redirectsFollowed,
            timeoutMs,
            maxBytes,
          });
        }
        redirectsFollowed += 1;
        if (redirectsFollowed > maxRedirects) {
          return finish({
            state: "unavailable",
            reason: "redirect-limit",
            url: current.toString(),
            httpStatus: status,
            networkSent,
            startedAt,
            startedMs,
            redirectsFollowed,
            timeoutMs,
            maxBytes,
          });
        }
        current = next;
        continue;
      }
      const bodyRead = await readBody(response, maxBytes, controller.signal);
      if (bodyRead.oversized) {
        return finish({
          state: "bounded",
          reason: "body-cap",
          url: current.toString(),
          httpStatus: status,
          bytes: bodyRead.bytes,
          bodyBound: bodyRead.bodyBound,
          networkSent,
          startedAt,
          startedMs,
          redirectsFollowed,
          timeoutMs,
          maxBytes,
        });
      }
      if (status === null || status < 200 || status >= 300) {
        return finish({
          state: status !== null && status >= 400 && status < 500 ? "refused" : "unavailable",
          reason: status === null ? "status-absent" : `http-${status}`,
          url: current.toString(),
          httpStatus: status,
          bytes: bodyRead.bytes,
          bodyBound: bodyRead.bodyBound,
          networkSent,
          startedAt,
          startedMs,
          redirectsFollowed,
          timeoutMs,
          maxBytes,
        });
      }
      let parsed;
      try {
        parsed = JSON.parse(bodyRead.text);
      } catch {
        return finish({
          state: "invalid",
          reason: "malformed-json",
          url: current.toString(),
          httpStatus: status,
          bytes: bodyRead.bytes,
          bodyBound: bodyRead.bodyBound,
          networkSent,
          startedAt,
          startedMs,
          redirectsFollowed,
          timeoutMs,
          maxBytes,
        });
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return finish({
          state: "invalid",
          reason: "schema-not-object",
          url: current.toString(),
          httpStatus: status,
          bytes: bodyRead.bytes,
          bodyBound: bodyRead.bodyBound,
          networkSent,
          startedAt,
          startedMs,
          redirectsFollowed,
          timeoutMs,
          maxBytes,
        });
      }
      return finish({
        state: "supported",
        reason: null,
        url: current.toString(),
        httpStatus: status,
        bytes: bodyRead.bytes,
        bodyBound: bodyRead.bodyBound,
        body: parsed,
        networkSent,
        startedAt,
        startedMs,
        redirectsFollowed,
        timeoutMs,
        maxBytes,
        officialLiveRead: true,
      });
    }
  } catch (error) {
    const timedOut = controller.signal.aborted
      || (error && (error.name === "TimeoutError" || error.name === "AbortError"));
    const reason = timedOut ? "timeout" : error && error.code === "stream-failed" ? "stream-failed" : "network";
    return finish({
      state: "unavailable",
      reason,
      url: current.toString(),
      bodyBound: error && error.bodyBound ? error.bodyBound : null,
      networkSent,
      startedAt,
      startedMs,
      redirectsFollowed,
      timeoutMs,
      maxBytes,
    });
  } finally {
    clearTimeout(timer);
  }
}

function finish(row) {
  const completedMs = Date.now();
  return {
    state: row.state,
    reason: row.reason,
    networkSent: row.networkSent === true,
    credentialSent: false,
    officialLiveRead: row.officialLiveRead === true,
    method: "GET",
    provider: SOURCE.repository,
    url: row.url,
    httpStatus: row.httpStatus ?? null,
    bytes: row.bytes ?? null,
    bodyBound: row.bodyBound ?? null,
    body: row.body ?? null,
    elapsedMs: completedMs - row.startedMs,
    startedAt: row.startedAt,
    completedAt: new Date(completedMs).toISOString(),
    timeoutMs: row.timeoutMs,
    maxBytes: row.maxBytes,
    redirectsFollowed: row.redirectsFollowed,
  };
}
