import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { assertPublicHttpUrl } from "./url-guard.mjs";
import { publicFetch } from "./public-fetch.mjs";
import { decodeHttpBody } from "../extract-capture.mjs";

export async function loadSource(source, options = {}) {
  const { fixtureRoot, allowLive = false, maxBytes = 1_000_000, timeoutMs = 8000,
    maxRedirects = 3, fetchImpl = publicFetch, beforeRequest = async () => {} } = options;
  const provenance = { transport: "none", requestedAt: new Date().toISOString() };
  const fail = (code, error, status = "failure", bytes = 0) => ({
    ok: false, status, code, error, bytes,
    provenance: { ...provenance, byteLength: bytes, completedAt: new Date().toISOString() },
  });
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16_000_000 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    return fail("invalid_limits", "invalid transport limits");
  }
  if (typeof source !== "string" || !source.trim()) return fail("missing_source", "missing source");
  source = source.trim();
  provenance.source = source;
  if (source.startsWith("fixture:")) {
    provenance.transport = "fixture";
    if (!fixtureRoot) return fail("fixture_root_missing", "fixtureRoot required");
    const rel = source.slice(8).replace(/^\/+/, "");
    if (!rel || rel.split(/[\\/]/).includes("..")) return fail("invalid_fixture_path", "invalid fixture path");
    let handle;
    try {
      const root = await fs.realpath(fixtureRoot);
      const abs = await fs.realpath(path.resolve(root, rel));
      if (!abs.startsWith(root + path.sep)) return fail("invalid_fixture_path", "fixture escapes root");
      await beforeRequest();
      handle = await fs.open(abs, constants.O_RDONLY | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile()) return fail("fixture_read_error", "fixture must be a regular file");
      if (stat.size > maxBytes) return fail("oversized_body", `body ${stat.size} bytes exceeds maxBytes ${maxBytes}`);
      const buffer = Buffer.alloc(maxBytes);
      let bytes = 0;
      while (bytes < maxBytes) {
        const read = await handle.read(buffer, bytes, maxBytes - bytes, null);
        if (!read.bytesRead) break;
        bytes += read.bytesRead;
      }
      if ((await handle.stat()).size > maxBytes) return fail("oversized_body", "fixture grew beyond limit", "failure", bytes);
      const finalUrl = `https://fixture.invalid/${rel.replace(/\\/g, "/")}`;
      return { ok: true, status: "ok", body: buffer.subarray(0, bytes).toString("utf8"), bytes,
        finalUrl, httpStatus: 200, redirects: [], provenance: { ...provenance, path: abs,
          finalUrl, byteLength: bytes, completedAt: new Date().toISOString() } };
    } catch (err) {
      return fail(err.code === "ENOENT" ? "missing_source" : err.code || "fixture_read_error", err.message);
    } finally { await handle?.close(); }
  }
  provenance.transport = "live";
  if (!allowLive) return fail("live_disabled", "live http(s) reads require allowLive=true");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let bytes = 0;
  let sent = false;
  try {
    let current = assertPublicHttpUrl(source);
    provenance.redirects = [];
    for (let hop = 0; hop <= maxRedirects; hop++) {
      provenance.finalUrl = current.href;
      await beforeRequest();
      ctrl.signal.throwIfAborted();
      sent = true;
      const res = await fetchImpl(current.href, { method: "GET", redirect: "manual",
        headers: { "user-agent": "PilotBatchExtract/C1", accept: "text/html,*/*", "accept-encoding": "identity" },
        signal: ctrl.signal });
      provenance.httpStatus = res.status;
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        await res.body?.cancel?.();
        const loc = res.headers.get("location");
        if (!loc) return fail("redirect_missing_location", "redirect without Location");
        if (hop === maxRedirects) return fail("redirect_limit", "redirect ceiling exhausted");
        const next = assertPublicHttpUrl(new URL(loc, current).href);
        provenance.redirects.push({ from: current.href, to: next.href, status: res.status });
        current = next;
        continue;
      }
      provenance.contentType = res.headers.get("content-type");
      const encoding = res.headers.get("content-encoding");
      if (encoding && encoding !== "identity") {
        await res.body?.cancel?.();
        return fail("unsupported_encoding", "compressed responses unsupported");
      }
      if (Number(res.headers.get("content-length")) > maxBytes) {
        await res.body?.cancel?.();
        return fail("oversized_body", "declared body exceeds byte limit");
      }
      const reader = res.body?.getReader?.();
      if (!reader) return fail("invalid_response", "streaming response body required");
      const chunks = [];
      let bodyTruncated = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = maxBytes - bytes;
        if (value.byteLength > remaining) {
          if (remaining > 0) chunks.push(value.subarray(0, remaining));
          bytes += Math.max(0, remaining);
          bodyTruncated = true;
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
        bytes += value.byteLength;
      }
      const decoded = decodeHttpBody(Buffer.concat(chunks), {
        contentType: provenance.contentType,
        allowHtmlMeta: true,
      });
      const provenanceOut = {
        ...provenance,
        byteLength: bytes,
        charset: decoded.charset,
        charsetSource: decoded.charsetSource,
        bodyTruncated,
        completedAt: new Date().toISOString(),
      };
      if (bodyTruncated) {
        return {
          ok: true, status: "ok", body: decoded.html, bytes, bodyTruncated: true,
          finalUrl: current.href, httpStatus: res.status, redirects: provenance.redirects,
          provenance: provenanceOut,
        };
      }
      return { ok: true, status: "ok", body: decoded.html, bytes, bodyTruncated: false,
        finalUrl: current.href, httpStatus: res.status, redirects: provenance.redirects,
        provenance: provenanceOut };
    }
  } catch (err) {
    const code = typeof err.code === "string" ? err.code : "fetch_error";
    const known = code === "ssrf_blocked" || code.startsWith("invalid_") || code.startsWith("exhausted_budget_");
    return fail(ctrl.signal.aborted ? "timeout_or_abort" : code, err.message,
      known || !sent ? "failure" : "unknown", bytes);
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}
