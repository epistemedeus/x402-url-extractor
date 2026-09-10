import assert from "node:assert/strict";
import test from "node:test";

import { extract, extractMcpOutputSchema, readMarkdown, readMcpOutputSchema } from "./extract.mjs";
import { EXTRACT_MAX_BODY_BYTES, EXTRACT_TEXT_EXCERPT_CHARS } from "./extract-capture.mjs";

function htmlResponse(html, {
  status = 200,
  url = "https://fixture.example/",
  contentType = "text/html; charset=utf-8",
  bytes,
} = {}) {
  const body = bytes || new TextEncoder().encode(html);
  return {
    status,
    url,
    headers: {
      get: (name) => (String(name).toLowerCase() === "content-type" ? contentType : null),
    },
    body: {
      getReader() {
        let done = false;
        return {
          async read() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: body };
          },
          async cancel() {},
        };
      },
    },
  };
}

function installExtractFetch(fixtures) {
  const original = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input, init) => {
    const target = String(typeof input === "string" || input instanceof URL ? input : input.url);
    const hit = fixtures[target] || fixtures["*"];
    if (!hit) throw new Error(`unexpected fetch ${target}`);
    return typeof hit === "function" ? hit(target, init) : hit;
  };
  return () => {
    if (original === undefined) delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
    else globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = original;
  };
}

test("200 meaningful extract is typed, sourceOk, and labels the no-JS excerpt cap", async () => {
  const restore = installExtractFetch({
    "https://ok.example/": htmlResponse("<html lang=\"en\"><head><title>OK</title></head><body><p>hello</p></body></html>", { url: "https://ok.example/" }),
  });
  try {
    const result = await extract("https://ok.example/");
    assert.equal(extractMcpOutputSchema.safeParse(result).success, true);
    assert.equal(result.ok, true);
    assert.equal(result.sourceOk, true);
    assert.equal(result.error, null);
    assert.equal(result.status, 200);
    assert.equal(result.requestedUrl, "https://ok.example/");
    assert.equal(result.finalUrl, "https://ok.example/");
    assert.equal(result.url, "https://ok.example/");
    assert.equal(result.text, "hello");
    assert.equal(result.capture.method, "http-get-no-javascript");
    assert.equal(result.capture.javascriptExecuted, false);
    assert.equal(result.capture.textExcerptLimitChars, EXTRACT_TEXT_EXCERPT_CHARS);
    assert.equal(result.capture.bodyTruncated, false);
    assert.equal(result.capture.textTruncated, false);
    assert.equal(result.capture.charsetSource, "content-type");
  } finally {
    restore();
  }
});

test("empty 200 is not identical to 403/404 with block text", async () => {
  const restore = installExtractFetch({
    "https://empty.example/": htmlResponse("", { url: "https://empty.example/", contentType: null }),
    "https://403.example/": htmlResponse("<html><body><h1>Access Denied</h1><p>Cloudflare block page that looks meaningful.</p></body></html>", { status: 403, url: "https://403.example/" }),
    "https://404.example/": htmlResponse("<html><body><h1>Not Found</h1><p>helpful looking missing-page copy</p></body></html>", { status: 404, url: "https://404.example/" }),
  });
  try {
    const empty = await extract("https://empty.example/");
    const blocked = await extract("https://403.example/");
    const missing = await extract("https://404.example/");
    assert.equal(extractMcpOutputSchema.safeParse(empty).success, true);
    assert.equal(extractMcpOutputSchema.safeParse(blocked).success, true);
    assert.equal(empty.ok, true);
    assert.equal(blocked.ok, true);
    assert.equal(empty.status, 200);
    assert.equal(empty.sourceOk, true);
    assert.equal(empty.error, null);
    assert.equal(empty.text, "");
    assert.equal(blocked.status, 403);
    assert.equal(blocked.sourceOk, false);
    assert.equal(blocked.error.code, "http_403");
    assert.match(blocked.text, /Access Denied/);
    assert.equal(missing.status, 404);
    assert.equal(missing.sourceOk, false);
    assert.equal(missing.error.code, "http_404");
    assert.match(missing.text, /helpful looking/);
  } finally {
    restore();
  }
});

