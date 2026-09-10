// extract.mjs — the paid service: URL -> clean structured data, in one reliable call.
// Zero dependencies beyond Zod for the MCP success output contract. Value sold to AI
// agents on x402: hand it a messy URL, get back clean text + ALL structured data
// (JSON-LD/OG/meta/headings/links) + AI-crawler signals, with redirects, timeouts, size
// caps and errors handled. Saves agents the fetch+parse+guard work.

import { z } from "zod";
import {
  EXTRACT_UA,
  EXTRACT_MAX_BODY_BYTES,
  EXTRACT_TIMEOUT_MS,
  EXTRACT_TEXT_EXCERPT_CHARS,
  READ_MARKDOWN_MAX_CHARS,
  decodeHttpBody,
  classifyHttpStatus,
  buildCapture,
  concatBytes,
  resolveExtractFetch,
  resolveExtractTimeoutMs,
} from "./extract-capture.mjs";

const UA = EXTRACT_UA;
const MAX_BYTES = EXTRACT_MAX_BODY_BYTES;
const TIMEOUT_MS = EXTRACT_TIMEOUT_MS;

function decodeEntities(s = '') {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
const clean = (s = '') => decodeEntities(s.replace(/\s+/g, ' ').trim());

function metaTags(html) {
  const out = {};
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const key = (tag.match(/\b(?:name|property|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (key && val != null) out[key.toLowerCase()] = clean(val);
  }
  return out;
}

function jsonLdBlocks(html) {
  const blocks = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { blocks.push(JSON.parse(m[1].trim())); }
    catch { /* skip malformed */ }
  }
  return blocks;
}

function headings(html) {
  const grab = (tag) => {
    const out = [];
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    let m;
    while ((m = re.exec(html)) && out.length < 25) {
      const t = clean(m[1].replace(/<[^>]+>/g, ' '));
      if (t) out.push(t);
    }
    return out;
  };
  return { h1: grab('h1'), h2: grab('h2') };
}

function textExcerpt(html, max = EXTRACT_TEXT_EXCERPT_CHARS) {
  let body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const full = clean(body.replace(/<[^>]+>/g, ' '));
  return { text: full.slice(0, max), textTruncated: full.length > max };
}

function links(html, base) {
  const set = new Set();
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) && set.size < 50) {
    try { set.add(new URL(m[1], base).href); } catch { /* ignore */ }
  }
  return [...set];
}

async function fetchWithGuards(url) {
  const fetchImpl = resolveExtractFetch();
  const timeoutMs = resolveExtractTimeoutMs(TIMEOUT_MS);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow', signal: ctrl.signal });
    const reader = res.body?.getReader?.();
    const chunks = [];
    let bytes = 0;
    let bodyTruncated = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const remaining = MAX_BYTES - bytes;
        if (value.byteLength > remaining) {
          if (remaining > 0) chunks.push(value.subarray(0, remaining));
          bytes += Math.max(0, remaining);
          bodyTruncated = true;
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
        bytes += value.byteLength;
        if (bytes >= MAX_BYTES) {
          bodyTruncated = true;
          await reader.cancel().catch(() => {});
          break;
        }
      }
    } else {
      const htmlFallback = await res.text();
      const encoded = new TextEncoder().encode(htmlFallback);
      if (encoded.byteLength > MAX_BYTES) {
        chunks.push(encoded.subarray(0, MAX_BYTES));
        bytes = MAX_BYTES;
        bodyTruncated = true;
      } else {
        chunks.push(encoded);
        bytes = encoded.byteLength;
      }
    }
    const raw = concatBytes(chunks);
    const contentType = res.headers.get('content-type') || null;
    const decoded = decodeHttpBody(raw, { contentType, allowHtmlMeta: true });
    return {
      res,
      html: decoded.html,
      bytes: decoded.bytes,
      bodyTruncated,
      charset: decoded.charset,
      charsetSource: decoded.charsetSource,
      contentType,
    };
  } finally { clearTimeout(t); }
}

