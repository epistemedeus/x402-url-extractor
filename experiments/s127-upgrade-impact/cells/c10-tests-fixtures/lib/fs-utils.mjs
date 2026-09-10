import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "dist", "coverage", ".grok"]);

export function readJson(path) {
  const text = readFileSync(path, "utf8");
  return { text, body: JSON.parse(text) };
}

export function tryReadJson(path) {
  if (!path || !existsSync(path)) {
    return { ok: false, code: "missing_path", path };
  }
  try {
    const loaded = readJson(path);
    return { ok: true, path, ...loaded };
  } catch (error) {
    return { ok: false, code: "invalid_json", path, message: error.message };
  }
}

export function walkFiles(root) {
  const out = [];
  if (!root || !existsSync(root)) return out;
  const st = statSync(root);
  if (st.isFile()) return [root];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === "." || ent.name === "..") continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name)) continue;
        stack.push(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

export function posixRel(from, to) {
  if (!from || !to) return to;
  const rel = relative(from, to);
  if (!rel || rel.startsWith("..")) return to.split(sep).join("/");
  return rel.split(sep).join("/");
}

export function posixJoin(...parts) {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
}

export function ensureDirname(filePath) {
  return dirname(filePath);
}

export const SOURCE_EXTS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);

export function isSourceFile(filePath) {
  const lower = filePath.toLowerCase();
  for (const ext of SOURCE_EXTS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export function isTsFile(filePath) {
  return /\.(tsx?|mts|cts)$/i.test(filePath);
}
