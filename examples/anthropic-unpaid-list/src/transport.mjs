import { refusePaymentHeaders } from "./admit.mjs";
import { TRANSPORT_TIMEOUT_MS } from "./constants.mjs";
import { fail } from "./errors.mjs";

export async function boundedFetch(fetchImpl, input, init = {}, maxBytes = 64_000, timeoutMs = TRANSPORT_TIMEOUT_MS) {
  refusePaymentHeaders(init.headers);
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
      fetchImpl(input, { ...init, redirect: "error", signal: controller.signal }),
      expired,
    ]);
    observed = response;
    if (response.redirected) fail("redirect_refused", { code: "redirect_refused", exitCode: 1 });
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) {
      fail("response_too_large", { code: "response_too_large", exitCode: 1 });
    }
    const chunks = [];
    let bytes = 0;
    reader = response.body?.getReader();
    while (reader) {
      const next = await Promise.race([reader.read(), expired]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) fail("response_too_large", { code: "response_too_large", exitCode: 1 });
      chunks.push(Buffer.from(next.value));
    }
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(
      [204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks),
      { status: response.status, headers },
    );
  } catch (error) {
    controller.abort();
    reader?.cancel().catch(() => {});
    if (error?.code === "response_too_large" && observed) throw error;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function readJsonResponse(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body, bodyBytes: Buffer.byteLength(text), text };
}
