import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./paths.mjs";

const MCP_DIR = join(REPO_ROOT, "node_modules", "@x402", "mcp");
const MCP_PKG = join(MCP_DIR, "package.json");
const MCP_SRC = join(MCP_DIR, "dist", "esm", "index.mjs");

export function inspectInstalledMcp(repoRoot = REPO_ROOT) {
  const pkgPath = join(repoRoot, "node_modules", "@x402", "mcp", "package.json");
  const srcPath = join(repoRoot, "node_modules", "@x402", "mcp", "dist", "esm", "index.mjs");
  if (!existsSync(pkgPath) || !existsSync(srcPath)) {
    return { present: false, version: null, hasDefaultCap: false, pinGap: true };
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const src = readFileSync(srcPath, "utf8");
  const hasDefaultCap = /DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS\s*=\s*600/.test(src);
  const hasPaidTimeout = /function paidTimeoutMs\(/.test(src);
  return {
    present: true,
    version: pkg.version ?? null,
    hasDefaultCap,
    hasPaidTimeout,
    pinGap: !hasDefaultCap,
    defaultCapSeconds: hasDefaultCap ? 600 : null,
  };
}

export { MCP_DIR, MCP_PKG, MCP_SRC };
