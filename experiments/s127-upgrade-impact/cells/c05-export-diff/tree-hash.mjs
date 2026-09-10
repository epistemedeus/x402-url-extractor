import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * Deterministic sha256 of an extracted package tree.
 * Paths are posix-relative to `root`, so two identical copies in different
 * directories hash equal. Symlinks are hashed as their target string, not followed.
 */
export function computeTreeHash(root) {
  const files = [];
  walk(root, root, files);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const h = createHash("sha256");
  for (const file of files) {
    h.update(file.rel);
    h.update("\0");
    h.update(file.bytes);
    h.update("\n");
  }
  return h.digest("hex");
}

/**
 * Tree hash with package.json `version` rewritten to "" so a version-only
 * bump of an otherwise identical tree is detectable.
 */
export function computeTreeHashIgnoringPackageVersion(root) {
  const files = [];
  walk(root, root, files, { blankPackageVersion: true });
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const h = createHash("sha256");
  for (const file of files) {
    h.update(file.rel);
    h.update("\0");
    h.update(file.bytes);
    h.update("\n");
  }
  return h.digest("hex");
}

function walk(root, dir, out, opts = {}) {
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    if (ent.name === "." || ent.name === "..") continue;
    const abs = join(dir, ent.name);
    const rel = toPosix(relative(root, abs));
    if (!rel || rel.startsWith("..")) continue;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(root, abs, out, opts);
      continue;
    }
    if (ent.isSymbolicLink()) {
      let target = "";
      try {
        target = readlinkSync(abs);
      } catch {
        target = "";
      }
      out.push({ rel, bytes: Buffer.from(`symlink:${target}`, "utf8") });
      continue;
    }
    if (!ent.isFile()) {
      try {
        const st = lstatSync(abs);
        if (!st.isFile()) continue;
      } catch {
        continue;
      }
    }
    let bytes;
    try {
      bytes = readFileSync(abs);
    } catch {
      continue;
    }
    if (opts.blankPackageVersion && (rel === "package.json" || rel.endsWith("/package.json"))) {
      bytes = blankVersion(bytes);
    }
    out.push({ rel, bytes });
  }
}

function blankVersion(bytes) {
  try {
    const json = JSON.parse(bytes.toString("utf8"));
    if (json && typeof json === "object" && !Array.isArray(json) && "version" in json) {
      json.version = "";
      return Buffer.from(`${JSON.stringify(json)}\n`, "utf8");
    }
  } catch {
    // keep original bytes
  }
  return bytes;
}

function toPosix(p) {
  return p.split(sep).join(posix.sep);
}
