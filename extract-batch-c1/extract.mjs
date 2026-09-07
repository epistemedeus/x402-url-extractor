/**
 * Structured page extraction (metadata, JSON-LD, headings, links, text).
 * Adapted from the paid single-URL merchant parser shape; this module does not
 * perform network I/O — callers supply HTML via the batch transport.
 */

function decodeEntities(s = "") {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const clean = (s = "") => decodeEntities(s.replace(/\s+/g, " ").trim());

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
  const notes = [];
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let index = 0;
  while ((m = re.exec(html))) {
    index += 1;
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch (err) {
      notes.push({ field: "jsonLd", index, error: err.message || "malformed JSON-LD" });
    }
  }
  return { blocks, notes };
}

function headings(html) {
  const grab = (tag) => {
    const out = [];
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
    let m;
    while ((m = re.exec(html)) && out.length < 25) {
      const t = clean(m[1].replace(/<[^>]+>/g, " "));
      if (t) out.push(t);
    }
    return out;
  };
  return { h1: grab("h1"), h2: grab("h2") };
}

function textExcerpt(html, max = 1200) {
  let body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return clean(body).slice(0, max);
}

function links(html, base) {
  const set = new Set();
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) && set.size < 50) {
    try {
      set.add(new URL(m[1], base).href);
    } catch {
      /* ignore */
    }
  }
  return [...set];
}

const ALL_FIELDS = Object.freeze([
  "title",
  "description",
  "canonical",
  "lang",
  "openGraph",
  "twitter",
  "jsonLd",
  "headings",
  "links",
  "text",
  "aiReadiness",
]);

export function normalizeRequirement(requirement) {
  if (!requirement || typeof requirement !== "object") {
    return { fields: [...ALL_FIELDS] };
  }
  const fields = Array.isArray(requirement.fields)
    ? requirement.fields.filter((f) => ALL_FIELDS.includes(f))
    : [...ALL_FIELDS];
  if (Array.isArray(requirement.fields) && requirement.fields.some(f => !ALL_FIELDS.includes(f))) {
    throw new Error("unsupported extraction requirement field");
  }
  if (fields.length === 0) {
    throw Object.assign(new Error("extraction requirement fields empty"), {
      code: "invalid_requirement",
    });
  }
  return { fields: [...new Set(fields)] };
}

/**
 * @param {string} html
 * @param {{ finalUrl?: string, httpStatus?: number, requirement?: object }} opts
 */
export function extractStructured(html, opts = {}) {
  const requirement = normalizeRequirement(opts.requirement);
  const base = opts.finalUrl || "https://example.invalid/";
  const meta = metaTags(html || "");
  const { blocks: ld, notes } = jsonLdBlocks(html || "");
  const title = clean(
    (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || meta["og:title"] || "",
  );
  const og = Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith("og:")));
  const tw = Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith("twitter:")));
  const canonical =
    (html.match(
      /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i,
    ) || [])[1] || null;

  const full = {
    title,
    description: meta.description || og["og:description"] || tw["twitter:description"] || null,
    canonical,
    lang: (html.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i) || [])[1] || null,
    openGraph: og,
    twitter: tw,
    jsonLd: ld,
    headings: headings(html || ""),
    links: links(html || "", base),
    text: textExcerpt(html || ""),
    aiReadiness: {
      hasJsonLd: ld.length > 0,
      hasOpenGraph: Object.keys(og).length > 0,
      hasTitle: !!title,
      hasDescription: !!(meta.description || og["og:description"]),
      hasCanonical: !!canonical,
      schemaTypes: ld
        .flatMap((b) => [].concat(b?.["@type"] || (Array.isArray(b?.["@graph"]) ? b["@graph"].map((g) => g?.["@type"]) : []) || []))
        .filter(Boolean),
    },
  };

  const data = {};
  for (const field of requirement.fields) {
    data[field] = full[field];
  }

  const partial = notes.length > 0;
  return {
    status: partial ? "partial" : "success",
    data,
    notes,
    requirement,
    url: base,
    httpStatus: opts.httpStatus ?? null,
  };
}

export { ALL_FIELDS, clean, decodeEntities };
