#!/usr/bin/env node
/**
 * c17 transform: supplied HTML/Markdown → bounded link/artifact index.
 *
 * Deterministic. Inventory-only reachability. No fetch, no clock invention,
 * no model-as-oracle. Parses markup; c16 owns shapes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_KIND,
  BOUNDS,
  DOCUMENT_KINDS,
  FINDING_KINDS,
  INPUT_SCHEMA,
  JOB_ID,
  LIMITATIONS as SCHEMA_LIMITATIONS,
  OUTPUT_SCHEMA,
  classifyHrefScheme,
  createLinkIndexPacket,
  exampleCases,
  sha256Hex,
  validateInput,
  validateOutput,
} from "./schema.mjs";

export {
  ARTIFACT_KIND,
  INPUT_SCHEMA,
  JOB_ID,
  OUTPUT_SCHEMA,
};

const HERE = dirname(fileURLToPath(import.meta.url));

export const TRANSFORM_LIMITATIONS = Object.freeze([
  ...SCHEMA_LIMITATIONS,
  "HTML scan is quoted href/id attributes and <a> pairs; not a DOM parser.",
  "Markdown scan is inline, wrapped image-link, and reference uses. Not CommonMark.",
  "Heading slugs are lowercase, punctuation stripped, whitespace to hyphen.",
  "Fenced code and <script>/<style> regions are masked; offsets stay on the original body.",
  "javascript: is never reachable. http(s) is unknown unless the URL is in the inventory.",
  "Path `..` that leaves the corpus root is missing_artifact (not opened).",
  "Duplicate HTML/heading ids make a fragment conflict; this transform does not pick a winner.",
]);

const ID_SAFE = /[^A-Za-z0-9._:-]+/g;

export function slugHeading(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

export function locFromOffset(source, offset) {
  const clamped = Math.max(0, Math.min(Number(offset) || 0, source.length));
  const pre = source.slice(0, clamped);
  const nl = pre.lastIndexOf("\n");
  const line = (pre.match(/\n/g) || []).length + 1;
  const column = clamped - (nl === -1 ? 0 : nl + 1) + 1;
  return { line, column, offset: clamped };
}

function posixDirname(pathValue) {
  if (!pathValue) return "";
  const norm = String(pathValue).replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i === -1 ? "" : norm.slice(0, i);
}

function splitHref(href) {
  const raw = String(href);
  const hash = raw.indexOf("#");
  if (hash === -1) return { path: raw, fragment: null };
  return { path: raw.slice(0, hash), fragment: raw.slice(hash + 1) };
}

function joinBounded(fromDir, rel) {
  const start = fromDir ? fromDir.split("/").filter((s) => s && s !== ".") : [];
  const parts = [...start];
  for (const seg of String(rel).replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return { outOfBound: true, path: null };
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return { outOfBound: false, path: parts.join("/") };
}

function underRoot(root, pathValue) {
  if (!root) return true;
  if (!pathValue) return false;
  return pathValue === root || pathValue.startsWith(`${root}/`);
}

function corpusRoot(paths) {
  const dirs = paths
    .filter((p) => typeof p === "string" && p.length > 0)
    .map((p) => posixDirname(p.replace(/\\/g, "/")));
  const nonempty = dirs.filter(Boolean);
  if (nonempty.length === 0) return "";
  const parts = nonempty[0].split("/");
  let n = parts.length;
  for (const dir of nonempty.slice(1)) {
    const segs = dir.split("/");
    let i = 0;
    while (i < n && i < segs.length && segs[i] === parts[i]) i += 1;
    n = i;
  }
  return parts.slice(0, n).join("/");
}

function makeId(prefix, hint, used) {
  let core = String(hint || "x")
    .replace(ID_SAFE, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!/^[A-Za-z]/.test(core)) core = `x${core}`;
  if (!core) core = "x";
  let id = `${prefix}-${core}`.slice(0, 128);
  let n = 2;
  while (used.has(id)) {
    const suffix = `-${n}`;
    id = `${prefix}-${core}`.slice(0, 128 - suffix.length) + suffix;
    n += 1;
  }
  used.add(id);
  return id;
}

function maskRegions(source, patterns) {
  let out = source;
  for (const re of patterns) {
    const copy = new RegExp(re.source, re.flags);
    out = out.replace(copy, (m) => " ".repeat(m.length));
  }
  return out;
}

function scanSurface(kind, source) {
  if (kind === "html") {
    return maskRegions(source, [
      /<script\b[\s\S]*?<\/script>/gi,
      /<style\b[\s\S]*?<\/style>/gi,
    ]);
  }
  return maskRegions(source, [
    /^```[\s\S]*?^```/gm,
    /`[^`\n]+`/g,
  ]);
}

export function collectDestinationIds(kind, source) {
  const ids = [];
  if (typeof source !== "string") return ids;
  const idRe = /\bid\s*=\s*"([^"]+)"/gi;
  let match;
  while ((match = idRe.exec(source))) {
    ids.push({ id: match[1], index: match.index, kind: "html-id" });
  }
  if (kind === "markdown") {
    const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;
    while ((match = headingRe.exec(source))) {
      ids.push({
        id: slugHeading(match[2]),
        text: match[2],
        level: match[1].length,
        index: match.index,
        kind: "md-heading",
      });
    }
  }
  return ids;
}

function pushLink(out, used, rec) {
  out.push(rec);
  used.push([rec.startOffset, rec.endOffset]);
}

function overlaps(used, start, end) {
  return used.some(([a, b]) => start < b && end > a);
}

export function scanHtml(source) {
  const surface = scanSurface("html", source);
  const links = [];
  const used = [];
  const anchorRe = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(surface))) {
    const hrefMatch = /\bhref\s*=\s*"([^"]*)"/.exec(match[1]);
    if (!hrefMatch) continue;
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    pushLink(links, used, {
      kind: "html_a",
      href: hrefMatch[1],
      text: match[2].replace(/<[^>]+>/g, "").trim(),
      markup: source.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      syntax: "html-a",
    });
  }
  const imgRe = /<img\b([^>]*?)\/>|<img\b([^>]*?)>/gi;
  while ((match = imgRe.exec(surface))) {
    const attrs = match[1] || match[2] || "";
    const srcMatch = /\bsrc\s*=\s*"([^"]*)"/.exec(attrs);
    if (!srcMatch) continue;
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    if (overlaps(used, startOffset, endOffset)) continue;
    const altMatch = /\balt\s*=\s*"([^"]*)"/.exec(attrs);
    pushLink(links, used, {
      kind: "html_img",
      href: srcMatch[1],
      text: altMatch ? altMatch[1] : "",
      markup: source.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      syntax: "html-img",
    });
  }
  links.sort((a, b) => a.startOffset - b.startOffset);
  return { links, destinationIds: collectDestinationIds("html", source) };
}

export function scanMarkdown(source) {
  const surface = scanSurface("markdown", source);
  const links = [];
  const used = [];
  const refDefs = [];
  const defRe = /^\[([^\]]+)\]:\s+(\S+)\s*$/gm;
  let match;
  while ((match = defRe.exec(source))) {
    refDefs.push({
      refId: match[1],
      href: match[2],
      index: match.index,
    });
  }
  const refMap = new Map(refDefs.map((d) => [d.refId.toLowerCase(), d]));

  const wrappedRe = /\[!\[([^\]]*)\]\(([^)\s]+)\)\]\(([^)\s]+)\)/g;
  while ((match = wrappedRe.exec(surface))) {
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    const imgStart = source.indexOf("![", startOffset);
    pushLink(links, used, {
      kind: "markdown_inline",
      href: match[3],
      text: `![${match[1]}](${match[2]})`,
      markup: source.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      syntax: "md-inline",
      containsImage: true,
    });
    if (imgStart >= startOffset && imgStart < endOffset) {
      const innerMarkup = `![${match[1]}](${match[2]})`;
      links.push({
        kind: "markdown_inline",
        href: match[2],
        text: match[1],
        markup: innerMarkup,
        startOffset: imgStart,
        endOffset: imgStart + innerMarkup.length,
        syntax: "md-inline",
        image: true,
      });
    }
  }

  const inlineRe = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
  while ((match = inlineRe.exec(surface))) {
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    if (overlaps(used, startOffset, endOffset)) continue;
    const dest = match[3].trim().split(/\s+/)[0].replace(/^<|>$/g, "");
    pushLink(links, used, {
      kind: "markdown_inline",
      href: dest,
      text: match[2],
      markup: source.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      syntax: "md-inline",
      image: match[1] === "!",
    });
  }

  const refUseRe = /\[([^\]]+)\]\[([^\]]+)\]/g;
  while ((match = refUseRe.exec(surface))) {
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    if (overlaps(used, startOffset, endOffset)) continue;
    const def = refMap.get(match[2].toLowerCase());
    links.push({
      kind: "markdown_reference",
      href: def ? def.href : "",
      text: match[1],
      markup: source.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      syntax: "md-reference",
      refId: match[2],
      resolved: Boolean(def),
    });
  }

  links.sort((a, b) => a.startOffset - b.startOffset || (a.image ? -1 : 0));
  return { links, destinationIds: collectDestinationIds("markdown", source), refDefs };
}

export function scanDocument(kind, source) {
  return kind === "html" ? scanHtml(source) : scanMarkdown(source);
}

function inferKind(doc) {
  if (DOCUMENT_KINDS.includes(doc.kind)) return doc.kind;
  const media = doc.mediaType || "";
  if (media.includes("html")) return "html";
  if (media.includes("markdown")) return "markdown";
  const pathValue = String(doc.path || doc.url || "");
  if (/\.html?$/i.test(pathValue)) return "html";
  if (/\.(md|markdown)$/i.test(pathValue)) return "markdown";
  return null;
}

function bodyOf(doc) {
  if (typeof doc.body === "string") return doc.body;
  if (typeof doc.content === "string") return doc.content;
  return null;
}

function locatorKey(pathValue, urlValue, fragment) {
  return `${pathValue ?? ""}|${urlValue ?? ""}|${fragment ?? ""}`;
}

function findingKindFor(status, reason, scheme) {
  if (scheme === "javascript") return "hostile_scheme";
  if (reason === "empty_href") return "empty_href";
  if (reason === "missing_fragment") return "missing_fragment";
  if (reason === "artifact_hash_conflict" || status === "conflict") return "conflicting_target";
  if (status === "unknown") return "unknown_external";
  if (status === "unreachable") return "unreachable_target";
  return "reachable";
}

function messageFor(link, classified) {
  if (classified.findingKind === "empty_href") return "empty href is not a citation target";
  if (classified.findingKind === "hostile_scheme") return `scheme ${classified.scheme} is not reachable`;
  if (classified.findingKind === "missing_fragment") {
    return `fragment ${classified.fragment} is not in the supplied target`;
  }
  if (classified.findingKind === "conflicting_target") {
    return "inventory locator disagrees or fragment id is duplicated; no winner chosen";
  }
  if (classified.findingKind === "unknown_external") {
    return "href is not in the supplied inventory and was not fetched";
  }
  if (classified.findingKind === "unreachable_target") {
    return `href ${link.href} is not in the supplied inventory`;
  }
  if (classified.fragment) return `href resolved to inventory artifact ${classified.artifactId}#${classified.fragment}`;
  return `href resolved to inventory artifact ${classified.artifactId}`;
}

function lookupPath(inventory, pathValue) {
  if (!pathValue) return [];
  const want = pathValue.replace(/\\/g, "/");
  return inventory.filter((row) => (row.path || "").replace(/\\/g, "/") === want);
}

function lookupUrl(inventory, href) {
  const { path: withoutHash } = splitHref(href);
  return inventory.filter((row) => row.url === href || row.url === withoutHash);
}

function destIdsFor(row) {
  if (Array.isArray(row.destinationIds) && row.destinationIds.length) return row.destinationIds;
  if (Array.isArray(row.headingIds)) {
    return row.headingIds.map((id) => ({ id, kind: "supplied" }));
  }
  const body = bodyOf(row);
  if (typeof body !== "string") return null;
  const kind = inferKind(row) || (String(row.path || "").endsWith(".md") ? "markdown" : "html");
  return collectDestinationIds(kind, body);
}

function classifyResolved(href, schemeInfo, matches, fragment) {
  if (matches.length === 0) {
    if (schemeInfo.scheme === "http" || schemeInfo.scheme === "https" || schemeInfo.scheme === "protocol-relative" || schemeInfo.scheme === "data" || schemeInfo.scheme === "mailto" || schemeInfo.scheme === "file") {
      return {
        status: "unknown",
        scheme: schemeInfo.scheme,
        findingKind: "unknown_external",
        fragment,
      };
    }
    return {
      status: "unreachable",
      scheme: schemeInfo.scheme,
      reason: "missing_artifact",
      findingKind: "unreachable_target",
      fragment,
    };
  }
  const hashes = [...new Set(matches.map((m) => m.contentSha256).filter(Boolean))];
  if (hashes.length > 1) {
    return {
      status: "conflict",
      scheme: schemeInfo.scheme,
      reason: "artifact_hash_conflict",
      findingKind: "conflicting_target",
      artifactIds: matches.map((m) => m.id),
      contentSha256s: hashes,
      artifactId: undefined,
      fragment,
      matches,
    };
  }
  const row = matches[0];
  if (fragment) {
    const dest = destIdsFor(row);
    if (dest == null) {
      if (row.fragment && row.fragment === fragment) {
        return {
          status: "reachable",
          scheme: schemeInfo.scheme,
          artifactId: row.id,
          fragment,
        };
      }
      return {
        status: "unknown",
        scheme: schemeInfo.scheme,
        findingKind: "unknown_external",
        fragment,
        artifactId: row.id,
        reason: "missing_body",
      };
    }
    const hits = dest.filter((d) => d.id === fragment);
    if (hits.length === 0) {
      return {
        status: "unreachable",
        scheme: schemeInfo.scheme,
        reason: "missing_fragment",
        findingKind: "missing_fragment",
        artifactId: row.id,
        fragment,
      };
    }
    if (hits.length > 1) {
      const hashesForId = hits.map((h) => sha256Hex(`${h.kind}:${h.index}:${h.id}`));
      return {
        status: "conflict",
        scheme: schemeInfo.scheme,
        reason: "duplicate_id",
        findingKind: "conflicting_target",
        artifactId: row.id,
        artifactIds: hits.map((_, i) => `${row.id}-frag-${i + 1}`),
        contentSha256s: hashesForId,
        fragment,
        idCount: hits.length,
        matches: hits.map((h, i) => ({
          id: `${row.id}-frag-${i + 1}`,
          contentSha256: hashesForId[i],
          index: h.index,
        })),
      };
    }
  }
  return {
    status: "reachable",
    scheme: schemeInfo.scheme,
    artifactId: row.id,
    fragment: fragment || null,
  };
}

export function classifyInventoryHref(href, ctx) {
  const schemeInfo = classifyHrefScheme(href);
  if (schemeInfo.scheme === "empty" || href === "") {
    return {
      status: "unreachable",
      scheme: "empty",
      reason: "empty_href",
      findingKind: "empty_href",
      fragment: null,
    };
  }
  if (schemeInfo.scheme === "javascript") {
    return {
      status: "unknown",
      scheme: "javascript",
      findingKind: "hostile_scheme",
      fragment: null,
    };
  }
  const { path: rel, fragment } = splitHref(href);
  if (schemeInfo.scheme === "fragment") {
    const matches = lookupPath(ctx.inventory, ctx.sourcePath);
    return classifyResolved(href, schemeInfo, matches, fragment);
  }
  if (schemeInfo.scheme === "http" || schemeInfo.scheme === "https") {
    return classifyResolved(href, schemeInfo, lookupUrl(ctx.inventory, href), fragment);
  }
  if (schemeInfo.scheme !== "relative") {
    const byUrl = lookupUrl(ctx.inventory, href);
    if (byUrl.length) return classifyResolved(href, schemeInfo, byUrl, fragment);
    return {
      status: "unknown",
      scheme: schemeInfo.scheme,
      findingKind: "unknown_external",
      fragment,
    };
  }
  const joined = joinBounded(posixDirname(ctx.sourcePath), rel);
  if (joined.outOfBound || !underRoot(ctx.root, joined.path)) {
    return {
      status: "unreachable",
      scheme: "relative",
      reason: "missing_artifact",
      findingKind: "unreachable_target",
      fragment,
      targetPath: rel,
    };
  }
  const matches = lookupPath(ctx.inventory, joined.path);
  const classified = classifyResolved(href, schemeInfo, matches, fragment);
  return { ...classified, targetPath: joined.path, scheme: "relative" };
}

function normalizeDocuments(input, usedIds) {
  const documents = [];
  for (const raw of input.documents || []) {
    const kind = inferKind(raw);
    const id = raw.id && !usedIds.has(raw.id) ? raw.id : makeId("doc", raw.path || raw.url || raw.id || "doc", usedIds);
    if (raw.id) usedIds.add(raw.id);
    const body = bodyOf(raw);
    const hash =
      typeof raw.contentSha256 === "string"
        ? raw.contentSha256
        : typeof body === "string"
          ? sha256Hex(body)
          : undefined;
    documents.push({
      ...raw,
      id,
      kind: kind || raw.kind,
      body,
      contentSha256: hash,
      unknown: body == null,
    });
  }
  return documents;
}

function buildInventory(documents, artifacts, usedIds) {
  const inventory = [];
  const pathHashes = new Map();
  const hashConflicts = [];

  function add(row, implicit) {
    const id = row.id && !usedIds.has(row.id) ? row.id : makeId("art", row.path || row.url || row.id || "art", usedIds);
    if (row.id) usedIds.add(row.id);
    const rec = {
      id,
      path: row.path,
      url: row.url,
      exists: row.exists,
      fragment: row.fragment,
      contentSha256: row.contentSha256,
      headingIds: row.headingIds,
      body: bodyOf(row),
      kind: inferKind(row),
      implicit: Boolean(implicit),
    };
    if (typeof rec.body === "string" && !rec.contentSha256) rec.contentSha256 = sha256Hex(rec.body);
    const key = locatorKey(rec.path, rec.url, rec.fragment);
    if (rec.contentSha256) {
      const prior = pathHashes.get(key);
      if (prior && prior.hash !== rec.contentSha256) {
        hashConflicts.push({
          key,
          hrefExact: rec.path || rec.url || "",
          artifactIds: [prior.id, rec.id],
          contentSha256s: [prior.hash, rec.contentSha256],
        });
      } else pathHashes.set(key, { hash: rec.contentSha256, id: rec.id });
    }
    inventory.push(rec);
    return rec;
  }

  for (const art of artifacts || []) add(art, false);
  for (const doc of documents) {
    if (!doc.path && !doc.url) continue;
    const already = inventory.some(
      (row) => row.path === doc.path && row.url === doc.url && !row.fragment,
    );
    if (!already) add({ ...doc, exists: true }, true);
  }
  return { inventory, hashConflicts };
}

function citeFor(row, evidenceClass, usedIds) {
  const id = makeId("cite", row.path || row.url || row.id, usedIds);
  const citation = {
    id,
    path: row.path || undefined,
    url: row.url || undefined,
    contentSha256: row.contentSha256,
    evidenceClass,
  };
  if (!citation.path && !citation.url) citation.path = row.id;
  return citation;
}

/**
 * @param {object} input s137.link-index.input.v1
 * @returns {{ ok: boolean, status: string, issues: object[], packet: object|null }}
 */
