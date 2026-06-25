// deep-audit.mjs — the $1 "deep" bundled tier (higher-ticket lever toward real volume revenue).
//
// WHY: a single $0.02 enrich call needs ~10,000 buys to reach $200; a $1.00 bundled
// audit needs ~200. This route chains our two domain-input products — /enrich
// (firmographics + tech stack + contact + DNS/email infra + AI-readiness signals) and
// /schemaforge (structured-data gap analysis + paste-ready JSON-LD fix list) — into ONE
// comprehensive "AI-search readiness audit" for a domain. It is squarely the SameDayDesk
// core service (AI-search audits) productized as a single agent-callable endpoint.
//
// Pure composition of existing modules; no new deps, no new network primitives.
// Mount in server.js as a paid GET /deep-audit?domain=... (see MOUNT NOTE at bottom).

import { enrich } from "./enrich.mjs";
import { schemaforge } from "./schemaforge.mjs";

// Pull a 0-100 AI-readiness score out of an enrich result without assuming the exact path.
function readinessScore(e) {
  if (!e || typeof e !== "object") return null;
  const ar = e.aiReadiness ?? e.ai_readiness ?? e.readiness;
  if (typeof ar === "number") return ar;
  if (ar && typeof ar === "object") {
    if (typeof ar.score === "number") return ar.score;
    if (typeof ar.value === "number") return ar.value;
  }
  if (typeof e.score === "number") return e.score;
  return null;
}

function normalizeDomain(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return s.replace(/^www\./, "").split("/")[0] || null;
  }
}

// domain -> one merged AI-search-readiness audit. Resilient: if one sub-call fails,
// returns a partial report (ok stays true as long as at least one component succeeded).
export async function deepAudit(rawDomain, opts = {}) {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { ok: false, error: "missing required param: domain" };

  const site = `https://${domain}`;
  const [enrichRes, forgeRes] = await Promise.allSettled([
    enrich(domain),
    schemaforge({ site, vertical: opts.vertical, city: opts.city }),
  ]);

  const e = enrichRes.status === "fulfilled" ? enrichRes.value : null;
  const f = forgeRes.status === "fulfilled" ? forgeRes.value : null;
  const enrichOk = !!(e && e.ok);
  const forgeOk = !!(f && f.ok);

  const score = readinessScore(e);
  const gaps = f && Array.isArray(f.missing) ? f.missing.length : null;
  const hasJsonLd = f && f.live ? !!f.live.hasJsonLd : null;

  // Single combined grade so a buyer gets a one-glance verdict.
  let grade = null;
  if (score != null) {
    let s = score;
    if (gaps != null) s = Math.max(0, Math.round(score - Math.min(25, gaps * 3))); // penalize structured-data gaps
    const letter = s >= 80 ? "A" : s >= 65 ? "B" : s >= 50 ? "C" : s >= 35 ? "D" : "F";
    grade = `${letter} (${s}/100)`;
  }

  return {
    ok: enrichOk || forgeOk,
    product: "deep-audit",
    domain,
    generatedAt: new Date().toISOString(),
    summary: {
      aiReadinessScore: score,
      structuredDataGaps: gaps,
      hasJsonLd,
      grade,
      headline:
        grade != null
          ? `AI-search readiness ${grade}; ${gaps != null ? gaps : "unknown"} structured-data gap(s) to fix.`
          : "Partial audit (one or more components unavailable).",
    },
    // From /enrich — who they are + how their web/email infra looks.
    identity: e ? e.company ?? null : null,
    tech: e ? e.tech ?? e.techStack ?? null : null,
    contact: e ? e.contact ?? null : null,
    social: e ? e.social ?? null : null,
    dns: e ? e.dns ?? e.email ?? null : null,
    aiReadinessSignals: e ? e.aiReadiness ?? null : null,
    // From /schemaforge — the structured-data gap + the exact fix.
    structuredData: f
      ? {
          current: f.live ? f.live.currentSchemaTypes : null,
          missing: f.missing ?? null,
          fixList: f.fixList ?? null,
          jsonLd: f.jsonLd ?? null,
          pasteAs: f.pasteAs ?? null,
          note: f.note ?? null,
        }
      : null,
    components: { enrich: enrichOk, schemaforge: forgeOk },
  };
}

// CLI smoke test: `node deep-audit.mjs stripe.com`
if (import.meta.url === `file://${process.argv[1]}`) {
  deepAudit(process.argv[2] || "stripe.com", { city: process.argv[3] })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => {
      console.error("deep-audit error:", err);
      process.exit(1);
    });
}

/* ─────────────────────────────────────────────────────────────────────────────
 MOUNT NOTE (for whoever next opens server.js — keeps server.js edits serialized):
   import { deepAudit } from "./deep-audit.mjs";
   const DEEP_AUDIT_PRICE = process.env.DEEP_AUDIT_PRICE || "$1.00";
   // add to RESOURCES:
   { url: `${PUBLIC_URL}/deep-audit`, amount: priceToAtomic(DEEP_AUDIT_PRICE),
     description: "Domain -> ONE complete AI-search-readiness audit: firmographics + tech stack + contact + DNS/email infra + an AI-readiness score, PLUS a structured-data gap analysis with a paste-ready JSON-LD fix list. The bundled deep tier. No auth/keys; pay-per-call USDC.",
     mimeType: "application/json" }
   // add the paid route (mirrors app.get("/enrich")):
   app.get("/deep-audit", async (req, res) => {
     const domain = req.query.domain;
     if (!domain) return res.status(400).json({ error: "missing ?domain=" });
     res.json(await deepAudit(domain, { vertical: req.query.vertical, city: req.query.city }));
   });
   // also add to /healthz prices + /openapi.json paths, then `railway up`.
───────────────────────────────────────────────────────────────────────────── */
