/** Bound bytes before JSON parsing, including the official client's challenge read. */
export async function boundedFetch(fetchImpl, input, init, maxBytes = 64_000, timeoutMs = 15_000) {
  const controller = new AbortController();
  let timer;
  let reader;
  let observed;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("transport_timeout"));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetchImpl(input, { ...init, redirect: "error", signal: controller.signal }), expired,
    ]);
    observed = response;
    if (response.redirected) throw new Error("redirect_refused");
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) throw new Error("response_too_large");
    for (const name of ["payment-required", "payment-response", "x-payment-response"]) {
      if ((response.headers.get(name)?.length ?? 0) > 64_000) throw new Error("payment_header_too_large");
    }
    const chunks = [];
    let bytes = 0;
    reader = response.body?.getReader();
    while (reader) {
      const next = await Promise.race([reader.read(), expired]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new Error("response_too_large");
      chunks.push(Buffer.from(next.value));
    }
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response([204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks), {
      status: response.status, headers,
    });
  } catch (error) {
    controller.abort();
    reader?.cancel().catch(() => {});
    if (error.message === "response_too_large" && observed) {
      error.response = new Response(null, { status: observed.status, headers: observed.headers });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
