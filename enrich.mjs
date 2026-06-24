// enrich.mjs — the paid service: domain -> agent-ready company intelligence, in one call.
// Sits in the #1 verified-earning x402 category (data ENRICHMENT, e.g. StableEnrich ~$3.12k/30d).
// Value to AI agents: hand it a bare domain, get back clean structured firmographics + tech stack +
// social profiles + contact surface + DNS/email-infra + AI-search-readiness signals — no auth, no API
// keys, no subscription, pay-per-call USDC. The differentiator vs Clearbit/Apollo (paywalled + signup-
// gated, inaccessible to an autonomous agent) is exactly that frictionlessness, plus our GEO/AI-readiness
// signal layer that generic enrichment APIs don't carry.
//
// Pure public data only (homepage HTML + DNS + robots/llms.txt). Deterministic. Zero paid dependencies.

import dns from "node:dns/promises";
import { assertPublicHttpUrl, fetchWithGuards, metaTags, jsonLdBlocks, clean } from "./extract.mjs";

const TIMEOUT_MS = 8_000;

// Accept "example.com", "https://example.com/x", "http://www.example.com" -> canonical https origin.
function normalizeToOrigin(raw) {
  let s = String(raw || "").trim();
  if (!s) throw new Error("missing domain/url");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const u = assertPublicHttpUrl(s); // reuse SSRF guard
  return u;
}

const SOCIAL_HOSTS = {
  "twitter.com": "twitter", "x.com": "twitter", "linkedin.com": "linkedin",
  "facebook.com": "facebook", "instagram.com": "instagram", "youtube.com": "youtube",
  "github.com": "github", "tiktok.com": "tiktok", "discord.gg": "discord",
  "discord.com": "discord", "t.me": "telegram", "medium.com": "medium",
  "crunchbase.com": "crunchbase", "pinterest.com": "pinterest",
};

function socialProfiles(links, sameAs) {
  const out = {};
  const all = [...(links || []), ...(Array.isArray(sameAs) ? sameAs : sameAs ? [sameAs] : [])];
  for (const href of all) {
    try {
      const h = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
      const key = SOCIAL_HOSTS[h];
      if (key && !out[key]) out[key] = href.split("?")[0];
    } catch { /* ignore */ }
  }
  return out;
}

// Tech / CMS / framework / analytics fingerprint from raw HTML + meta generator.
function techStack(html, meta) {
  const sig = [];
  const add = (name, re) => { if (re.test(html)) sig.push(name); };
  const gen = (meta.generator || "").toLowerCase();
  if (gen) sig.push(`generator:${gen.slice(0, 40)}`);
  add("WordPress", /wp-content|wp-includes|\/wp-json/i);
  add("Shopify", /cdn\.shopify\.com|myshopify\.com|Shopify\.theme/i);
  add("Wix", /static\.wixstatic\.com|wix\.com/i);
  add("Squarespace", /squarespace\.com|static1\.squarespace/i);
  add("Webflow", /assets\.website-files\.com|webflow\.(js|com)/i);
  add("Next.js", /\/_next\/static|__NEXT_DATA__/i);
  add("Nuxt", /\/_nuxt\/|__NUXT__/i);
  add("React", /data-reactroot|react(?:-dom)?(?:\.production)?\.min\.js/i);
  add("Vue", /vue(?:\.runtime)?(?:\.global)?(?:\.prod)?\.js|data-v-[0-9a-f]{8}/i);
  add("HubSpot", /js\.hs-scripts\.com|hsforms\.|hubspot/i);
  add("Framer", /framerusercontent\.com|framer\.com/i);
  add("Google Analytics", /google-analytics\.com|gtag\(|googletagmanager\.com\/gtag/i);
  add("Google Tag Manager", /googletagmanager\.com\/gtm/i);
  add("Segment", /cdn\.segment\.(com|io)|analytics\.js/i);
  add("PostHog", /posthog\.com|posthog\.init/i);
  add("Plausible", /plausible\.io/i);
  add("Intercom", /widget\.intercom\.io|intercomSettings/i);
  add("Cloudflare", /cdnjs\.cloudflare\.com|__cf|cf-ray/i);
  add("Stripe", /js\.stripe\.com/i);
  return [...new Set(sig)];
}

function emails(html) {
  const set = new Set();
  const re = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  let m;
  while ((m = re.exec(html)) && set.size < 10) {
    const e = m[0].toLowerCase();
    // drop obvious asset/sentry/placeholder noise
    if (/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/.test(e)) continue;
    if (/@(sentry|example|email|domain|yourdomain|sentry\.io)\b/.test(e)) continue;
    set.add(e);
  }
  return [...set];
}

function phones(html, ld) {
  const set = new Set();
  const tel = /href\s*=\s*["']tel:([^"']+)["']/gi;
  let m;
  while ((m = tel.exec(html)) && set.size < 5) set.add(clean(m[1]));
  const fromLd = (o) => {
    if (!o || typeof o !== "object") return;
    if (o.telephone) set.add(clean(String(o.telephone)));
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(fromLd);
      else if (typeof v === "object") fromLd(v);
    }
  };
  ld.forEach(fromLd);
  return [...set];
}

