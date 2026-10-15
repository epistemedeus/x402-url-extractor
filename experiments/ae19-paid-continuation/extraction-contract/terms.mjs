import { readFileSync } from "node:fs";
import { join } from "node:path";
import { usdcTermsForNetwork } from "../../../x402-payment-terms.mjs";

const PRICE_LINE = /const EXTRACT_PRICE = process\.env\.EXTRACT_PRICE \|\| "(\$[^"]+)";/;
const ATOMIC_LINE = /const priceToAtomic = \(p\) =>\s+String\(Math\.round\(parseFloat\(String\(p\)\.replace\(\/\[\^0-9\.\]\/g, ""\)\) \* 1e6\)\);/;
const LEGACY = /^(221400|234100)(?:[./_-].*)?$/;

export function priceToAtomic(display) {
  return String(Math.round(parseFloat(String(display).replace(/[^0-9.]/g, "")) * 1e6));
}

/**
 * Read the merchant runtime's extract terms from source. Does not import server.js
 * and does not write a new price, asset, or terms version.
 */
export function readRuntimeTerms(repoRoot, env = process.env) {
  const serverPath = join(repoRoot, "server.js");
  const source = readFileSync(serverPath, "utf8");
  const price = source.match(PRICE_LINE);
  const formula = source.match(ATOMIC_LINE);
  if (!price || !formula) {
    const error = new Error("terms_unreadable");
    error.code = "terms_unreadable";
    throw error;
  }
  const sourceDefault = price[1];
  const effective = env.EXTRACT_PRICE || sourceDefault;
  const network = "eip155:8453";
  const usdc = usdcTermsForNetwork(network);
  return Object.freeze({
    route: "GET /extract",
    sourceDefault,
    effective,
    atomic: priceToAtomic(effective),
    envOverride: Boolean(env.EXTRACT_PRICE),
    formula: "priceToAtomic",
    network,
    asset: usdc.asset,
    assetName: usdc.name,
    assetVersion: usdc.version,
    changed: false,
  });
}

export function legacyTermsRefused(termsVersion) {
  return LEGACY.test(String(termsVersion || ""));
}