export function transformLinkIndex(input = {}) {
  const issues = [];
  const checked = validateInput(input);
  issues.push(...checked.issues);

  if (!input || typeof input !== "object") {
    return { ok: false, status: "invalid", issues, packet: null };
  }
  if (!input.clock || input.clock === "now" || input.clock === "NOW") {
    const err = new Error("clock required (operator-supplied; do not invent)");
    err.code = "clock";
    err.issues = checked.issues;
    if (checked.status === "invalid") return { ok: false, status: "invalid", issues, packet: null, error: err };
  }

  const invalidBlocking = checked.issues.some(
    (row) => row.kind === "invalid" && (row.code === "clock" || row.code === "clock_now" || row.code === "minItems" || row.code === "evidenceClass" || row.code === "hostile_key" || row.code === "type" && row.instancePath === "/documents"),
  );
  if (invalidBlocking || !Array.isArray(input.documents) || input.documents.length === 0) {
    return { ok: false, status: checked.status || "invalid", issues, packet: null };
  }

  const usedIds = new Set();
  const documents = normalizeDocuments(input, usedIds);
  const { inventory, hashConflicts } = buildInventory(documents, input.artifacts || [], usedIds);
  const paths = [
    ...documents.map((d) => d.path).filter(Boolean),
    ...inventory.map((a) => a.path).filter(Boolean),
  ];
  const root = typeof input.root === "string" ? input.root : corpusRoot(paths);

  const maxLinks = Number.isInteger(input.bounds?.maxLinks)
    ? Math.min(input.bounds.maxLinks, BOUNDS.maxLinks)
    : BOUNDS.maxLinks;
  const maxBodyBytes = Number.isInteger(input.bounds?.maxBodyBytes)
    ? Math.min(input.bounds.maxBodyBytes, BOUNDS.maxBodyBytes)
    : BOUNDS.maxBodyBytes;

  const citeUsed = new Set();
  const citations = [];
  const citationByLocator = new Map();
  function citationIdFor(row) {
    if (!row) {
      if (citations[0]) return citations[0].id;
      const citation = citeFor({ id: "input", path: "input" }, input.evidenceClass || "synthetic", citeUsed);
      citations.push(citation);
      return citation.id;
    }
    const key = locatorKey(row.path, row.url, null);
    if (citationByLocator.has(key)) return citationByLocator.get(key);
    const citation = citeFor(row, input.evidenceClass || "synthetic", citeUsed);
    citations.push(citation);
    citationByLocator.set(key, citation.id);
    return citation.id;
  }
  for (const doc of documents) citationIdFor(doc);

  const anchors = [];
  const links = [];
  const targetByHref = new Map();
  const targets = [];
  const rawLinks = [];
  let truncated = false;
  let documentsIndexed = 0;
  let documentsUnknown = 0;

  for (const doc of documents) {
    if (doc.body == null) {
      documentsUnknown += 1;
      continue;
    }
    if (Buffer.byteLength(doc.body, "utf8") > maxBodyBytes) {
      documentsUnknown += 1;
      issues.push({
        kind: "invalid",
        code: "maxBodyBytes",
        instancePath: `/documents/${doc.id}/body`,
        message: "body exceeds bound; not indexed",
      });
      continue;
    }
    const kind = inferKind(doc);
    if (!kind) {
      documentsUnknown += 1;
      continue;
    }
    documentsIndexed += 1;
    const scanned = scanDocument(kind, doc.body);
    doc.headingIds = [...new Set(scanned.destinationIds.map((d) => d.id))];
    doc.destinationIds = scanned.destinationIds;
    const invRow = inventory.find((row) => row.path === doc.path && row.url === doc.url);
    if (invRow) {
      invRow.destinationIds = scanned.destinationIds;
      invRow.headingIds = doc.headingIds;
      invRow.body = doc.body;
      invRow.kind = kind;
    }
    for (const rec of scanned.links) {
      rawLinks.push({ ...rec, document: doc });
    }
  }

  if (rawLinks.length > maxLinks) truncated = true;
  const observed = rawLinks.slice(0, maxLinks);

  for (const rec of observed) {
    const doc = rec.document;
    const loc = locFromOffset(doc.body, rec.startOffset);
    const classified = classifyInventoryHref(rec.href, {
      sourcePath: doc.path || "",
      inventory,
      root,
    });
    const hashHit = hashConflicts.find((c) => {
      const resolved = classified.targetPath || rec.href;
      return c.hrefExact === resolved || c.key.startsWith(`${resolved}|`);
    });
    const finalClass = hashHit
      ? {
          ...classified,
          status: "conflict",
          findingKind: "conflicting_target",
          reason: "artifact_hash_conflict",
          artifactIds: hashHit.artifactIds,
          contentSha256s: hashHit.contentSha256s,
        }
      : classified;

    const anchorId = makeId("anc", `${doc.id}-${rec.startOffset}`, usedIds);
    anchors.push({
      id: anchorId,
      documentId: doc.id,
      startOffset: rec.startOffset,
      endOffset: rec.endOffset,
      line: loc.line,
      column: loc.column,
      hrefExact: rec.href,
    });

    let target = targetByHref.get(rec.href);
    if (!target) {
      const targetId = makeId("tgt", rec.href || "empty", usedIds);
      target = {
        id: targetId,
        hrefExact: rec.href,
        scheme: finalClass.scheme || classifyHrefScheme(rec.href).scheme,
        status: finalClass.status,
        artifactId: finalClass.status === "reachable" ? finalClass.artifactId : finalClass.artifactId,
        reason: finalClass.reason,
      };
      if (target.status === "reachable" && !target.artifactId) {
        target.status = "unreachable";
        target.reason = "missing_artifact";
      }
      if (target.status !== "reachable") delete target.artifactId;
      else target.artifactId = finalClass.artifactId;
      targets.push(target);
      targetByHref.set(rec.href, target);
    } else if (finalClass.status === "conflict") {
      target.status = "conflict";
      target.reason = finalClass.reason;
      delete target.artifactId;
    }

    const linkId = makeId("link", `${doc.id}-${rec.startOffset}`, usedIds);
    const link = {
      id: linkId,
      documentId: doc.id,
      document: doc,
      kind: rec.kind,
      href: rec.href,
      text: rec.text,
      scheme: finalClass.scheme || classifyHrefScheme(rec.href).scheme,
      targetStatus: target.status,
      targetId: target.id,
      anchorId,
      targetPath: finalClass.targetPath,
      fragment: finalClass.fragment ?? splitHref(rec.href).fragment,
      syntax: rec.syntax,
      markup: rec.markup,
      index: rec.startOffset,
      refId: rec.refId,
      resolved: rec.resolved,
      idCount: finalClass.idCount,
      classified: finalClass,
    };
    links.push(link);
  }

  const hrefGroups = new Map();
  for (const link of links) {
    const list = hrefGroups.get(link.href) || [];
    list.push(link);
    hrefGroups.set(link.href, list);
  }
  const duplicates = [];
  for (const [href, group] of hrefGroups) {
    if (group.length < 2) continue;
    duplicates.push({
      id: makeId("dup", href || "empty", usedIds),
      match: "exact_href",
      hrefExact: href,
      linkIds: group.map((l) => l.id),
    });
  }

  const unreachable = [];
  const unreachableReasons = new Set(["missing_artifact", "missing_fragment", "empty_href"]);
  for (const [href, group] of hrefGroups) {
    const sample = group[0];
    const reason = sample.classified?.reason;
    if (sample.targetStatus !== "unreachable" || !unreachableReasons.has(reason)) continue;
    unreachable.push({
      id: makeId("unr", href || "empty", usedIds),
      hrefExact: href,
      reason,
      linkIds: group.map((l) => l.id),
      citationIds: [citationIdFor(sample.document)],
    });
  }

  const conflicts = [];
  for (const row of hashConflicts) {
    const citeIds = [];
    for (const artId of row.artifactIds) {
      const art = inventory.find((a) => a.id === artId);
      if (art) citeIds.push(citationIdFor(art));
    }
    if (citeIds.length === 0 && citations[0]) citeIds.push(citations[0].id);
    conflicts.push({
      id: makeId("conf", row.hrefExact, usedIds),
      hrefExact: row.hrefExact,
      artifactIds: row.artifactIds,
      contentSha256s: row.contentSha256s,
      citationIds: [...new Set(citeIds)],
    });
  }
  for (const link of links) {
    const c = link.classified;
    if (c?.reason === "duplicate_id" && Array.isArray(c.contentSha256s) && c.contentSha256s.length >= 2) {
      const already = conflicts.some((row) => row.hrefExact === link.href);
      if (already) continue;
      conflicts.push({
        id: makeId("conf", link.href, usedIds),
        hrefExact: link.href,
        artifactIds: c.artifactIds,
        contentSha256s: c.contentSha256s,
        citationIds: [citationIdFor(link.document)],
      });
    }
  }
  const textMap = new Map();
  for (const link of links) {
    if (!link.text) continue;
    const rec = textMap.get(link.text) || { hrefs: new Set(), links: [], arts: new Map() };
    rec.hrefs.add(link.href);
    rec.links.push(link);
    if (link.classified?.artifactId) {
      const art = inventory.find((a) => a.id === link.classified.artifactId);
      if (art?.contentSha256) rec.arts.set(art.id, art.contentSha256);
    }
    textMap.set(link.text, rec);
  }
  for (const [text, rec] of textMap) {
    if (rec.hrefs.size < 2) continue;
    const artifactIds = [...rec.arts.keys()];
    const hashes = [...rec.arts.values()];
    if (artifactIds.length < 2 || new Set(hashes).size < 2) continue;
    conflicts.push({
      id: makeId("conf", text, usedIds),
      hrefExact: text,
      artifactIds,
      contentSha256s: hashes,
      citationIds: [...new Set(rec.links.map((l) => citationIdFor(l.document)).concat(artifactIds.map((id) => {
        const art = inventory.find((a) => a.id === id);
        return art ? citationIdFor(art) : citationIdFor(rec.links[0].document);
      })))],
    });
  }

  const findings = [];
  function addFinding(kind, message, citationIds, extra = {}) {
    if (!FINDING_KINDS.includes(kind)) return;
    const ids = [...new Set(citationIds.filter(Boolean))];
    if (ids.length === 0) return;
    findings.push({
      id: makeId("find", kind, usedIds),
      kind,
      message: message.slice(0, BOUNDS.maxMessageChars),
      citationIds: ids,
      ...extra,
    });
  }

  for (const doc of documents) {
    if (doc.unknown) {
      addFinding(
        "missing_body",
        `document ${doc.id} has a locator but no body; disk is not read`,
        [citationIdFor(doc)],
        { documentId: doc.id },
      );
    }
  }
  if (truncated) {
    addFinding(
      "truncated_bound",
      `links truncated to maxLinks ${maxLinks}`,
      [citationIdFor(documents[0])],
    );
  }
  for (const dup of duplicates) {
    const group = dup.linkIds.map((id) => links.find((l) => l.id === id)).filter(Boolean);
    addFinding(
      "duplicate_href",
      `href ${dup.hrefExact} appears ${group.length} times`,
      group.map((l) => citationIdFor(l.document)),
      { linkIds: dup.linkIds },
    );
  }
  for (const row of conflicts) {
    addFinding(
      "conflicting_target",
      `locator ${row.hrefExact} has disagreeing inventory evidence`,
      row.citationIds,
    );
  }
  for (const link of links) {
    const kind = findingKindFor(link.targetStatus, link.classified?.reason, link.scheme);
    if (kind === "reachable" && conflicts.length) continue;
    if (kind === "duplicate_href") continue;
    const cite = [citationIdFor(link.document)];
    if (link.classified?.artifactId) {
      const art = inventory.find((a) => a.id === link.classified.artifactId);
      if (art) cite.push(citationIdFor(art));
    }
    if (kind === "reachable" || kind === "unreachable_target" || kind === "missing_fragment" || kind === "unknown_external" || kind === "empty_href" || kind === "hostile_scheme") {
      addFinding(kind, messageFor(link, { ...link.classified, findingKind: kind, scheme: link.scheme }), cite, {
        linkIds: [link.id],
        documentId: link.documentId,
      });
    }
  }

  const linksUnknown = links.filter((l) => l.targetStatus === "unknown").length;
  const hasUnreachable = unreachable.length > 0;
  const hasConflicts = conflicts.length > 0;
  let decision = "pass";
  if (hasConflicts) decision = "conflict";
  else if (hasUnreachable && links.some((l) => l.targetStatus === "reachable")) decision = "partial";
  else if (linksUnknown > 0 && links.some((l) => l.targetStatus === "reachable")) decision = "partial";
  else if (truncated) decision = "partial";
  else if (documentsUnknown > 0 && documentsIndexed > 0) decision = "partial";
  else if (hasUnreachable || (links.length > 0 && !links.some((l) => l.targetStatus === "reachable"))) decision = "fail";
  else if (links.length === 0) decision = "fail";
  else if (linksUnknown > 0) decision = "partial";

  const outDocuments = documents.map((doc) => ({
    id: doc.id,
    kind: inferKind(doc) || doc.kind || "markdown",
    path: doc.path,
    url: doc.url,
    contentSha256: doc.contentSha256,
    linkCount: links.filter((l) => l.documentId === doc.id).length,
    headingIds: doc.headingIds,
  }));
  for (const doc of outDocuments) {
    if (!DOCUMENT_KINDS.includes(doc.kind)) doc.kind = "markdown";
    if (!doc.path && !doc.url) doc.path = doc.id;
  }

  const packet = createLinkIndexPacket({
    clock: input.clock,
    evidenceClass: input.evidenceClass,
    sources: citations,
    findings,
    citations,
    decision,
    limitations: [
      ...TRANSFORM_LIMITATIONS,
      ...(Array.isArray(input.limitations) ? input.limitations : []),
    ],
    documents: outDocuments,
    links: links.map((l) => ({
      id: l.id,
      documentId: l.documentId,
      kind: l.kind,
      href: l.href,
      text: l.text,
      scheme: l.scheme,
      targetStatus: l.targetStatus,
      targetId: l.targetId,
      anchorId: l.anchorId,
    })),
    anchors,
    targets,
    duplicates,
    unreachable,
    conflicts,
    bounds: {
      maxDocuments: input.bounds?.maxDocuments ?? BOUNDS.maxDocuments,
      maxLinks,
      maxBodyBytes,
      truncated,
    },
    coverage: {
      documentsIndexed,
      documentsUnknown,
      linksObserved: links.length,
      linksUnknown,
      inventoryConsulted: true,
      networkFetched: false,
    },
  });

  const outputCheck = validateOutput(packet);
  if (!outputCheck.ok) issues.push(...outputCheck.issues);
  return {
    ok: outputCheck.ok,
    status: outputCheck.status,
    issues,
    packet,
    index: {
      links,
      anchors,
      targets,
      duplicates,
      unreachable,
      conflicts,
    },
  };
}