// Pull a company-ish object out of the JSON-LD graph (Organization / LocalBusiness / *Business).
function orgFromLd(ld) {
  const flat = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (o["@graph"]) walk(o["@graph"]);
    flat.push(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  ld.forEach(walk);
  const isOrg = (t) => {
    const types = [].concat(t || []).map((x) => String(x).toLowerCase());
    return types.some((x) => x.includes("organization") || x.includes("business") || x.includes("corporation") || x.includes("localbusiness"));
  };
  const org = flat.find((o) => isOrg(o["@type"])) || {};
  const addr = org.address && typeof org.address === "object" ? org.address : null;
  return {
    name: org.name ? clean(String(org.name)) : null,
    legalName: org.legalName ? clean(String(org.legalName)) : null,
    foundingDate: org.foundingDate || null,
    logo: typeof org.logo === "string" ? org.logo : org.logo?.url || null,
    telephone: org.telephone || null,
    sameAs: org.sameAs || null,
    address: addr ? {
      street: addr.streetAddress || null,
      city: addr.addressLocality || null,
      region: addr.addressRegion || null,
      postalCode: addr.postalCode || null,
      country: addr.addressCountry?.name || addr.addressCountry || null,
    } : null,
  };
}

async function dnsIntel(hostname) {
  const host = hostname.replace(/^www\./, "");
  const out = { host, a: [], mx: [], ns: [], hasSPF: false, hasDMARC: false };
  const safe = async (fn, key, map) => { try { const r = await fn(); out[key] = map ? map(r) : r; } catch { /* no record */ } };
  await Promise.allSettled([
    safe(() => dns.resolve4(host), "a"),
    safe(() => dns.resolveMx(host), "mx", (r) => r.map((x) => x.exchange).slice(0, 5)),
    safe(() => dns.resolveNs(host), "ns", (r) => r.slice(0, 5)),
    safe(() => dns.resolveTxt(host), "_txt", (r) => r.map((x) => x.join(""))),
  ]);
  const txt = out._txt || [];
  out.hasSPF = txt.some((t) => /v=spf1/i.test(t));
  delete out._txt;
  // DMARC lives on _dmarc.<host>
  try { const d = await dns.resolveTxt("_dmarc." + host); out.hasDMARC = d.flat().some((t) => /v=DMARC1/i.test(t)); } catch { /* none */ }
  out.emailInfra = out.mx.length > 0;
  return out;
}

async function headOk(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "SameDayDeskEnrich/1.0" } });
    return r.ok;
  } catch { return false; } finally { clearTimeout(t); }
}

// Collect declared keywords/topics from the JSON-LD graph (keywords, knowsAbout,
// applicationCategory). Strings may be comma-joined; arrays may hold strings or {name}.
function ldKeywords(ld) {
  const out = [];
  const push = (v) => {
    if (!v) return;
    if (typeof v === "string") out.push(...v.split(/[,;|]/));
    else if (Array.isArray(v)) for (const x of v) out.push(typeof x === "string" ? x : x?.name || "");
    else if (typeof v === "object" && v.name) out.push(String(v.name));
  };
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    push(o.keywords); push(o.knowsAbout); push(o.applicationCategory);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  ld.forEach(walk);
  return out;
}

// Stopwords for deterministic keyword derivation from title/description marketing copy.
const KW_STOP = new Set(
  ("the a an and or but for to of in on at by with from into over under out up down off as is are be been being was were am do does did has have had can could will would should may might must just not no nor yes new use used using via per your you our we us they them their his her its it this that these those there here what which who whom whose how why when where all any both each few more most other some such only own same so than too very s t don now get got make made build built help helps best free open one two get more about contact privacy terms cookie cookies login signup sign log home page site web app apps data api apis pay call calls click learn read see view start today")
    .split(/\s+/)
);

