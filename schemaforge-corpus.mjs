// schemaforge-corpus.mjs — builds the "Citation Schema Corpus" for a vertical.
// REAL DATA ONLY (zero fabrication): for a fixed set of high-intent queries we
// collected the surfaced page set via web search; here we fetch each page with
// our own extract.mjs and tabulate the EXACT structured-data reality of that set
// (which schema @types + which fields the pages that get surfaced actually carry).
//
// Output: corpus/<vertical>-<period>.json  (prevalence table + per-site rows + headline stats)
//
// Usage: node schemaforge-corpus.mjs med-spas 2026-W26

import { extract } from "./extract.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

// --- The surfaced clinic page set (individual med-spa/aesthetic-clinic sites only;
//     Yelp/listicle/aggregator results are tracked separately, not counted as clinic pages). ---
const CLINIC_URLS = [
  // Austin
  "https://secretmedspa.com/austin-tx/", "https://www.tocmedicalspa.com/", "https://www.austinmedspa.com/",
  "https://refineaesthetics.com/", "https://www.skinspirit.com/locations/austin", "https://www.viomedspa.com/locations/mueller",
  "https://www.vivadayspa.com/med-spa/",
  // Scottsdale
  "https://www.adamandevemedspa.com/", "https://medspamango.com/", "https://www.mdskinlounge.com/",
  "https://secretmedspa.com/scottsdale-az/", "https://elitemedspaaz.com/", "https://www.modernemedical.com/",
  "https://www.dsskinandlips.com/", "https://thewellmedspa.com/",
  // Miami
  "https://www.medaestheticsmiami.com/", "https://www.cosmeticlaserprofessionals.com/", "https://novaskinmedspa.com/",
  "https://carunamedspa.com/", "https://lavishlasermedspa.com/", "https://deluxemedspabeauty.com/", "https://purebeautysobe.com/",
  // Dallas
  "https://secretmedspa.com/dallas-tx/", "https://omnisculptmd.com/", "https://renewbeautymedspa.com/",
  "https://www.nakedmd.com/pages/med-spa-dallas-tx", "https://lilymedspa.com/", "https://www.marasmedspa.com/",
  "https://www.rejuvemedspa.com/",
  // Nashville
  "https://www.jackjillaesthetics.com/", "https://www.amalieaesthetics.com/", "https://elevatemedispa.com/",
  "https://www.onaskin.com/", "https://elamarskin.com/", "https://rewindmedicalsolutions.com/med-spa-nashville-tn/",
  "https://belcourtaesthetics.com/", "https://hifinch.com/",
  // Los Angeles
  "https://cienegaspa.com/", "https://www.mybotoxla.com/", "https://www.theskinagency.com/", "https://www.smoothskinlounge.com/",
  "https://www.nassifmdmedspa.com/", "https://oubeauty.com/", "https://www.medbeautyla.com/", "https://skinversemedspa.com/",
  // Chicago
  "https://www.opulencechicago.com/", "https://spaderma.com/", "https://solvemedspa.com/", "https://www.innovative-medspa.com/",
  "https://www.fulcrumaesthetics.com/med-spa/", "https://www.puremedicalspa.us/", "https://chicagoaesthetics.com/", "https://vivalamedspa.com/",
  // Denver
  "https://beautifulskindenver.com/", "https://www.skinlabcolorado.com/", "https://www.rejuvenatecolorado.com/",
  "https://www.denverfusionspa.com/", "https://skinperfectionmedspa.com/", "https://www.redermmd.com/", "https://skin-mix.com/",
  "https://www.vivemedspadenver.com/", "https://www.skinsanityco.com/",
];

// Recursively collect all @type strings and test for the presence of a field key anywhere.
function flattenNodes(obj, acc = []) {
  if (Array.isArray(obj)) { obj.forEach((o) => flattenNodes(o, acc)); return acc; }
  if (obj && typeof obj === "object") {
    acc.push(obj);
    if (Array.isArray(obj["@graph"])) flattenNodes(obj["@graph"], acc);
    for (const v of Object.values(obj)) if (v && typeof v === "object") flattenNodes(v, acc);
  }
  return acc;
}
function allTypes(blocks) {
  const t = new Set();
  for (const b of blocks) for (const n of flattenNodes(b)) {
    const ty = n["@type"];
    if (typeof ty === "string") t.add(ty);
    else if (Array.isArray(ty)) ty.forEach((x) => typeof x === "string" && t.add(x));
  }
  return [...t];
}
// True if any node anywhere carries a (non-empty) value for any of the given keys.
function hasKey(blocks, keys) {
  for (const b of blocks) for (const n of flattenNodes(b)) {
    for (const k of keys) {
      if (n[k] !== undefined && n[k] !== null && !(typeof n[k] === "string" && n[k].trim() === "")) return true;
    }
  }
  return false;
}
function hasType(blocks, types) {
  const present = allTypes(blocks).map((t) => t.toLowerCase());
  return types.some((t) => present.includes(t.toLowerCase()));
}

