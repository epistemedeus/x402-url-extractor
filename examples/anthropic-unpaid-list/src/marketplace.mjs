import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LIVE_ORIGIN,
  MARKETPLACE_INSTALL,
  MARKETPLACE_NAME,
  MARKETPLACE_PLUGIN,
} from "./constants.mjs";

const EXAMPLE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPO_ROOT = join(EXAMPLE_ROOT, "../..");

function readJsonIfPresent(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Local Claude Code marketplace catalog. Listing and install grant no payment
 * authority and this is not an Anthropic official directory listing.
 */
export function readLocalMarketplace({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const catalogPath = join(repoRoot, ".claude-plugin", "marketplace.json");
  const mcpPath = join(repoRoot, "plugins", "samedaydesk-extract", ".mcp.json");
  const catalog = readJsonIfPresent(catalogPath);
  const mcp = readJsonIfPresent(mcpPath);
  const plugin = Array.isArray(catalog?.plugins)
    ? catalog.plugins.find((entry) => entry?.name === MARKETPLACE_PLUGIN) || catalog.plugins[0]
    : null;
  const mcpUrl = mcp?.mcpServers?.samedaydesk?.url ?? `${LIVE_ORIGIN}/mcp`;
  return Object.freeze({
    kind: "claude_marketplace",
    present: Boolean(catalog && plugin),
    catalogName: catalog?.name ?? MARKETPLACE_NAME,
    plugin: plugin?.name ?? MARKETPLACE_PLUGIN,
    install: MARKETPLACE_INSTALL,
    homepage: plugin?.homepage ?? `${LIVE_ORIGIN}/`,
    repository: plugin?.repository ?? "https://github.com/epistemedeus/x402-url-extractor",
    mcpUrl,
    officialAnthropicDirectory: false,
    paymentGrantedByListing: false,
    checkoutGrantedByListing: false,
    note: "Local marketplace catalog only. Discovery is unpaid. Listing is not payment, checkout, or an Anthropic official directory listing.",
  });
}