// Deterministic salient-term extraction from title + description when no
// declared keywords exist. Ranks by frequency then first-appearance. Honest
// fallback (flagged keywordsSource:"derived"), never fabricated.
function deriveKeywords(text, max = 8) {
  const freq = new Map();
  const order = [];
  for (const raw of String(text || "").toLowerCase().split(/[^a-z0-9+]+/)) {
    const w = raw.trim();
    if (w.length < 4 || KW_STOP.has(w) || /^\d+$/.test(w)) continue;
    if (!freq.has(w)) order.push(w);
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return order
    .sort((a, b) => freq.get(b) - freq.get(a) || order.indexOf(a) - order.indexOf(b))
    .slice(0, max);
}

export async function enrich(rawDomain) {
  const u = normalizeToOrigin(rawDomain);
  const origin = u.origin;
  const { res, html } = await fetchWithGuards(origin + "/");
  const meta = metaTags(html);
  const ld = jsonLdBlocks(html);
  const org = orgFromLd(ld);

  const title = clean((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || meta["og:title"] || "");
  const description = meta.description || meta["og:description"] || meta["twitter:description"] || null;
  const linkRe = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi;
  const links = new Set();
  let lm; while ((lm = linkRe.exec(html)) && links.size < 120) { try { links.add(new URL(lm[1], origin).href); } catch { /* ignore */ } }

  const schemaTypes = ld.flatMap((b) => [].concat(b["@type"] || b?.["@graph"]?.map((g) => g["@type"]) || [])).filter(Boolean);
  const [dnsData, hasRobots, hasSitemap, hasLlms] = await Promise.all([
    dnsIntel(u.hostname).catch(() => null),
    headOk(origin + "/robots.txt"),
    headOk(origin + "/sitemap.xml"),
    headOk(origin + "/llms.txt"),
  ]);

  const social = socialProfiles([...links], org.sameAs);
  // Keywords: prefer DECLARED keywords (meta keywords/news_keywords/article tags +
  // JSON-LD keywords/knowsAbout). Modern sites rarely set the legacy keywords meta,
  // so fall back to deterministic salient terms from the title + description.
  const declaredKw = [
    ...String(meta.keywords || "").split(","),
    ...String(meta["news_keywords"] || "").split(","),
    ...String(meta["article:tag"] || "").split(","),
    ...ldKeywords(ld),
  ].map((s) => clean(String(s))).filter((s) => s && s.length <= 40);
  const seen = new Set();
  const keywords = [];
  const addKw = (k) => { const low = String(k).toLowerCase(); if (k && !seen.has(low) && keywords.length < 15) { seen.add(low); keywords.push(k); } };
  for (const k of declaredKw) addKw(k);
  const declaredCount = keywords.length;
  // Top up to ~6 with deterministic derived terms when declared keywords are sparse/absent.
  if (keywords.length < 6) for (const k of deriveKeywords(`${title} ${description || ""}`)) addKw(k);
  const keywordsSource = declaredCount === 0 ? "derived" : declaredCount >= keywords.length ? "declared" : "mixed";

  return {
    ok: true,
    domain: u.hostname,
    url: res.url || origin,
    fetchedAt: new Date().toISOString(),
    company: {
      name: org.name || meta["og:site_name"] || title || null,
      legalName: org.legalName,
      description: description ? clean(description) : null,
      logo: org.logo || meta["og:image"] || null,
      foundingDate: org.foundingDate,
      keywords,
      keywordsSource,
    },
    contact: {
      emails: emails(html),
      phones: phones(html, ld),
      address: org.address,
    },
    social,
    tech: techStack(html, meta),
    dns: dnsData,
    aiReadiness: {
      hasJsonLd: ld.length > 0,
      schemaTypes: [...new Set(schemaTypes)],
      hasOpenGraph: Object.keys(meta).some((k) => k.startsWith("og:")),
      hasRobotsTxt: hasRobots,
      hasSitemap,
      hasLlmsTxt: hasLlms,
      // crude 0-100 readiness score for agents that want a single signal
      score: [ld.length > 0, Object.keys(meta).some((k) => k.startsWith("og:")), !!description, hasRobots, hasSitemap, hasLlms].filter(Boolean).length * 16 + (ld.length > 0 ? 4 : 0),
    },
  };
}

// CLI smoke test: node enrich.mjs example.com
if (import.meta.url === `file://${process.argv[1]}`) {
  const d = process.argv[2] || "example.com";
  enrich(d).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("ERR", e.message); process.exit(1); });
}