const LOCALBIZ_TYPES = ["LocalBusiness","MedicalBusiness","MedicalClinic","HealthAndBeautyBusiness","DaySpa","BeautySalon","Physician","Dentist","MedicalOrganization"];

async function analyze(url) {
  try {
    const data = await extract(url);
    const ld = data.jsonLd || [];
    return {
      url, ok: true, hasJsonLd: ld.length > 0, blocks: ld.length,
      types: allTypes(ld),
      localBusiness: hasType(ld, LOCALBIZ_TYPES),
      organization: hasType(ld, ["Organization"]),
      website: hasType(ld, ["WebSite"]),
      aggregateRating: hasKey(ld, ["aggregateRating"]),
      review: hasKey(ld, ["review"]) || hasType(ld, ["Review"]),
      faqPage: hasType(ld, ["FAQPage"]) || hasKey(ld, ["mainEntity"]) && hasType(ld, ["Question"]),
      service: hasType(ld, ["Service","Offer","OfferCatalog"]) || hasKey(ld, ["makesOffer","hasOfferCatalog"]),
      priceRange: hasKey(ld, ["priceRange"]),
      geo: hasKey(ld, ["geo"]) || hasType(ld, ["GeoCoordinates"]),
      address: hasKey(ld, ["address"]) || hasType(ld, ["PostalAddress"]),
      telephone: hasKey(ld, ["telephone"]),
      openingHours: hasKey(ld, ["openingHours","openingHoursSpecification"]),
      breadcrumb: hasType(ld, ["BreadcrumbList"]),
      sameAs: hasKey(ld, ["sameAs"]),
      image: hasKey(ld, ["image","logo"]),
    };
  } catch (e) {
    return { url, ok: false, error: String(e.message || e) };
  }
}

async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

const vertical = process.argv[2] || "med-spas";
const period = process.argv[3] || "2026-W26";

const rows = await mapLimit(CLINIC_URLS, 6, analyze);
const reached = rows.filter((r) => r.ok);
const withLd = reached.filter((r) => r.hasJsonLd);
const n = reached.length;
const pct = (k) => (n ? Math.round((reached.filter((r) => r[k]).length / n) * 100) : 0);

const prevalence = {
  anyJsonLd: pct("hasJsonLd"),
  localBusiness: pct("localBusiness"),
  organization: pct("organization"),
  aggregateRating: pct("aggregateRating"),
  review: pct("review"),
  faqPage: pct("faqPage"),
  service: pct("service"),
  priceRange: pct("priceRange"),
  geo: pct("geo"),
  address: pct("address"),
  telephone: pct("telephone"),
  openingHours: pct("openingHours"),
  breadcrumb: pct("breadcrumb"),
  sameAs: pct("sameAs"),
  image: pct("image"),
};

const corpus = {
  vertical, period,
  generatedAt: new Date().toISOString(),
  method: "High-intent queries ('best med spa / Botox / laser hair removal in <metro>') across 8 US metros were run through web search; the surfaced individual-clinic page set was fetched first-party and its JSON-LD structured data tabulated exactly. Aggregators/listicles (Yelp, etc.) excluded from the clinic tally.",
  metros: ["Austin","Scottsdale","Miami","Dallas","Nashville","Los Angeles","Chicago","Denver"],
  sampled: CLINIC_URLS.length,
  reached: n,
  reachRatePct: CLINIC_URLS.length ? Math.round((n / CLINIC_URLS.length) * 100) : 0,
  withJsonLdCount: withLd.length,
  prevalencePct: prevalence,
  rows,
};

mkdirSync("corpus", { recursive: true });
const path = `corpus/${vertical}-${period}.json`;
writeFileSync(path, JSON.stringify(corpus, null, 2));

console.log(`\n=== Citation Schema Corpus: ${vertical} ${period} ===`);
console.log(`sampled ${corpus.sampled} clinic URLs, reached ${n} (${corpus.reachRatePct}%), ${withLd.length} carry any JSON-LD`);
console.log("prevalence (% of reached clinic pages):");
for (const [k, v] of Object.entries(prevalence)) console.log(`  ${k.padEnd(16)} ${v}%`);
console.log(`\nwritten -> ${path}`);
