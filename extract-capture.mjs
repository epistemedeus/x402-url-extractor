/**
 * Shared capture/decode helpers for single-URL extract/read and batch transport.
 * Labels the actual no-JS HTTP capture. Does not claim discussion completeness.
 */

export const EXTRACT_UA = "Mozilla/5.0 (compatible; SameDayDeskExtractor/1.0; +https://samedaydesk.com)";
export const EXTRACT_MAX_BODY_BYTES = 3_000_000;
export const EXTRACT_TIMEOUT_MS = 12_000;
export const EXTRACT_TEXT_EXCERPT_CHARS = 1200;
export const READ_MARKDOWN_MAX_CHARS = 40_000;

const CHARSET_ALIASES = Object.freeze({
  utf8: "utf-8",
  "utf-8": "utf-8",
  unicode: "utf-8",
  "us-ascii": "utf-8",
  ascii: "utf-8",
  latin1: "iso-8859-1",
  "latin-1": "iso-8859-1",
  "iso-8859-1": "iso-8859-1",
  "iso8859-1": "iso-8859-1",
  "windows-1252": "windows-1252",
  "cp1252": "windows-1252",
  "windows-1251": "windows-1251",
  "iso-8859-2": "iso-8859-2",
  "shift_jis": "shift_jis",
  "euc-jp": "euc-jp",
  "gbk": "gbk",
  "gb2312": "gbk",
  "big5": "big5",
});

export const CAPTURE_CHARSET_SOURCES = Object.freeze([
  "content-type",
  "html-meta",
  "default-utf-8",
  "invalid-charset-fallback",
]);

function normalizeCharset(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase().replace(/_/g, "-");
  return CHARSET_ALIASES[key] || key;
}

export function parseCharsetFromContentType(contentType) {
  if (!contentType) return null;
  const match = String(contentType).match(/charset\s*=\s*["']?([^"';\s]+)/i);
  return match ? normalizeCharset(match[1]) : null;
}

export function parseCharsetFromHtmlBytes(bytes) {
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 4096))).toString("latin1");
  const charset = head.match(/<meta\b[^>]*\bcharset\s*=\s*["']?\s*([^\s"'>;]+)/i)
    || head.match(/<meta\b[^>]*http-equiv\s*=\s*["']content-type["'][^>]*content\s*=\s*["'][^"']*charset=([^\s"';]+)/i)
    || head.match(/<meta\b[^>]*content\s*=\s*["'][^"']*charset=([^\s"';]+)[^"']*["'][^>]*http-equiv\s*=\s*["']content-type["']/i);
  return charset ? normalizeCharset(charset[1]) : null;
}

function decoderLabel(charset) {
  try {
    return new TextDecoder(charset).encoding ? charset : charset;
  } catch {
    return null;
  }
}

export function decodeHttpBody(bytes, { contentType, allowHtmlMeta = true } = {}) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let charset = parseCharsetFromContentType(contentType);
  let charsetSource = charset ? "content-type" : null;
  if (!charset && allowHtmlMeta && buffer.byteLength) {
    charset = parseCharsetFromHtmlBytes(buffer);
    if (charset) charsetSource = "html-meta";
  }
  if (!charset) {
    charset = "utf-8";
    charsetSource = "default-utf-8";
  }
  const supported = decoderLabel(charset);
  if (!supported) {
    charset = "utf-8";
    charsetSource = "invalid-charset-fallback";
  }
  const html = new TextDecoder(charset, { fatal: false }).decode(buffer);
  return { html, charset, charsetSource, bytes: buffer.byteLength };
}

export function classifyHttpStatus(status) {
  const code = Number(status);
  if (!Number.isInteger(code) || code < 100 || code > 599) {
    return {
      sourceOk: false,
      error: { code: "invalid_status", message: "source HTTP status missing or invalid" },
    };
  }
  if (code >= 200 && code < 300) {
    return { sourceOk: true, error: null };
  }
  const kind = code === 429 ? "source rate-limited" : code >= 500 ? "source error" : "source refused";
  return {
    sourceOk: false,
    error: { code: `http_${code}`, message: `${kind}: HTTP ${code}` },
  };
}

export function buildCapture({
  maxBodyBytes = EXTRACT_MAX_BODY_BYTES,
  textExcerptLimitChars = EXTRACT_TEXT_EXCERPT_CHARS,
  markdownLimitChars = null,
  bodyBytes = 0,
  bodyTruncated = false,
  textTruncated = false,
  charset = "utf-8",
  charsetSource = "default-utf-8",
} = {}) {
  return {
    method: "http-get-no-javascript",
    javascriptExecuted: false,
    maxBodyBytes,
    textExcerptLimitChars,
    markdownLimitChars,
    bodyBytes,
    bodyTruncated: Boolean(bodyTruncated),
    textTruncated: Boolean(textTruncated),
    charset: charset || null,
    charsetSource: CAPTURE_CHARSET_SOURCES.includes(charsetSource) ? charsetSource : "default-utf-8",
  };
}

export function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function resolveExtractFetch() {
  return globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ || globalThis.fetch;
}

export function resolveExtractTimeoutMs(fallback = EXTRACT_TIMEOUT_MS) {
  const override = globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
  if (Number.isSafeInteger(override) && override >= 1 && override <= 60_000) return override;
  return fallback;
}

export function fetchFailureCode(error) {
  if (error?.name === "AbortError" || error?.code === "ABORT_ERR") return "timeout";
  return typeof error?.code === "string" && error.code ? error.code : "fetch_error";
}