test("204, 429, and 5xx retain source status separately from merchant ok", async () => {
  const restore = installExtractFetch({
    "https://204.example/": htmlResponse("", { status: 204, url: "https://204.example/" }),
    "https://429.example/": htmlResponse("rate limited", { status: 429, url: "https://429.example/", contentType: "text/plain" }),
    "https://500.example/": htmlResponse("<html><body>internal error</body></html>", { status: 500, url: "https://500.example/" }),
  });
  try {
    const empty = await extract("https://204.example/");
    const limited = await extract("https://429.example/");
    const failed = await extract("https://500.example/");
    assert.equal(empty.ok, true);
    assert.equal(empty.status, 204);
    assert.equal(empty.sourceOk, true);
    assert.equal(empty.error, null);
    assert.equal(empty.text, "");
    assert.equal(limited.status, 429);
    assert.equal(limited.sourceOk, false);
    assert.equal(limited.error.code, "http_429");
    assert.match(limited.text, /rate limited/);
    assert.equal(failed.status, 500);
    assert.equal(failed.sourceOk, false);
    assert.equal(failed.error.code, "http_500");
  } finally {
    restore();
  }
});

test("redirect preserves requested URL identity and observed final URL", async () => {
  const restore = installExtractFetch({
    "https://start.example/": htmlResponse("<html><head><title>Final</title></head><body><p>after redirect</p></body></html>", {
      status: 200,
      url: "https://end.example/page",
    }),
  });
  try {
    const result = await extract("https://start.example/");
    assert.equal(result.requestedUrl, "https://start.example/");
    assert.equal(result.finalUrl, "https://end.example/page");
    assert.equal(result.url, "https://end.example/page");
    assert.equal(result.status, 200);
    assert.equal(result.sourceOk, true);
  } finally {
    restore();
  }
});

test("text excerpt and oversized bodies are labeled truncated rather than complete", async () => {
  const restore = installExtractFetch({
    "https://trunc.example/": htmlResponse(`<html><body>${"word ".repeat(800)}</body></html>`, { url: "https://trunc.example/" }),
    "https://huge.example/": async () => {
      const chunk = new Uint8Array(400_000).fill(65);
      let n = 0;
      return {
        status: 200,
        url: "https://huge.example/",
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html" : null) },
        body: {
          getReader() {
            return {
              async read() {
                if (n >= 10) return { done: true };
                n += 1;
                return { done: false, value: chunk };
              },
              async cancel() {},
            };
          },
        },
      };
    },
  });
  try {
    const excerpted = await extract("https://trunc.example/");
    assert.equal(excerpted.text.length, EXTRACT_TEXT_EXCERPT_CHARS);
    assert.equal(excerpted.capture.textTruncated, true);
    assert.equal(excerpted.capture.bodyTruncated, false);
    const huge = await extract("https://huge.example/");
    assert.equal(huge.ok, true);
    assert.equal(huge.status, 200);
    assert.equal(huge.capture.bodyTruncated, true);
    assert.equal(huge.capture.bodyBytes, EXTRACT_MAX_BODY_BYTES);
    assert.equal(huge.capture.textTruncated, true);
  } finally {
    restore();
  }
});

test("charset is taken from Content-Type, then HTML meta, else UTF-8", async () => {
  const cafe1252 = Uint8Array.from([
    ...new TextEncoder().encode("<html><body>caf"),
    0xe9,
    ...new TextEncoder().encode("</body></html>"),
  ]);
  const cafeMeta = Uint8Array.from([
    ...new TextEncoder().encode("<html><head><meta charset=\"windows-1252\"></head><body>caf"),
    0xe9,
    ...new TextEncoder().encode("</body></html>"),
  ]);
  const restore = installExtractFetch({
    "https://cp1252.example/": htmlResponse("", {
      url: "https://cp1252.example/",
      contentType: "text/html; charset=windows-1252",
      bytes: cafe1252,
    }),
    "https://meta.example/": htmlResponse("", {
      url: "https://meta.example/",
      contentType: "text/html",
      bytes: cafeMeta,
    }),
  });
  try {
    const headered = await extract("https://cp1252.example/");
    assert.equal(headered.capture.charset, "windows-1252");
    assert.equal(headered.capture.charsetSource, "content-type");
    assert.match(headered.text, /caf/);
    const meta = await extract("https://meta.example/");
    assert.equal(meta.capture.charset, "windows-1252");
    assert.equal(meta.capture.charsetSource, "html-meta");
    assert.match(meta.text, /caf/);
  } finally {
    restore();
  }
});

