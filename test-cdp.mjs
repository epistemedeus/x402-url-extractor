// Verify CDP credentials authenticate against the CDP x402 facilitator and that
// Base mainnet (eip155:8453) is supported — BEFORE we switch the live service.
// Reads CDP_API_KEY_ID / CDP_API_KEY_SECRET from env. Prints NO secret values.
import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";

const id = process.env.CDP_API_KEY_ID;
const secret = process.env.CDP_API_KEY_SECRET;
if (!id || !secret) { console.error("MISSING env CDP_API_KEY_ID / CDP_API_KEY_SECRET"); process.exit(1); }

const cfg = createFacilitatorConfig(id, secret);
console.log("facilitator url:", cfg.url);
console.log("config keys:", Object.keys(cfg));

const client = new HTTPFacilitatorClient(cfg);
console.log("client methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(client)).filter(m => m !== "constructor"));

async function tryCall(name, fn) {
  try { const r = await fn(); console.log(`✓ ${name} OK ->`, JSON.stringify(r).slice(0, 600)); return r; }
  catch (e) { console.log(`✗ ${name} FAILED ->`, String(e.message || e).slice(0, 300)); return null; }
}

// Try the most likely "list supported networks/schemes" method names.
let sup = null;
for (const m of ["supported", "getSupported", "listSupported", "supportedKinds"]) {
  if (typeof client[m] === "function") { sup = await tryCall(m + "()", () => client[m]()); if (sup) break; }
}

// Fallback: hit /supported directly with the config's auth headers.
if (!sup && typeof cfg.createAuthHeaders === "function") {
  await tryCall("GET /supported (direct auth)", async () => {
    const h = await cfg.createAuthHeaders();
    const headers = h?.verify || h?.list || h || {};
    const res = await fetch(cfg.url.replace(/\/$/, "") + "/supported", { headers });
    return { status: res.status, body: (await res.text()).slice(0, 400) };
  });
}

console.log("\nDONE — if a call returned 200 / a kinds list incl. eip155:8453, creds are VALID for mainnet.");