export function transform(input) {
  const result = transformLinkIndex(input);
  if (!result.packet) {
    const err = new Error(result.issues[0]?.message || "invalid link-index input");
    err.issues = result.issues;
    err.status = result.status;
    throw err;
  }
  return result.packet;
}

function isDirectRun() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(argv1);
  } catch {
    return false;
  }
}

function loadFixtureCase(caseId) {
  const root = join(HERE, "..", "..", "fixtures", "synthetic", "link-index");
  const expected = JSON.parse(readFileSync(join(root, "cases", caseId, "expected.json"), "utf8"));
  const dir = join(root, "cases", caseId);
  const entryBody = readFileSync(join(dir, expected.entry), "utf8");
  const documents = [
    {
      id: "doc-entry",
      kind: expected.format === "html" ? "html" : "markdown",
      path: expected.entry,
      body: entryBody,
      contentSha256: sha256Hex(entryBody),
      mediaType: expected.format === "html" ? "text/html" : "text/markdown",
    },
  ];
  const artifacts = [];
  const used = new Set(["doc-entry"]);
  for (const cite of expected.citations || []) {
    if (!cite.path || cite.path === expected.entry) continue;
    const body = readFileSync(join(dir, cite.path), "utf8");
    artifacts.push({
      id: makeId("art", cite.path, used),
      path: cite.path,
      exists: true,
      contentSha256: sha256Hex(body),
      body,
    });
  }
  return {
    expected,
    input: {
      schema: INPUT_SCHEMA,
      clock: expected.clock,
      evidenceClass: "synthetic",
      caseKind: expected.kind === "conflict" ? "conflict" : expected.kind,
      documents,
      artifacts,
    },
  };
}