test("timeout throws instead of a silent empty success", async () => {
  const previousTimeout = globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
  globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = 20;
  const restore = installExtractFetch({
    "https://slow.example/": async (_url, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      }, { once: true });
    }),
  });
  try {
    await assert.rejects(() => extract("https://slow.example/"), /abort/i);
  } finally {
    restore();
    if (previousTimeout === undefined) delete globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
    else globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = previousTimeout;
  }
});

test("comment text only inside a script JSON island is not treated as proven absent", async () => {
  const known = "Independent reproduction, plus a data point that separates the two open fixes.";
  const html = `<html><head><title>Issue</title></head><body><p>opener only</p><script type="application/json">${JSON.stringify({ comments: [{ author: "Bit0ps", body: known }] })}</script></body></html>`;
  const restore = installExtractFetch({
    "https://discuss.example/issue/2": htmlResponse(html, { url: "https://discuss.example/issue/2" }),
  });
  try {
    const excerpted = await extract("https://discuss.example/issue/2");
    const markdown = await readMarkdown("https://discuss.example/issue/2");
    assert.equal(excerpted.text.includes(known), false);
    assert.equal(markdown.markdown.includes(known), false);
    assert.equal(excerpted.capture.javascriptExecuted, false);
    assert.equal(excerpted.capture.method, "http-get-no-javascript");
    assert.equal(excerpted.sourceOk, true);
  } finally {
    restore();
  }
});

test("no-JS extract excerpt may omit later discussion text that /read still captures, without claiming completeness", async () => {
  const known = "Bit0ps independently reproduced the empty 404 markdown case";
  const html = `<html><head><title>Issue 99533</title></head><body><article>${"intro ".repeat(400)}</article><div class="timeline-comment"><p>${known}</p></div></body></html>`;
  const restore = installExtractFetch({
    "https://discuss.example/issue/1": htmlResponse(html, { url: "https://discuss.example/issue/1" }),
  });
  try {
    const excerpted = await extract("https://discuss.example/issue/1");
    const markdown = await readMarkdown("https://discuss.example/issue/1");
    assert.equal(excerpted.capture.javascriptExecuted, false);
    assert.equal(excerpted.capture.textTruncated, true);
    assert.equal(excerpted.text.includes(known), false);
    assert.equal(markdown.markdown.includes(known), true);
    assert.equal(markdown.capture.method, "http-get-no-javascript");
    assert.equal(markdown.truncated, false);
  } finally {
    restore();
  }
});

test("read markdown keeps truncated plus capture identity fields", async () => {
  const restore = installExtractFetch({
    "https://ok.example/": htmlResponse("<html><head><title>OK</title></head><body><p>hello</p></body></html>", { url: "https://ok.example/" }),
    "https://start.example/": htmlResponse("<html><head><title>Final</title></head><body><article><p>after redirect</p></article></body></html>", {
      url: "https://end.example/page",
    }),
    "https://404.example/": htmlResponse("<html><body><p>missing</p></body></html>", { status: 404, url: "https://404.example/" }),
  });
  try {
    const page = await readMarkdown("https://ok.example/");
    assert.equal(readMcpOutputSchema.safeParse(page).success, true);
    assert.equal(page.truncated, false);
    assert.equal(page.requestedUrl, "https://ok.example/");
    const redirected = await readMarkdown("https://start.example/");
    assert.equal(redirected.requestedUrl, "https://start.example/");
    assert.equal(redirected.finalUrl, "https://end.example/page");
    const missing = await readMarkdown("https://404.example/");
    assert.equal(missing.sourceOk, false);
    assert.equal(missing.error.code, "http_404");
    assert.equal(missing.ok, true);
  } finally {
    restore();
  }
});
