import { FETCH_TIMEOUT_MS, MAX_CATALOG_BYTES } from "./constants.mjs";
import { fail } from "./errors.mjs";

const FORBIDDEN_HEADER = /^(payment-signature|payment-required|payment-response|x-payment|x-payment-response|authorization)$/i;

function headerMap(headers) {
  if (!headers) return [];
  if (headers instanceof Headers) return [...headers.entries()];
  if (Array.isArray(headers)) return headers;
  return Object.entries(headers);
}

export function assertNoPaymentHeaders(init = {}) {
  for (const [name, value] of headerMap(init.headers)) {
    if (FORBIDDEN_HEADER.test(String(name)) || (value && FORBIDDEN_HEADER.test(String(value).slice(0, 32)))) {
      fail("payment or authorization headers are refused on unpaid discovery", "payment_intent_refused", "headers");
    }
  }
}

export async function boundedGetJson(fetchImpl, url, { maxBytes = MAX_CATALOG_BYTES, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function") fail("fetch implementation is required for live discovery", "catalog_unreadable");

  const controller = new AbortController();
  let timer;
  let reader;
  let observed;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("transport_timeout"), { code: "transport_timeout" }));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchFn(url, {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json" },
        signal: controller.signal,
      }),
      expired,
    ]);
    observed = response;
    if (response.redirected) fail("redirect_refused", "redirect_refused");
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) fail("response_too_large", "response_too_large");

    const chunks = [];
    let bytes = 0;
    reader = response.body?.getReader?.();
    if (reader) {
      while (true) {
        const next = await Promise.race([reader.read(), expired]);
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maxBytes) fail("response_too_large", "response_too_large");
        chunks.push(Buffer.from(next.value));
      }
    }

    const bodyText = Buffer.concat(chunks).toString("utf8");
    return {
      status: response.status,
      headers: response.headers,
      bodyText,
    };
  } catch (error) {
    controller.abort();
    reader?.cancel?.().catch(() => {});
    if (error?.code === "response_too_large" || error?.message === "response_too_large") {
      if (observed) error.response = new Response(null, { status: observed.status, headers: observed.headers });
      fail("response_too_large", "response_too_large");
    }
    if (error?.code === "transport_timeout" || error?.message === "transport_timeout" || error?.name === "AbortError") {
      fail("transport_timeout", "transport_timeout");
    }
    if (error?.name === "UnpaidListError") throw error;
    fail(error?.message || "discovery fetch failed", "catalog_unreadable");
  } finally {
    clearTimeout(timer);
  }
}