// SSRF guard: block localhost / private ranges / non-http(s)
function assertPublicHttpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('invalid url'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http/https supported');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h === '0.0.0.0' ||
      /^(10\.|127\.|169\.254\.|192\.168\.|::1|fc00:|fe80:)/.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)) throw new Error('private/loopback host blocked');
  return u;
}

const extractErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
}).strict().nullable();

const extractCaptureSchema = z.object({
  method: z.literal("http-get-no-javascript"),
  javascriptExecuted: z.literal(false),
  maxBodyBytes: z.number().int(),
  textExcerptLimitChars: z.number().int().nullable(),
  markdownLimitChars: z.number().int().nullable(),
  bodyBytes: z.number().int().nonnegative(),
  bodyTruncated: z.boolean(),
  textTruncated: z.boolean(),
  charset: z.string().nullable(),
  charsetSource: z.enum(["content-type", "html-meta", "default-utf-8", "invalid-charset-fallback"]),
}).strict();

function identityUrls(requested, res) {
  const requestedUrl = requested;
  const finalUrl = (res?.url && String(res.url)) || requestedUrl;
  return { requestedUrl, finalUrl, url: finalUrl };
}

export async function extract(rawUrl) {
  const u = assertPublicHttpUrl(rawUrl);
  const fetched = await fetchWithGuards(u.href);
  const { res, html } = fetched;
  const meta = metaTags(html);
  const ld = jsonLdBlocks(html);
  const title = clean((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || meta['og:title'] || '');
  const og = Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith('og:')));
  const tw = Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith('twitter:')));
  const canonical = (html.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i) || [])[1] || null;
  const ids = identityUrls(u.href, res);
  const classified = classifyHttpStatus(res.status);
  const excerpt = textExcerpt(html);
  const textTruncated = excerpt.textTruncated || fetched.bodyTruncated;

  return {
    ok: true,
    requestedUrl: ids.requestedUrl,
    finalUrl: ids.finalUrl,
    url: ids.url,
    status: res.status,
    sourceOk: classified.sourceOk,
    error: classified.error,
    contentType: fetched.contentType,
    title,
    description: meta.description || og['og:description'] || tw['twitter:description'] || null,
    canonical,
    lang: (html.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i) || [])[1] || null,
    openGraph: og,
    twitter: tw,
    jsonLd: ld,
    headings: headings(html),
    links: links(html, ids.finalUrl),
    text: excerpt.text,
    aiReadiness: {
      hasJsonLd: ld.length > 0,
      hasOpenGraph: Object.keys(og).length > 0,
      hasTitle: !!title,
      hasDescription: !!(meta.description || og['og:description']),
      hasCanonical: !!canonical,
      schemaTypes: ld.flatMap(b => [].concat(b['@type'] || b?.['@graph']?.map(g => g['@type']) || [])).filter(Boolean),
    },
    capture: buildCapture({
      textExcerptLimitChars: EXTRACT_TEXT_EXCERPT_CHARS,
      markdownLimitChars: null,
      bodyBytes: fetched.bytes,
      bodyTruncated: fetched.bodyTruncated,
      textTruncated,
      charset: fetched.charset,
      charsetSource: fetched.charsetSource,
    }),
    fetchedAt: new Date().toISOString(),
  };
}

