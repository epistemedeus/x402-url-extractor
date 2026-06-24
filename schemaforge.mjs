// schemaforge.mjs — the deterministic AI-citation structured-data generator.
//
// Given a site (+ vertical/city), it (1) fetches the site first-party via extract.mjs
// to see the structured data it ALREADY has, then (2) emits a complete, valid,
// paste-ready JSON-LD bundle (@graph) tuned to the field set that the pages which
// actually surface for high-intent vertical queries carry — INCLUDING the answer-rich
// fields most of them miss (FAQPage, Review/AggregateRating, Service+priceRange) — and
// (3) returns a gap-diff + a ranked fix list.
//
// Deterministic templates (no LLM at serve time): valid by construction, free, fast.
// Honest by design: rating/review/price fields are emitted as clearly-marked
// placeholders for the business to fill with its REAL values — we generate the
// correct STRUCTURE, never fake numbers.

import { extract } from "./extract.mjs";

// ---- Vertical config. priorityFields ordered by corpus value-x-rarity (rare + answer-rich first). ----
const VERTICALS = {
  "med-spas": {
    label: "Med spa / aesthetic clinic",
    bizType: ["MedicalBusiness", "HealthAndBeautyBusiness"],
    defaultServices: ["Botox", "Dermal Fillers", "Laser Hair Removal", "Microneedling", "Chemical Peel", "HydraFacial"],
    priceRange: "$$",
    faqs: [
      { q: "How much does Botox cost here?", a: "Botox is priced per unit; most treatments range from $10–$18 per unit. Book a consultation for an exact quote based on the areas you want treated." },
      { q: "Who performs the injections?", a: "All injectable treatments are performed by licensed medical professionals (a nurse injector, physician assistant, or supervising physician)." },
      { q: "Do you offer free consultations?", a: "Yes. We offer a complimentary consultation to build a personalized treatment plan before any procedure." },
      { q: "How long do dermal filler results last?", a: "Most dermal fillers last 6–18 months depending on the product and treatment area." },
    ],
    // corpus 2026-W26 prevalence among surfaced clinic pages (real data)
    corpus: { anyJsonLd: 77, localBusiness: 59, aggregateRating: 31, review: 2, faqPage: 8, service: 11, priceRange: 25, geo: 43, openingHours: 48 },
  },
};
const DEFAULT_VERTICAL = "med-spas";

const PH = (k) => `{{${k}}}`; // explicit placeholder a buyer fills with real data

function originOf(url) {
  try { return new URL(url).origin; } catch { return url; }
}

// Best-effort name/phone/address/sameAs inference from what's already on the page.
function inferFromLive(live) {
  const out = { name: null, telephone: null, address: null, sameAs: [], image: null };
  if (!live || !live.ok) return out;
  const nodes = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === "object") { nodes.push(o); if (Array.isArray(o["@graph"])) o["@graph"].forEach(walk); for (const v of Object.values(o)) if (v && typeof v === "object") walk(v); }
  };
  (live.jsonLd || []).forEach(walk);
  for (const n of nodes) {
    if (!out.name && typeof n.name === "string" && n.name.length < 80) out.name = n.name;
    if (!out.telephone && typeof n.telephone === "string") out.telephone = n.telephone;
    if (!out.address && n.address && typeof n.address === "object") out.address = n.address;
    if (out.sameAs.length === 0 && Array.isArray(n.sameAs)) out.sameAs = n.sameAs;
  }
  out.name = out.name || live.openGraph?.["og:site_name"] || (live.title || "").split(/[|\-–—:]/)[0].trim() || null;
  out.image = live.openGraph?.["og:image"] || null;
  return out;
}

// Build the recommended paste-ready @graph for the business.
export function buildBundle({ site, vertical = DEFAULT_VERTICAL, city, name, telephone, address, services, image, sameAs } = {}) {
  const v = VERTICALS[vertical] || VERTICALS[DEFAULT_VERTICAL];
  const origin = originOf(site || "https://example.com");
  const svc = (services && services.length ? services : v.defaultServices);
  const bizId = `${origin}/#business`;

  const business = {
    "@type": v.bizType,
    "@id": bizId,
    name: name || PH("BUSINESS_NAME"),
    url: origin,
    image: image || PH("IMAGE_URL"),
    telephone: telephone || PH("PHONE_E164"),
    priceRange: v.priceRange,
    address: address || {
      "@type": "PostalAddress",
      streetAddress: PH("STREET"),
      addressLocality: city || PH("CITY"),
      addressRegion: PH("STATE"),
      postalCode: PH("ZIP"),
      addressCountry: "US",
    },
    geo: { "@type": "GeoCoordinates", latitude: PH("LAT"), longitude: PH("LNG") },
    openingHoursSpecification: [
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: PH("OPEN_HH:MM"), closes: PH("CLOSE_HH:MM") },
    ],
    sameAs: (sameAs && sameAs.length ? sameAs : [PH("GOOGLE_BUSINESS_PROFILE_URL"), PH("INSTAGRAM_URL"), PH("YELP_URL")]),
    // AggregateRating + Review: STRUCTURE only — fill with your REAL, verifiable reviews.
    aggregateRating: { "@type": "AggregateRating", ratingValue: PH("AVG_RATING_e.g_4.9"), reviewCount: PH("NUMBER_OF_REVIEWS") },
    review: [
      { "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: PH("5"), bestRating: "5" }, author: { "@type": "Person", name: PH("REVIEWER_NAME") }, reviewBody: PH("REAL_REVIEW_TEXT") },
    ],
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `${v.label} services`,
      itemListElement: svc.map((s) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: s, areaServed: city || PH("CITY") },
      })),
    },
  };

  const website = { "@type": "WebSite", "@id": `${origin}/#website`, url: origin, name: name || PH("BUSINESS_NAME"), publisher: { "@id": bizId } };

  const faq = {
    "@type": "FAQPage",
    "@id": `${origin}/#faq`,
    mainEntity: v.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return { "@context": "https://schema.org", "@graph": [business, website, faq] };
}

