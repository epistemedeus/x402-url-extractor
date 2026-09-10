/**
 * Isolation self-check for cell c20-yarn-lock.
 * Confirms this cell's sources do not spawn, fetch, or import network modules.
 */

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const CELL_ID = "c20-yarn-lock";
export const OWNED_ROOT_SUFFIX = join("experiments", "s127-upgrade-impact", "cells", "c20-yarn-lock");

const FORBIDDEN_IMPORT = /from\s+["']node:(?:child_process|http|https|http2|net|dgram|tls|dns)["']/;
const FORBIDDEN_REQ = /require\(["'](?:child_process|http|https|net|dgram|tls)["']\)/;
const FORBIDDEN_PM = /(?:spawnSync|spawn|execSync|execFileSync|execFile|exec)\s*\([^)]*(?:npm|yarn|pnpm|npx)\b/;
const FORBIDDEN_FETCH = /\b(?:fetch\(|axios\.|http\.request|https\.request)\b/;

const SKIP_DIRS = new Set(["node_modules", ".git"]);

export function cellRoot(from = fileURLToPath(import.meta.url)) {
  const abs = resolve(from);
  if (abs.endsWith(`${sep}isolation.mjs`) || abs.endsWith("/isolation.mjs")) return dirname(abs);
  return abs;
}

export function ownedRootAbs(root = cellRoot()) {
  return resolve(root);
}

export function isInsideOwned(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolved = resolve(candidate);
  const rel = relative(resolvedRoot, resolved);
  if (rel === "") return true;
  if (rel.startsWith("..")) return false;
  return true;
}

function walkFiles(dir, out) {
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    if (ent.name === "." || ent.name === "..") continue;
    const abs = join(dir, ent.name);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walkFiles(abs, out);
      continue;
    }
    if (st.isFile()) out.push(abs);
  }
}

export function isolationSelfCheck({ root = cellRoot() } = {}) {
  const absRoot = ownedRootAbs(root);
  const files = [];
  walkFiles(absRoot, files);
  const sources = files.filter((f) => /\.(mjs|js|cjs|json|lock)$/.test(f));
  const findings = [];

  for (const file of sources) {
    if (!isInsideOwned(absRoot, file)) {
      findings.push({ file, kind: "outside_owned_root" });
      continue;
    }
    let st;
    try {
      st = lstatSync(file);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      findings.push({ file, kind: "symlink" });
      continue;
    }
    if (!/\.(mjs|js|cjs)$/.test(file)) continue;
    const rel = relative(absRoot, file).split(sep).join("/");
    if (rel.startsWith("test/")) continue;
    const text = readFileSync(file, "utf8");
    if (FORBIDDEN_IMPORT.test(text)) {
      findings.push({ file, kind: "forbidden_node_import" });
    }
    if (FORBIDDEN_REQ.test(text)) {
      findings.push({ file, kind: "forbidden_require" });
    }
    if (FORBIDDEN_PM.test(text) && !rel.endsWith("isolation.mjs")) {
      findings.push({ file, kind: "package_manager_invocation" });
    }
    if (FORBIDDEN_FETCH.test(text) && !rel.endsWith("isolation.mjs")) {
      findings.push({ file, kind: "network_call_shape" });
    }
  }

  const rels = files.map((f) => relative(absRoot, f).split(sep).join("/")).sort();

  return {
    ok: findings.length === 0,
    cell: CELL_ID,
    root: absRoot,
    ownedSuffix: OWNED_ROOT_SUFFIX,
    fileCount: files.length,
    files: rels,
    findings,
    spawn: "none",
    network: "none",
    packageLifecycle: "never",
    paidDemand: false,
  };
}
