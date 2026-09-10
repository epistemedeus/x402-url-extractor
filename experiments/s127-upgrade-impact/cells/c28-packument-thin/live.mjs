/**
 * Optional live GET of an npm packument. Off unless mode is "live".
 * JSON only. Redirects refused. No tarball download. No npm install.
 */

import {
  DEFAULT_MAX_JSON_BYTES,
  DEFAULT_REGISTRY,
  DEFAULT_TIMEOUT_MS,
  PACKUMENT_ACCEPT,
  USER_AGENT,
} from "./constants.mjs";
import {
  isAllowedSourceUrl,
  packumentUrl,
  parseRegistryOrigin,
  PackumentError,
  versionDocumentUrl,
} from "./paths.mjs";

export async function downloadJson(url, {
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
  accept = PACKUMENT_ACCEPT,
  redirect = "manual",
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, code: "fetch_unavailable", message: "fetch implementation is not available" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect,
      signal: controller.signal,
      headers: {
        accept,
        "user-agent": USER_AGENT,
      },
    });
    const status = response.status;
    if (status >= 300 && status < 400) {
      return { ok: false, code: "redirect_refused", message: `redirect refused status ${status}`, status };
    }
    if (status === 404) {
      return { ok: false, code: "not_found", message: `HTTP 404 for ${url}`, status };
    }
    if (status !== 200) {
      return {
        ok: false,
        code: "http_error",
        message: `HTTP ${status} for ${url}`,
        status,
        retryable: status >= 500 || status === 429,
      };
    }
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      return {
        ok: false,
        code: "oversize",
        message: `content-length ${declared} exceeds ${maxBytes} bytes`,
        status,
      };
    }
    let bytes;
    if (response.body?.getReader) {
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, code: "oversize", message: `body exceeds ${maxBytes} bytes`, status };
        }
        chunks.push(Buffer.from(value));
      }
      bytes = Buffer.concat(chunks, size);
    } else {
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) {
        return { ok: false, code: "oversize", message: `body exceeds ${maxBytes} bytes`, status };
      }
    }
    const contentType = response.headers?.get?.("content-type") || null;
    return { ok: true, bytes, status, url, contentType };
  } catch (error) {
    const aborted = error?.name === "AbortError" || controller.signal.aborted;
    return {
      ok: false,
      code: aborted ? "timed_out" : "fetch_error",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
  }
}

export function liveTargetUrl(input) {
  const registry = input.registry || DEFAULT_REGISTRY;
  parseRegistryOrigin(registry);
  const name = input.name;
  if (input.document === "version") {
    const url = versionDocumentUrl(registry, name, input.version);
    if (!isAllowedSourceUrl(url, registry)) {
      throw new PackumentError(`version document URL refused: ${url}`, "url_not_allowlisted");
    }
    return { url, registry, kindHint: "version-document" };
  }
  const url = packumentUrl(registry, name);
  if (!isAllowedSourceUrl(url, registry)) {
    throw new PackumentError(`packument URL refused: ${url}`, "url_not_allowlisted");
  }
  return { url, registry, kindHint: "packument" };
}