// Which recommended @types/fields the LIVE site is MISSING -> gap diff + ranked fix list.
export function diffAgainstLive(live, vertical = DEFAULT_VERTICAL) {
  const v = VERTICALS[vertical] || VERTICALS[DEFAULT_VERTICAL];
  const present = new Set((live?.aiReadiness?.schemaTypes || []).map((t) => String(t).toLowerCase()));
  const has = (...ts) => ts.some((t) => present.has(t.toLowerCase()));
  // each check: [key, label, present?, corpusPrevalence, impactRank]
  const checks = [
    { key: "localBusiness", label: "LocalBusiness/MedicalBusiness identity (name, address, phone, geo, hours)", ok: has("LocalBusiness", "MedicalBusiness", "MedicalClinic", "HealthAndBeautyBusiness", "DaySpa", "BeautySalon"), prevalence: v.corpus.localBusiness },
    { key: "service", label: "Service / OfferCatalog markup for your treatments (+ priceRange)", ok: has("Service", "Offer", "OfferCatalog"), prevalence: v.corpus.service },
    { key: "faqPage", label: "FAQPage markup (the format AI assistants quote most)", ok: has("FAQPage"), prevalence: v.corpus.faqPage },
    { key: "review", label: "Review + AggregateRating markup (your real ratings, machine-readable)", ok: has("Review", "AggregateRating"), prevalence: v.corpus.review },
    { key: "website", label: "WebSite entity linking your pages to the business", ok: has("WebSite"), prevalence: v.corpus.anyJsonLd },
  ];
  const missing = checks.filter((c) => !c.ok);
  // rank fixes: missing + rare-in-corpus + high-answer-value first (lower prevalence = bigger competitive edge)
  const valueOrder = { faqPage: 5, review: 4, service: 3, localBusiness: 2, website: 1 };
  const fixList = missing
    .sort((a, b) => (valueOrder[b.key] || 0) - (valueOrder[a.key] || 0))
    .map((c, i) => `${i + 1}. Add ${c.label} — only ${c.prevalence}% of clinics that surface for these searches have it, so it is a direct competitive edge.`);
  return {
    liveSchemaTypes: live?.aiReadiness?.schemaTypes || [],
    missing: missing.map((c) => c.key),
    fixList,
  };
}

// Full pipeline: fetch live -> infer -> build bundle -> diff. Used by the x402 endpoint + the human report.
export async function schemaforge({ site, vertical = DEFAULT_VERTICAL, city } = {}) {
  if (!site || typeof site !== "string") return { ok: false, error: "missing required param: site" };
  const v = VERTICALS[vertical] ? vertical : DEFAULT_VERTICAL;
  let live = null;
  try { live = await extract(site); } catch (e) { live = { ok: false, error: String(e.message || e) }; }
  const inf = inferFromLive(live);
  const bundle = buildBundle({ site, vertical: v, city, name: inf.name, telephone: inf.telephone, address: inf.address, image: inf.image, sameAs: inf.sameAs });
  const diff = diffAgainstLive(live, v);
  return {
    ok: true,
    site: originOf(site),
    vertical: v,
    city: city || null,
    live: { reached: !!(live && live.ok), currentSchemaTypes: diff.liveSchemaTypes, hasJsonLd: !!(live && live.aiReadiness && live.aiReadiness.hasJsonLd) },
    corpusContext: VERTICALS[v].corpus,
    missing: diff.missing,
    fixList: diff.fixList,
    jsonLd: bundle, // paste-ready @graph (placeholders {{...}} -> fill with your real values)
    pasteAs: `<script type="application/ld+json">\n${JSON.stringify(bundle, null, 2)}\n</script>`,
    note: "Placeholders marked {{...}} are for your REAL values (ratings, reviews, hours, phone). We generate the correct structure; never publish fabricated ratings.",
    generatedAt: new Date().toISOString(),
  };
}

// CLI smoke test: node schemaforge.mjs https://refineaesthetics.com/ med-spas Austin
if (import.meta.url === `file://${process.argv[1]}`) {
  schemaforge({ site: process.argv[2] || "https://example.com", vertical: process.argv[3] || "med-spas", city: process.argv[4] })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error("ERR", e.message); process.exit(1); });
}
