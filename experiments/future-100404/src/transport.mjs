import { performance } from "node:perf_hooks";
import { assert, checkedJson, digest, hash } from "./value.mjs";
import { digestResponseBytes } from "../upstream/digest.mjs";

export function serviceOrigin(raw, { allowLoopback = false } = {}) {
  assert(typeof raw === "string" && raw.length <= 240, "origin_required");
  let url;
  try { url = new URL(raw); } catch { assert(false, "origin_rejected"); }
  assert(!url.username && !url.password && !url.search && !url.hash && url.pathname === "/", "origin_rejected");
  const publicOrigin = url.origin === "https://agents.samedaydesk.com";
  const loopback = allowLoopback && url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname);
  assert(publicOrigin || loopback, "origin_rejected");
  assert(raw === url.origin || raw === `${url.origin}/`, "origin_noncanonical");
  return url.origin;
}

export function operationBudget(contract, { signal, now = () => Date.now() } = {}) {
  const started = performance.now();
  const controller = new AbortController();
  const deadlineMs = contract.expectations.deadlineMs;
  let bytes = 0; let requests = 0; let stopped = null;
  const abort = () => { stopped = "cancelled"; controller.abort(); };
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { stopped = "deadline"; controller.abort(); }, deadlineMs);
  timer.unref?.();
  return {
    signal: controller.signal, now,
    elapsed: () => Math.max(0, performance.now() - started),
    reason: () => stopped,
    remainingBytes: () => contract.expectations.maxResponseBytes - bytes,
    charge(n) { bytes += n; assert(bytes <= contract.expectations.maxResponseBytes, "response_bytes_exceeded"); },
    admit() { assert(!controller.signal.aborted && performance.now() - started < deadlineMs, stopped || "deadline"); assert(++requests <= 4, "request_count_exceeded"); },
    close() { clearTimeout(timer); signal?.removeEventListener("abort", abort); },
  };
}

export async function fetchJson(origin, route, { method = "GET", input = null, grant = null, budget, fetcher = fetch } = {}) {
  const before = budget.elapsed();
  let status = null; let attempted = false; let reader = null;
  const base = () => ({
    method, route, attempted, status, elapsedMs: Math.max(0, budget.elapsed() - before),
    observedAt: new Date(budget.now()).toISOString(), body: null, bodyDigest: null, wireDigest: null,
    evidenceClass: "requester_observed_http_bytes",
  });
  try {
    budget.admit();
    const headers = { accept: "application/json", "cache-control": "no-cache" };
    if (input !== null) headers["content-type"] = "application/json";
    if (grant !== null) { assert(/^[a-f0-9]{64}$/.test(grant), "existing_grant_required"); headers["x-samedaydesk-result-grant"] = grant; }
    attempted = true;
    const res = await fetcher(`${origin}${route}`, {
      method, headers, body: input === null ? undefined : JSON.stringify(input),
      redirect: "manual", signal: budget.signal, credentials: "omit",
    });
    status = res.status;
    assert(Number.isInteger(status) && status >= 100 && status <= 599, "invalid_http_status");
    if (status >= 300 && status < 400) {
      await res.body?.cancel();
      return { ...base(), state: "unavailable", reason: "redirect_refused", bytes: 0 };
    }
    const declared = res.headers.get("content-length");
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > budget.remainingBytes()) {
      await res.body?.cancel();
      return { ...base(), state: "partial", reason: "response_bytes_exceeded", bytes: 0 };
    }
    reader = res.body?.getReader();
    const chunks = []; let length = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      budget.charge(value.byteLength); length += value.byteLength;
      chunks.push(Buffer.from(value));
    }
    const encoded = Buffer.concat(chunks, length);
    if (!encoded.length) return { ...base(), state: "unknown", reason: "missing_response_body", bytes: 0 };
    if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(res.headers.get("content-type") || "")) {
      return { ...base(), state: "unknown", reason: "unsupported_content", bytes: length };
    }
    let body;
    try { body = checkedJson(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encoded)), 512 * 1024); }
    catch { return { ...base(), state: "unknown", reason: "malformed_response", bytes: length }; }
    return {
      ...base(), state: "received", reason: null, body, bodyDigest: digest(body), wireDigest: digestResponseBytes(encoded), bytes: length,
    };
  } catch (error) {
    const reason = budget.reason() || (error?.code === "response_bytes_exceeded" ? error.code : "transport_unavailable");
    return { ...base(), state: reason === "response_bytes_exceeded" ? "partial" : "unavailable", reason, bytes: 0 };
  } finally {
    if (reader) { try { await reader.cancel(); } catch { /* stopped response */ } }
  }
}
