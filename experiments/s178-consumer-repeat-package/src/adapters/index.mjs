/**
 * Explicit adapter map for advertised jobs. No heuristic export fallthrough.
 * Unknown artifact ids are unsupported — they are not guessed.
 */
export const ADAPTER_FILES = Object.freeze({
  "migration-checklist": "./s137-migration.mjs",
  "release-brief": "./s137-release-brief.mjs",
  "table-reconcile": "./s137-table-reconcile.mjs",
  "link-index": "./s137-link-index.mjs",
  "replay-pack": "./s137-replay-pack.mjs",
  "freshness-receipt": "./s137-freshness.mjs",
  "procurement-brief": "./job07.mjs",
  "customer-result-package": "./job08.mjs",
  "acquisition-status": "./compose-acquire.mjs",
});

export async function loadAdapter(artifactId) {
  const file = ADAPTER_FILES[artifactId];
  if (!file) return null;
  return import(new URL(file, import.meta.url));
}
