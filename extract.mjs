// extract.mjs — the paid service: URL -> clean structured data, in one reliable call.
// Zero dependencies. Value sold to AI agents on x402: hand it a messy URL, get back
// clean text + ALL structured data (JSON-LD/OG/meta/headings/links) + AI-crawler signals,
// with redirects, timeouts, size caps and errors handled. Saves agents the fetch+parse+guard work.

const UA = 'Mozilla/5.0 (compatible; SameDayDeskExtractor/1.0; +https://samedaydesk.com)';
const MAX_BYTES = 3_000_000; // 3MB cap
const TIMEOUT_MS = 12_000;

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

function textExcerpt(html, max = 1200) {
  let body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return clean(body).slice(0, max);
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
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow', signal: ctrl.signal });
    const reader = res.body?.getReader?.();
    let html = '', bytes = 0;
    if (reader) {
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        html += dec.decode(value, { stream: true });
        if (bytes > MAX_BYTES) { ctrl.abort(); break; }
      }
    } else {
      html = await res.text();
    }
    return { res, html };
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

export async function extract(rawUrl) {
  const u = assertPublicHttpUrl(rawUrl);
  const { res, html } = await fetchWithGuards(u.href);
  const meta = metaTags(html);
  const ld = jsonLdBlocks(html);
  const title = clean((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || meta['og:title'] || '');
  const og = Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith('og:')));
  const tw = Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith('twitter:')));
  const canonical = (html.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i) || [])[1] || null;

  return {
    ok: true,
    url: res.url || u.href,
    status: res.status,
    contentType: res.headers.get('content-type') || null,
    title,
    description: meta.description || og['og:description'] || tw['twitter:description'] || null,
    canonical,
    lang: (html.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i) || [])[1] || null,
    openGraph: og,
    twitter: tw,
    jsonLd: ld,
    headings: headings(html),
    links: links(html, res.url || u.href),
    text: textExcerpt(html),
    aiReadiness: {
      hasJsonLd: ld.length > 0,
      hasOpenGraph: Object.keys(og).length > 0,
      hasTitle: !!title,
      hasDescription: !!(meta.description || og['og:description']),
      hasCanonical: !!canonical,
      schemaTypes: ld.flatMap(b => [].concat(b['@type'] || b?.['@graph']?.map(g => g['@type']) || [])).filter(Boolean),
    },
    fetchedAt: new Date().toISOString(),
  };
}

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

export async function readMarkdown(rawUrl, maxChars = 40000) {
  const u = assertPublicHttpUrl(rawUrl);
  const { res, html } = await fetchWithGuards(u.href);
  const title = clean((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  let md = htmlToMarkdown(html);
  const truncated = md.length > maxChars;
  if (truncated) md = md.slice(0, maxChars);
  return {
    ok: true,
    url: res.url || u.href,
    status: res.status,
    title,
    markdown: md,
    wordCount: md.split(/\s+/).filter(Boolean).length,
    truncated,
    fetchedAt: new Date().toISOString(),
  };
}

// Re-export low-level helpers so sibling services (enrich.mjs) reuse the same
// SSRF guard + fetch + parse instead of duplicating them.
export { assertPublicHttpUrl, fetchWithGuards, metaTags, jsonLdBlocks, headings, clean, decodeEntities };

// CLI smoke test: node extract.mjs https://example.com
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] || 'https://example.com';
  extract(url).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error('ERR', e.message); process.exit(1); });
}