// MCP tools/call success body only. Errors and unpaid 402 challenges stay outside this
// contract: handler throws become unstructured isError results, and payment wrappers
// return payment-required challenges without claiming a typed extract success.
// ok remains true when this merchant produced a typed extract record after payment.
// Source HTTP refusal is sourceOk=false plus error; it is not identical to an empty 200.
export const extractMcpOutputSchema = z.object({
  ok: z.literal(true),
  requestedUrl: z.string(),
  finalUrl: z.string(),
  url: z.string(),
  status: z.number().int(),
  sourceOk: z.boolean(),
  error: extractErrorSchema,
  contentType: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  canonical: z.string().nullable(),
  lang: z.string().nullable(),
  openGraph: z.record(z.string()),
  twitter: z.record(z.string()),
  jsonLd: z.array(z.unknown()),
  headings: z.object({
    h1: z.array(z.string()),
    h2: z.array(z.string()),
  }).strict(),
  links: z.array(z.string()),
  text: z.string(),
  aiReadiness: z.object({
    hasJsonLd: z.boolean(),
    hasOpenGraph: z.boolean(),
    hasTitle: z.boolean(),
    hasDescription: z.boolean(),
    hasCanonical: z.boolean(),
    // @type may be a string or string[]; the extractor concat/flatMap can leave nested
    // arrays, so do not overclaim a string-only list.
    schemaTypes: z.array(z.unknown()),
  }).strict(),
  capture: extractCaptureSchema,
  fetchedAt: z.string().datetime(),
}).strict();

// --- /read : full page content as clean Markdown (LLM-ready context) ---
function htmlToMarkdown(html) {
  let body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  // drop non-content regions
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // structural -> markdown
  body = body
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n\n# ${clean(t.replace(/<[^>]+>/g, " "))}\n\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n\n## ${clean(t.replace(/<[^>]+>/g, " "))}\n\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n\n### ${clean(t.replace(/<[^>]+>/g, " "))}\n\n`)
    .replace(/<h[4-6]\b[^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_, t) => `\n\n#### ${clean(t.replace(/<[^>]+>/g, " "))}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${clean(t.replace(/<[^>]+>/g, " "))}`)
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
      const txt = clean(t.replace(/<[^>]+>/g, " "));
      return txt ? `[${txt}](${href})` : "";
    })
    .replace(/<(p|div|section|article|br|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  // tidy
  return decodeEntities(body)
    .split("\n").map(l => l.replace(/[ \t]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export async function readMarkdown(rawUrl, maxChars = READ_MARKDOWN_MAX_CHARS) {
  const u = assertPublicHttpUrl(rawUrl);
  const fetched = await fetchWithGuards(u.href);
  const { res, html } = fetched;
  const title = clean((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  let md = htmlToMarkdown(html);
  const truncated = md.length > maxChars || fetched.bodyTruncated;
  if (md.length > maxChars) md = md.slice(0, maxChars);
  const ids = identityUrls(u.href, res);
  const classified = classifyHttpStatus(res.status);
  return {
    ok: true,
    requestedUrl: ids.requestedUrl,
    finalUrl: ids.finalUrl,
    url: ids.url,
    status: res.status,
    sourceOk: classified.sourceOk,
    error: classified.error,
    title,
    markdown: md,
    wordCount: md.split(/\s+/).filter(Boolean).length,
    truncated,
    capture: buildCapture({
      textExcerptLimitChars: null,
      markdownLimitChars: maxChars,
      bodyBytes: fetched.bytes,
      bodyTruncated: fetched.bodyTruncated,
      textTruncated: truncated,
      charset: fetched.charset,
      charsetSource: fetched.charsetSource,
    }),
    fetchedAt: new Date().toISOString(),
  };
}

export const readMcpOutputSchema = z.object({
  ok: z.literal(true),
  requestedUrl: z.string(),
  finalUrl: z.string(),
  url: z.string(),
  status: z.number().int(),
  sourceOk: z.boolean(),
  error: extractErrorSchema,
  title: z.string(),
  markdown: z.string(),
  wordCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  capture: extractCaptureSchema,
  fetchedAt: z.string().datetime(),
}).strict();

// Re-export low-level helpers so sibling services (enrich.mjs) reuse the same
// SSRF guard + fetch + parse instead of duplicating them.
export { assertPublicHttpUrl, fetchWithGuards, metaTags, jsonLdBlocks, headings, clean, decodeEntities };

// CLI smoke test: node extract.mjs https://example.com
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] || 'https://example.com';
  extract(url).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error('ERR', e.message); process.exit(1); });
}