export function selfCheck() {
  const cases = exampleCases();
  const pos = transformLinkIndex(cases.positive.input);
  const part = transformLinkIndex(cases.partial.input);
  const conf = transformLinkIndex(cases.conflict.input);
  const neg = transformLinkIndex(cases.negative.input);
  const html = loadFixtureCase("positive-html");
  const htmlOut = transformLinkIndex(html.input);
  const mixed = loadFixtureCase("partial-mixed");
  const mixedOut = transformLinkIndex(mixed.input);
  const dups = loadFixtureCase("conflict-duplicates");
  const dupsOut = transformLinkIndex(dups.input);
  const empty = loadFixtureCase("negative-empty");
  const emptyOut = transformLinkIndex(empty.input);
  const report = {
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    schemaPositive: pos.ok && pos.packet?.decision === "pass",
    schemaPartial: part.ok && part.packet?.decision === "partial",
    schemaConflict: conf.ok && conf.packet?.decision === "conflict",
    schemaNegative: neg.packet == null && neg.status === "invalid",
    fixturePositiveHtml: htmlOut.ok && htmlOut.packet?.decision === "pass" && htmlOut.packet.links.length === 3,
    fixturePartial: mixedOut.ok && mixedOut.packet?.decision === "partial",
    fixtureConflictDups: dupsOut.ok && dupsOut.packet?.decision === "conflict" && dupsOut.packet.duplicates.length >= 1,
    fixtureEmpty: emptyOut.ok && emptyOut.packet?.decision === "fail" && emptyOut.packet.links.length === 0,
    outputIssues: {
      pos: pos.issues.filter((i) => i.kind === "invalid").length,
      html: htmlOut.issues.filter((i) => i.kind === "invalid").length,
      mixed: mixedOut.issues.filter((i) => i.kind === "invalid").length,
      dups: dupsOut.issues.filter((i) => i.kind === "invalid").length,
    },
  };
  report.ok = Boolean(
    report.schemaPositive
      && report.schemaPartial
      && report.schemaConflict
      && report.schemaNegative
      && report.fixturePositiveHtml
      && report.fixturePartial
      && report.fixtureConflictDups
      && report.fixtureEmpty,
  );
  return report;
}

