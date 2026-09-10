/**
 * Fixture catalog for S137 R2-CONSUMER-JOBS-04 synthetic HTML/MD cases.
 * Inventory helpers check authored files. They are not src/link-index/transform.mjs.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const CLOCK = "2026-09-10T12:00:00.000Z";
export const JOB_ID = "R2-CONSUMER-JOBS-04";
export const EVIDENCE_CLASS = "synthetic";
export const CASE_SCHEMA = "s137.link-index.synthetic-case.v1";
export const MANIFEST_SCHEMA = "s137.link-index.synthetic-manifest.v1";
export const REQUIRED_KINDS = Object.freeze(["positive", "negative", "partial", "conflict"]);

const ROOT = dirname(fileURLToPath(import.meta.url));

export function fixtureRoot() {
  return ROOT;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function loadManifest() {
  return JSON.parse(readFileSync(join(ROOT, "MANIFEST.json"), "utf8"));
}

export function caseDir(caseId) {
  return join(ROOT, "cases", caseId);
}

export function loadExpected(caseId) {
  return JSON.parse(readFileSync(join(caseDir(caseId), "expected.json"), "utf8"));
}

export function loadEntrySource(caseId, expected = loadExpected(caseId)) {
  return readFileSync(join(caseDir(caseId), expected.entry), "utf8");
}

export function loadCase(caseId) {
  const expected = loadExpected(caseId);
  const dir = caseDir(caseId);
  const entryPath = join(dir, expected.entry);
  const entryBytes = readFileSync(entryPath);
  const entrySource = entryBytes.toString("utf8");
  return { caseId, dir, expected, entryPath, entrySource, entryBytes };
}

export function slugHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

export function scanHtml(source) {
  const links = [];
  const anchorRe = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(source))) {
    const hrefMatch = /\bhref\s*=\s*"([^"]*)"/.exec(match[1]);
    if (!hrefMatch) continue;
    links.push({
      href: hrefMatch[1],
      text: match[2].replace(/<[^>]+>/g, "").trim(),
      markup: match[0],
      index: match.index,
      syntax: "html-a",
    });
  }
  const anchors = [];
  const idRe = /\bid\s*=\s*"([^"]+)"/gi;
  while ((match = idRe.exec(source))) {
    anchors.push({ id: match[1], index: match.index, kind: "html-id" });
  }
  return { links, anchors };
}

export function scanMarkdown(source) {
  const refDefs = [];
  const defRe = /^\[([^\]]+)\]:\s+(\S+)\s*$/gm;
  let match;
  while ((match = defRe.exec(source))) {
    refDefs.push({
      refId: match[1],
      href: match[2],
      markup: match[0],
      index: match.index,
    });
  }
  const refMap = new Map(refDefs.map((d) => [d.refId.toLowerCase(), d]));

  const links = [];
  const inlineRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = inlineRe.exec(source))) {
    links.push({
      href: match[2],
      text: match[1],
      markup: match[0],
      index: match.index,
      syntax: "md-inline",
    });
  }
  const refUseRe = /\[([^\]]+)\]\[([^\]]+)\]/g;
  while ((match = refUseRe.exec(source))) {
    const def = refMap.get(match[2].toLowerCase());
    links.push({
      href: def ? def.href : null,
      text: match[1],
      markup: match[0],
      index: match.index,
      syntax: "md-reference",
      refId: match[2],
      resolved: Boolean(def),
    });
  }

  const anchors = [];
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;
  while ((match = headingRe.exec(source))) {
    anchors.push({
      id: slugHeading(match[2]),
      text: match[2],
      level: match[1].length,
      index: match.index,
      kind: "md-heading",
    });
  }
  const idRe = /\bid\s*=\s*"([^"]+)"/gi;
  while ((match = idRe.exec(source))) {
    anchors.push({ id: match[1], index: match.index, kind: "html-id" });
  }
  return { links, anchors, refDefs };
}

export function scanEntry(format, source) {
  return format === "html" ? scanHtml(source) : scanMarkdown(source);
}

function splitHref(href) {
  const hash = href.indexOf("#");
  if (hash === -1) return { path: href, fragment: null };
  return { path: href.slice(0, hash), fragment: href.slice(hash + 1) };
}

function isInside(root, candidate) {
  const rootResolved = resolve(root);
  const candResolved = resolve(candidate);
  return candResolved === rootResolved || candResolved.startsWith(rootResolved + sep);
}

function collectAnchorsForFile(filePath, source) {
  if (filePath.endsWith(".md")) return scanMarkdown(source).anchors;
  return scanHtml(source).anchors;
}

function classifyFragment(fragment, anchors) {
  const matches = anchors.filter((a) => a.id === fragment);
  if (matches.length === 0) return { targetStatus: "unreachable-missing-fragment", fragment };
  if (matches.length > 1) return { targetStatus: "ambiguous-fragment", fragment, idCount: matches.length };
  return { targetStatus: "reachable", fragment };
}

export function classifyHref(href, ctx) {
  if (href == null) return { targetStatus: "unresolved-reference" };
  if (href === "") return { targetStatus: "invalid-empty" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return { targetStatus: "unresolved-external", href };
  }
  const { path: rel, fragment } = splitHref(href);
  if (!rel) {
    return classifyFragment(fragment, ctx.entryAnchors);
  }
  const resolved = resolve(ctx.caseDir, rel);
  if (!isInside(resolve(ctx.caseDir), resolved)) {
    return { targetStatus: "unreachable-out-of-bound", href };
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    return { targetStatus: "unreachable-missing-file", targetPath: rel, fragment };
  }
  if (!fragment) return { targetStatus: "reachable", targetPath: rel, fragment: null };
  const targetSource = readFileSync(resolved, "utf8");
  const anchors = collectAnchorsForFile(resolved, targetSource);
  return { ...classifyFragment(fragment, anchors), targetPath: rel };
}

export function inventoryCase(caseId) {
  const loaded = loadCase(caseId);
  const scanned = scanEntry(loaded.expected.format, loaded.entrySource);
  const ctx = { caseDir: loaded.dir, entryAnchors: scanned.anchors };
  const links = scanned.links.map((link) => ({
    ...link,
    ...classifyHref(link.href, ctx),
  }));
  return { ...loaded, scanned, links, anchors: scanned.anchors };
}

export function citationRecord(relPath, bytes) {
  return {
    citationId: relPath,
    path: relPath,
    sha256: sha256(bytes),
    evidenceClass: EVIDENCE_CLASS,
  };
}

export function deriveDecision({ links, anchors }) {
  const idCounts = new Map();
  for (const anchor of anchors) {
    idCounts.set(anchor.id, (idCounts.get(anchor.id) || 0) + 1);
  }
  if ([...idCounts.values()].some((n) => n > 1)) return "conflict";
  if (links.some((link) => link.targetStatus === "ambiguous-fragment")) return "conflict";
  const hrefsByText = new Map();
  for (const link of links) {
    if (!link.text) continue;
    const hrefs = hrefsByText.get(link.text) || new Set();
    hrefs.add(link.href);
    hrefsByText.set(link.text, hrefs);
  }
  if ([...hrefsByText.values()].some((hrefs) => hrefs.size > 1)) return "conflict";
  if (links.length === 0) return "fail";
  const reachable = links.filter((link) => link.targetStatus === "reachable").length;
  if (reachable === links.length) return "pass";
  if (reachable > 0) return "partial";
  return "fail";
}

export function listFixtureRelPaths() {
  const out = [];
  function walk(abs, rel) {
    for (const name of readdirSync(abs).sort()) {
      if (name === "PROVENANCE.json") continue;
      const nextAbs = join(abs, name);
      const nextRel = rel ? `${rel}/${name}` : name;
      if (statSync(nextAbs).isDirectory()) walk(nextAbs, nextRel);
      else out.push(nextRel);
    }
  }
  walk(ROOT, "");
  return out;
}