export async function registerTransformTests({ test, assert }) {
  test("schema positive example indexes ./spec.md as reachable", () => {
    const { input } = exampleCases().positive;
    const { ok, packet, issues } = transformLinkIndex(input);
    assert.equal(ok, true, JSON.stringify(issues.slice(0, 5), null, 2));
    assert.equal(packet.decision, "pass");
    assert.equal(packet.schema, OUTPUT_SCHEMA);
    assert.equal(packet.offline, true);
    assert.equal(packet.payment.attempted, false);
    assert.equal(packet.coverage.networkFetched, false);
    assert.equal(packet.links.length, 1);
    assert.equal(packet.links[0].href, "./spec.md");
    assert.equal(packet.links[0].targetStatus, "reachable");
    assert.equal(packet.unreachable.length, 0);
    assert.equal(packet.conflicts.length, 0);
    assert.ok(packet.anchors[0].hrefExact === "./spec.md");
    assert.ok(Number.isInteger(packet.anchors[0].startOffset));
    for (const finding of packet.findings) {
      assert.ok(finding.citationIds.length > 0);
      assert.ok(FINDING_KINDS.includes(finding.kind));
    }
  });

  test("negative: missing clock / empty documents do not invent an index", () => {
    const missing = transformLinkIndex({ evidenceClass: "synthetic", documents: [{ id: "doc-a", kind: "markdown", path: "a.md", body: "x" }] });
    assert.equal(missing.packet, null);
    const now = transformLinkIndex({ clock: "now", evidenceClass: "synthetic", documents: [{ id: "doc-a", kind: "markdown", path: "a.md", body: "x" }] });
    assert.equal(now.packet, null);
    const emptyDocs = transformLinkIndex({ clock: "2026-09-10T12:00:00.000Z", evidenceClass: "synthetic", documents: [] });
    assert.equal(emptyDocs.packet, null);
  });

  test("positive HTML fixture: relative, fragment, and self-anchor are reachable", () => {
    const { input } = loadFixtureCase("positive-html");
    const { ok, packet, issues } = transformLinkIndex(input);
    assert.equal(ok, true, JSON.stringify(issues.slice(0, 8), null, 2));
    assert.equal(packet.decision, "pass");
    const hrefs = packet.links.map((l) => l.href);
    assert.deepEqual(hrefs, ["artifacts/guide.md", "artifacts/api.md#auth", "#overview"]);
    assert.ok(packet.links.every((l) => l.targetStatus === "reachable"));
    assert.equal(packet.unreachable.length, 0);
  });

  test("positive MD fixture: inline, reference, and heading slug", () => {
    const { input } = loadFixtureCase("positive-md");
    const { ok, packet, issues } = transformLinkIndex(input);
    assert.equal(ok, true, JSON.stringify(issues.slice(0, 8), null, 2));
    assert.equal(packet.decision, "pass");
    const byHref = Object.fromEntries(packet.links.map((l) => [l.href, l]));
    assert.equal(byHref["artifacts/notes.md#limits"].targetStatus, "reachable");
    assert.equal(byHref["#intro"].targetStatus, "reachable");
    assert.equal(byHref["artifacts/schema.json"].kind, "markdown_reference");
    assert.equal(byHref["artifacts/schema.json"].targetStatus, "reachable");
  });

  test("negative empty and no-links: fail, do not invent hrefs", () => {
    const empty = transformLinkIndex(loadFixtureCase("negative-empty").input);
    assert.equal(empty.ok, true, JSON.stringify(empty.issues.slice(0, 6), null, 2));
    assert.equal(empty.packet.decision, "fail");
    assert.equal(empty.packet.links.length, 0);
    const none = transformLinkIndex(loadFixtureCase("negative-no-links").input);
    assert.equal(none.ok, true, JSON.stringify(none.issues.slice(0, 6), null, 2));
    assert.equal(none.packet.links.length, 0);
    const hrefs = JSON.stringify(none.packet.links.map((l) => l.href));
    assert.equal(hrefs.includes("example.invalid"), false);
  });

  test("negative malformed: empty quoted href is unreachable, unterminated is skipped", () => {
    const { input } = loadFixtureCase("negative-malformed");
    const { ok, packet, issues } = transformLinkIndex(input);
    assert.equal(ok, true, JSON.stringify(issues.slice(0, 8), null, 2));
    assert.equal(packet.decision, "fail");
    assert.equal(packet.links.length, 1);
    assert.equal(packet.links[0].href, "");
    assert.equal(packet.links[0].targetStatus, "unreachable");
    assert.equal(packet.unreachable[0].reason, "empty_href");
    assert.ok(packet.findings.some((f) => f.kind === "empty_href"));
  });

  test("partial mixed: present + missing + dead fragment + external + escape", () => {
    const { input } = loadFixtureCase("partial-mixed");
    const { ok, packet, issues } = transformLinkIndex(input);
    assert.equal(ok, true, JSON.stringify(issues.slice(0, 8), null, 2));
    assert.equal(packet.decision, "partial");
    const byHref = Object.fromEntries(packet.links.map((l) => [l.href, l]));
    assert.equal(byHref["artifacts/present.md"].targetStatus, "reachable");
    assert.equal(byHref["artifacts/missing.md"].targetStatus, "unreachable");
    assert.equal(byHref["artifacts/present.md#no-such-anchor"].targetStatus, "unreachable");
    assert.equal(byHref["https://example.invalid/never-fetched"].targetStatus, "unknown");
    assert.equal(byHref["../outside.md"].targetStatus, "unreachable");
    assert.ok(packet.unreachable.some((u) => u.reason === "missing_artifact"));
    assert.ok(packet.unreachable.some((u) => u.reason === "missing_fragment"));
    assert.equal(packet.coverage.networkFetched, false);
    assert.ok(packet.coverage.linksUnknown >= 1);
  });

  test("conflict: duplicate hrefs and same text bound to different artifacts", () => {
    const { input } = loadFixtureCase("conflict-duplicates");
    const { ok, packet, issues } = transformLinkIndex(input);
    assert.equal(ok, true, JSON.stringify(issues.slice(0, 8), null, 2));
    assert.equal(packet.decision, "conflict");
    assert.ok(packet.duplicates.some((d) => d.hrefExact === "artifacts/alpha.md" && d.linkIds.length === 3));
    assert.ok(packet.conflicts.length >= 1);
    assert.ok(packet.findings.some((f) => f.kind === "duplicate_href"));
    assert.ok(packet.findings.some((f) => f.kind === "conflicting_target"));
  });

  test("conflict: duplicate HTML ids make fragment ambiguous", () => {
    const { input } = loadFixtureCase("conflict-duplicate-ids");
    const { ok, packet, issues } = transformLinkIndex(input);
    assert.equal(ok, true, JSON.stringify(issues.slice(0, 8), null, 2));
    assert.equal(packet.decision, "conflict");
    assert.equal(packet.links[0].href, "#install");
    assert.equal(packet.links[0].targetStatus, "conflict");
    assert.ok(packet.conflicts.some((c) => c.hrefExact === "#install"));
  });

  test("bounds: maxLinks truncates and forbids pass", () => {
    const { input } = loadFixtureCase("positive-html");
    input.bounds = { maxLinks: 1 };
    const { ok, packet, issues } = transformLinkIndex(input);
    assert.equal(ok, true, JSON.stringify(issues.slice(0, 8), null, 2));
    assert.equal(packet.links.length, 1);
    assert.equal(packet.bounds.truncated, true);
    assert.notEqual(packet.decision, "pass");
    assert.ok(packet.findings.some((f) => f.kind === "truncated_bound"));
  });

  test("real README fixture: relative missing, https unknown, slack duplicate, specs/ not a href", () => {
    const dir = join(HERE, "..", "..", "fixtures", "real", "link-index");
    const body = readFileSync(join(dir, "x402-foundation-x402-README.md"), "utf8");
    const { ok, packet, issues } = transformLinkIndex({
      schema: INPUT_SCHEMA,
      clock: "2026-09-10T11:23:12Z",
      evidenceClass: "fixture",
      documents: [
        {
          id: "doc-readme",
          kind: "markdown",
          path: "x402-foundation-x402-README.md",
          url: "https://raw.githubusercontent.com/x402-foundation/x402/3c2ddfb922893c91ef8f281b64f8045d1f5e0d75/README.md",
          body,
          contentSha256: sha256Hex(body),
          mediaType: "text/markdown",
        },
      ],
    });
    assert.equal(ok, true, JSON.stringify(issues.slice(0, 8), null, 2));
    assert.notEqual(packet.decision, "pass");
    assert.equal(packet.coverage.networkFetched, false);
    const hrefs = packet.links.map((l) => l.href);
    assert.equal(hrefs.includes("specs/"), false);
    assert.equal(hrefs.some((h) => h.includes("github.com/x402-foundation/x402/go/v2")), false);
    assert.ok(hrefs.includes("./typescript/"));
    assert.ok(hrefs.includes("http://slack.x402.org/"));
    const slack = packet.links.filter((l) => l.href === "http://slack.x402.org/");
    assert.ok(slack.length >= 2);
    assert.ok(packet.duplicates.some((d) => d.hrefExact === "http://slack.x402.org/"));
    const rel = packet.links.filter((l) => l.href.startsWith("./"));
    assert.ok(rel.every((l) => l.targetStatus === "unreachable"));
    const abs = packet.links.filter((l) => l.href.startsWith("http"));
    assert.ok(abs.every((l) => l.targetStatus === "unknown"));
    assert.equal(createHash("sha256").update(body).digest("hex"), "edc83ee946abfa11f069077737e12f07cc3119c6d9ec5e01e3417f72be014a86");
  });

  test("schema example conflict (disagreeing artifact hashes) stays conflict", () => {
    const { ok, packet, issues } = transformLinkIndex(exampleCases().conflict.input);
    assert.equal(ok, true, JSON.stringify(issues.slice(0, 8), null, 2));
    assert.equal(packet.decision, "conflict");
    assert.ok(packet.conflicts.length >= 1);
    assert.ok(new Set(packet.conflicts[0].contentSha256s).size >= 2);
  });
}

if (isDirectRun()) {
  if (process.argv.includes("--self-check")) {
    const report = selfCheck();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exit(report.ok ? 0 : 1);
  }
  const { test } = await import("node:test");
  const assert = await import("node:assert/strict");
  await registerTransformTests({ test, assert: assert.default ?? assert });
}

export default {
  transform,
  transformLinkIndex,
  scanHtml,
  scanMarkdown,
  slugHeading,
  classifyInventoryHref,
  selfCheck,
};
