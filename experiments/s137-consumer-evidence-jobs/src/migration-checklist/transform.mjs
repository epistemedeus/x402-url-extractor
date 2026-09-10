/**
 * R2-CONSUMER-JOBS-01 migration-checklist transform (S137 c02).
 *
 * Deterministic old/new docs + caller operation inventory → cited checklist.
 * Unknown when a claim has no citation. Does not invent renames, totals,
 * clocks, spend, or demand. Offline; no network.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ARTIFACT_KIND,
  BASELINE_LIMITATIONS,
  CHECKLIST_KINDS,
  DECISIONS,
  EVIDENCE_CLASSES,
  HTTP_METHODS,
  JOB_ID,
  OUTPUT_SCHEMA,
  PACKET_SCHEMA,
  REASON_CODES,
  createEnvelope,
  isPlainObject,
  outputShell,
  requireCitedFinding,
  sha256Hex,
  validateCitation,
  validateInput,
  validateOperation,
  validateOutput,
} from "./schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = join(HERE, "..", "..");
const REPO_ROOT = join(PACK_ROOT, "..", "..");
const SYNTHETIC_ROOT = join(PACK_ROOT, "fixtures", "synthetic", "migration");
const REAL_ROOT = join(PACK_ROOT, "fixtures", "real", "migration");

const HTTP_METHOD_SET = new Set(HTTP_METHODS);
const METHOD_ROUTE_RE =
  /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[A-Za-z0-9_./-]*)/g;
const TABLE_FIELD_ORDER = [
  "method",
  "route",
  "mcpTool",
  "challengeResource",
  "availability",
];

export const TRANSFORM_LIMITATIONS = Object.freeze([
  "Parses GFM operation tables, METHOD /path headings, and exact inventory literals only.",
  "Does not treat parallel wording as a rename unless a supplied document states the rename.",
  "Does not fetch URLs, run paid endpoints, or invent operator clock.",
  "Empty table cells and omitted inventory ops are unknown/partial, not filled from sibling files.",
  "Conflicting new-doc field values are reported together; no winner is chosen.",
  "STATE inventory is echoed when supplied; it is not invented.",
]);

const HOSTILE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

export function contentSha256(value) {
  if (Buffer.isBuffer(value)) return sha256Hex(value);
  return sha256Hex(Buffer.from(String(value), "utf8"));
}

function hasHostileKey(value) {
  if (!value || typeof value !== "object") return false;
  return Object.keys(value).some((key) => HOSTILE_KEYS.has(key));
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    if (item == null || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function operationKey(op) {
  if (!op) return null;
  if (op.key) return op.key;
  const method = typeof op.method === "string" ? op.method.trim().toUpperCase() : "";
  const route = typeof (op.route ?? op.path) === "string" ? (op.route ?? op.path) : "";
  if (method && route) return `${method} ${route}`;
  return op.inventoryKey || op.id || null;
}

function parseMethodRoute(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[A-Za-z0-9_./-]*)/);
  if (!match) return null;
  return { method: match[1], route: match[2] };
}

function splitRow(line) {
  const trimmed = String(line).trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutEnd = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return withoutEnd.split("|").map((cell) => cell.trim());
}

function isSeparator(line) {
  return /^\|\s*:?-{3,}/.test(String(line).trim());
}

/**
 * Parse GitHub-flavored tables. Header names are used as field keys as written.
 */
export function parseGfmTables(text) {
  const lines = String(text || "").split(/\r?\n/);
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith("|")) continue;
    if (i + 1 >= lines.length || !isSeparator(lines[i + 1])) continue;
    const headers = splitRow(lines[i]);
    const rows = [];
    i += 2;
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      if (isSeparator(lines[i])) {
        i += 1;
        continue;
      }
      const cells = splitRow(lines[i]);
      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = cells[idx] ?? "";
      });
      rows.push(obj);
      i += 1;
    }
    i -= 1;
    tables.push({ headers, rows });
  }
  return tables;
}

function isOpsTable(table) {
  const headers = (table.headers || []).map((header) => String(header).toLowerCase());
  return headers.includes("method") && (headers.includes("route") || headers.includes("path"));
}

export function parseDocumentedOperations(text) {
  const tables = parseGfmTables(text);
  const fromTable = [];
  for (const table of tables) {
    if (!isOpsTable(table)) continue;
    const headerMap = new Map(table.headers.map((header) => [header.toLowerCase(), header]));
    const methodHeader = headerMap.get("method");
    const routeHeader = headerMap.get("route") || headerMap.get("path");
    if (!methodHeader || !routeHeader) continue;
    for (const row of table.rows) {
      const method = String(row[methodHeader] || "").trim().toUpperCase();
      const route = String(row[routeHeader] || "").trim();
      if (!HTTP_METHOD_SET.has(method) || !route.startsWith("/")) continue;
      const record = {
        method,
        route,
        source: "table",
        fields: { ...row, method, route },
      };
      if (row.mcpTool) record.mcpTool = String(row.mcpTool).trim();
      fromTable.push(record);
    }
  }

  // When a method/route table is present, prose mentions are not citations.
  // Partial fixtures mention omitted routes in surrounding sentences.
  if (fromTable.length) return { tables, operations: fromTable };

  const fromHeading = [];
  const seen = new Set();
  const body = String(text || "");
  METHOD_ROUTE_RE.lastIndex = 0;
  let match;
  while ((match = METHOD_ROUTE_RE.exec(body))) {
    const method = match[1];
    const route = match[2];
    const key = `${method} ${route}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fromHeading.push({
      method,
      route,
      source: "heading",
      fields: { method, route },
    });
  }

  return { tables, operations: fromHeading };
}

function tokenPresent(text, token) {
  if (!token || typeof text !== "string") return false;
  const needle = String(token);
  if (!needle) return false;
  if (text.includes(`\`${needle}\``)) return true;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?![A-Za-z0-9_-])`);
  return re.test(text);
}

function confineToRepo(absPath) {
  const repo = resolve(REPO_ROOT);
  const rel = relative(repo, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

function resolveReadablePath(root, rawPath) {
  if (typeof rawPath !== "string" || !rawPath) return { ok: false, path: null, code: "missing_path" };
  if (rawPath.includes("\0")) return { ok: false, path: null, code: "hostile_input" };
  const bases = unique([root, process.cwd(), REPO_ROOT, PACK_ROOT].filter(Boolean).map((base) => resolve(base)));
  for (const base of bases) {
    const abs = isAbsolute(rawPath) ? resolve(rawPath) : resolve(base, rawPath);
    const rel = confineToRepo(abs);
    if (!rel) continue;
    if (existsSync(abs)) return { ok: true, path: abs, rel };
  }
  return { ok: false, path: null, code: "missing_source" };
}

function readBounded(absPath) {
  if (!existsSync(absPath)) return { ok: false, code: "missing_source", text: null, sha256: null };
  const bytes = readFileSync(absPath);
  return { ok: true, text: bytes.toString("utf8"), sha256: sha256Hex(bytes), bytes: bytes.length };
}

function citationRecord({ id, path, url, sha256, license, retrievedAt, source }) {
  const locator = path || url || source || null;
  return {
    id,
    source: source || locator,
    path: path || null,
    url: url || null,
    sha256: sha256 || null,
    retrievedAt: retrievedAt || null,
    license: license || null,
  };
}

function slugOp(op) {
  if (op?.mcpTool === "extract_batch" || op?.route === "/extract/batch") return "batch";
  if (op?.mcpTool) return String(op.mcpTool).replace(/_/g, "-");
  if (op?.route) return String(op.route).replace(/^\//, "").replace(/\//g, "-");
  if (op?.inventoryKey) return String(op.inventoryKey).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return op?.id || "op";
}

function itemIdFor(op, change, inInventory) {
  const slug = slugOp(op);
  if (change === "unchanged") return `${slug}-unchanged`;
  if (change === "added" && inInventory === false) return `${slug}-added-unused`;
  if (change === "missing" || change === "missing-in-new") return `${slug}-missing-in-new`;
  if (change === "conflict") {
    return `${slug}-challenge-conflict`;
  }
  return `${slug}-${change}`;
}

function kindForChange(change) {
  if (change === "missing-in-new") return "missing";
  if (change === "invalid-input") return "unknown";
  if (CHECKLIST_KINDS.includes(change)) return change;
  return "unknown";
}

function coverageForKind(kind) {
  if (kind === "conflict") return "conflict";
  if (kind === "missing" || kind === "partial" || kind === "unknown") return "partial";
  if (kind === "unchanged" || kind === "added" || kind === "removed" || kind === "changed" || kind === "renamed") {
    return "complete";
  }
  return "partial";
}

function consensusFields(hits) {
  if (!hits.length) return { fields: null, conflict: false, valuesByField: {} };
  const keys = unique(hits.flatMap((hit) => Object.keys(hit.fields || {})));
  const valuesByField = {};
  let conflict = false;
  const fields = {};
  for (const key of keys) {
    const values = unique(hits.map((hit) => String((hit.fields && hit.fields[key]) ?? "").trim()).filter((v) => v !== ""));
    valuesByField[key] = values;
    if (values.length > 1) {
      conflict = true;
      fields[key] = values.slice();
    } else if (values.length === 1) {
      fields[key] = values[0];
    } else {
      fields[key] = "";
    }
  }
  return { fields, conflict, valuesByField };
}

function compareFieldSets(oldFields, newFields) {
  const keys = unique([
    ...TABLE_FIELD_ORDER,
    ...Object.keys(oldFields || {}),
    ...Object.keys(newFields || {}),
  ]);
  const diffs = [];
  for (const key of keys) {
    if (key === "source") continue;
    const left = oldFields && oldFields[key] != null ? String(oldFields[key]).trim() : "";
    const right = newFields && newFields[key] != null ? String(newFields[key]).trim() : "";
    if (left === right) continue;
    diffs.push({ field: key, old: left || null, new: right || null });
  }
  return diffs;
}

function unwrapRaw(raw) {
  if (!isPlainObject(raw)) return raw;
  if (isPlainObject(raw.input) && (raw.input.oldDocs || raw.input.newDocs || raw.input.operationsInventory)) {
    return {
      ...raw,
      ...raw.input,
      clock: raw.clock,
      evidenceClass: raw.evidenceClass,
      citations: raw.citations,
      claims: raw.claims,
      sourcePin: raw.sourcePin,
      stateInventory: raw.stateInventory,
    };
  }
  return raw;
}

function asDocList(value, side) {
  if (Array.isArray(value)) return value.map((row) => ({ ...row, side: row.side || side }));
  return [];
}

function extractDocLists(raw) {
  const oldDocs = [
    ...asDocList(raw.oldDocs, "old"),
    ...asDocList(raw.docs?.old, "old"),
    ...asDocList(raw.old, "old"),
  ];
  const newDocs = [
    ...asDocList(raw.newDocs, "new"),
    ...asDocList(raw.docs?.new, "new"),
    ...asDocList(raw.new, "new"),
  ];
  return { oldDocs, newDocs };
}

function inventoryPayload(raw, loadedJson) {
  if (Array.isArray(raw.operations)) return { operations: raw.operations, source: "operations" };
  if (Array.isArray(raw.callerOperations)) return { operations: raw.callerOperations, source: "callerOperations" };
  if (Array.isArray(raw.operationsInventory)) return { operations: raw.operationsInventory, source: "operationsInventory" };
  if (isPlainObject(raw.operationsInventory) && Array.isArray(raw.operationsInventory.operations)) {
    return { operations: raw.operationsInventory.operations, source: "operationsInventory" };
  }
  if (loadedJson) {
    if (Array.isArray(loadedJson.operations)) return { operations: loadedJson.operations, source: "inventory-file" };
    if (isPlainObject(loadedJson) && Object.prototype.hasOwnProperty.call(loadedJson, "operations")) {
      return { operations: loadedJson.operations, source: "inventory-file", malformed: !Array.isArray(loadedJson.operations) };
    }
    if (Array.isArray(loadedJson)) return { operations: loadedJson, source: "inventory-file" };
  }
  if (isPlainObject(raw.operations) && Object.prototype.hasOwnProperty.call(raw.operations, "operations")) {
    return { operations: raw.operations.operations, source: "operations", malformed: !Array.isArray(raw.operations.operations) };
  }
  return { operations: raw.operations, source: "operations", malformed: raw.operations != null && !Array.isArray(raw.operations) };
}

function normalizeInventoryOp(raw) {
  if (!isPlainObject(raw) || hasHostileKey(raw)) return { ok: false, malformed: true, op: null };
  const parsed = parseMethodRoute(raw.sourceLiteral) || parseMethodRoute(raw.inventoryKey) || parseMethodRoute(raw.id);
  const method = raw.method || parsed?.method || null;
  const route = raw.route || raw.path || parsed?.route || null;
  const http = method && route
    ? validateOperation({ ...raw, method, route })
    : { ok: false, operation: null, issues: [] };
  const searchTokens = unique(
    [
      raw.sourceLiteral,
      raw.mcpTool,
      method && route ? `${method} ${route}` : null,
      route,
      raw.inventoryKey,
      raw.name,
      ...(Array.isArray(raw.aliases) ? raw.aliases : []),
    ].filter((token) => typeof token === "string" && token.trim()),
  );
  return {
    ok: true,
    malformed: false,
    op: {
      id: raw.id || http.operation?.id || operationKey({ method, route }) || raw.inventoryKey || null,
      method: http.operation?.method || (typeof method === "string" ? method.toUpperCase() : null),
      route: http.operation?.route || route || null,
      mcpTool: typeof raw.mcpTool === "string" ? raw.mcpTool : null,
      operationId: http.operation?.operationId || raw.operationId || null,
      inventoryKey: raw.inventoryKey || null,
      sourceLiteral: raw.sourceLiteral || null,
      searchTokens,
      inInventory: true,
      key: http.operation?.key || (method && route ? `${String(method).toUpperCase()} ${route}` : raw.inventoryKey || raw.id),
      citationIds: Array.isArray(raw.citationIds) ? [...raw.citationIds] : [],
    },
  };
}

function isWellFormedHttpOp(raw) {
  if (!isPlainObject(raw)) return false;
  const method = typeof raw.method === "string" ? raw.method.trim().toUpperCase() : "";
  const route = typeof (raw.route ?? raw.path) === "string" ? String(raw.route ?? raw.path).trim() : "";
  return HTTP_METHOD_SET.has(method) && route.startsWith("/");
}

/**
 * Load path-backed docs/inventory into in-memory records. Missing listed
 * new-doc paths become a fail (synthetic negative). Does not fetch URLs.
 */
export function materializeInput(rawInput, options = {}) {
  const raw = unwrapRaw(rawInput);
  const root = options.root || process.cwd();
  const notes = [];
  const missingPaths = [];
  const citations = [];
  const citationIds = new Set();

  function addCitation(row) {
    if (!row?.id || citationIds.has(row.id)) return;
    const checked = validateCitation({
      id: row.id,
      source: row.source || row.path || row.url,
      path: row.path,
      url: row.url,
      sha256: row.sha256,
      retrievedAt: row.retrievedAt,
      license: row.license,
    });
    const citation = checked.citation || citationRecord(row);
    citationIds.add(citation.id);
    citations.push(citation);
  }

  function loadDoc(row, side, index) {
    const id = row.id || `${side}-${index}`;
    const path = row.path || null;
    const url = row.url || null;
    let text = typeof row.text === "string" ? row.text : null;
    let sha256 = typeof row.sha256 === "string" ? row.sha256 : null;
    let missing = false;
    if (text == null && path) {
      const confined = resolveReadablePath(root, path);
      if (!confined.ok) {
        missing = true;
        missingPaths.push(path);
      } else {
        const read = readBounded(confined.path);
        if (!read.ok) {
          missing = true;
          missingPaths.push(path);
        } else {
          text = read.text;
          if (!sha256) sha256 = read.sha256;
          else if (sha256 !== read.sha256) {
            notes.push({ code: "conflicting_source", path, expected: sha256, actual: read.sha256 });
          }
        }
      }
    } else if (text != null && !sha256) {
      sha256 = contentSha256(text);
    }
    const citationId = row.citationIds?.[0] || id;
    if (!missing && (path || url)) {
      addCitation({
        id: citationId,
        path,
        url,
        sha256,
        license: row.license,
        retrievedAt: row.retrievedAt,
        source: path || url,
      });
    } else if (!missing && !(path || url)) {
      notes.push({ code: "missing_citation", id, reason: "doc has text but no path or url" });
    }
    const parsed = missing || text == null ? { operations: [], tables: [] } : parseDocumentedOperations(text);
    return {
      id,
      side,
      path,
      url,
      sha256: missing ? null : sha256,
      text: missing ? null : text,
      missing,
      citationId,
      license: row.license || null,
      operations: parsed.operations,
      tables: parsed.tables,
    };
  }

  const lists = extractDocLists(raw);
  const oldDocs = lists.oldDocs.map((row, i) => loadDoc(row, "old", i));
  const newDocs = lists.newDocs.map((row, i) => loadDoc(row, "new", i));

  let inventoryMeta = null;
  const inventoryRef = raw.operationsInventory;
  if (isPlainObject(inventoryRef) && inventoryRef.path && !Array.isArray(inventoryRef.operations)) {
    const confined = resolveReadablePath(root, inventoryRef.path);
    const id = inventoryRef.id || "inventory";
    if (!confined.ok) {
      missingPaths.push(inventoryRef.path);
    } else {
      const read = readBounded(confined.path);
      let parsed = null;
      let malformedJson = false;
      try {
        parsed = JSON.parse(read.text);
      } catch {
        malformedJson = true;
      }
      inventoryMeta = {
        id,
        path: inventoryRef.path,
        sha256: read.sha256,
        json: parsed,
        malformedJson,
        citationId: id,
      };
      addCitation({
        id,
        path: inventoryRef.path,
        sha256: read.sha256,
        source: inventoryRef.path,
      });
    }
  }

  const inv = inventoryPayload(raw, inventoryMeta?.json);
  const malformedInventory = Boolean(inv.malformed) || inventoryMeta?.malformedJson === true;

  for (const row of raw.citations || []) {
    if (!isPlainObject(row) || !row.id) continue;
    if (citationIds.has(row.id)) continue;
    let sha256 = row.sha256 || null;
    if (!sha256 && row.path) {
      const confined = resolveReadablePath(root, row.path);
      if (confined.ok) {
        sha256 = readBounded(confined.path).sha256;
      }
    }
    addCitation({ ...row, sha256, source: row.source || row.path || row.url });
  }

  return {
    clock: raw.clock,
    evidenceClass: raw.evidenceClass || "synthetic",
    sourcePin: raw.sourcePin || null,
    stateInventory: raw.stateInventory || null,
    claims: raw.claims,
    oldDocs,
    newDocs,
    inventoryMeta,
    inventoryOpsRaw: inv.operations,
    malformedInventory,
    missingNewDocs: newDocs.some((doc) => doc.missing) || (lists.newDocs.length > 0 && newDocs.filter((d) => !d.missing).length === 0 && lists.newDocs.some((d) => d.path)),
    missingPaths,
    listedNewMissing: lists.newDocs.filter((row, i) => newDocs[i]?.missing).map((row) => row.path),
    citations,
    notes,
    raw,
  };
}

function hitsForHttpOp(docs, op) {
  const key = operationKey(op);
  const hits = [];
  for (const doc of docs) {
    if (doc.missing || !doc.operations) continue;
    for (const rec of doc.operations) {
      if (`${rec.method} ${rec.route}` === key) {
        hits.push({ ...rec, docId: doc.id, citationId: doc.citationId, path: doc.path });
      }
    }
  }
  return hits;
}

function hitsForLiteral(docs, op) {
  const hits = [];
  const tokens = op.searchTokens?.length
    ? op.searchTokens
    : [op.sourceLiteral, op.inventoryKey].filter(Boolean);
  for (const doc of docs) {
    if (doc.missing || typeof doc.text !== "string") continue;
    for (const token of tokens) {
      if (tokenPresent(doc.text, token)) {
        hits.push({
          source: "literal",
          token,
          docId: doc.id,
          citationId: doc.citationId,
          path: doc.path,
          fields: { literal: token },
        });
        break;
      }
    }
  }
  return hits;
}

function pickDecision(flags) {
  if (flags.fail) return "fail";
  if (flags.conflict) return "conflict";
  if (flags.unknown) return "unknown";
  if (flags.partial) return "partial";
  if (DECISIONS.includes(flags.decision)) return flags.decision;
  return "pass";
}

function coverageForDecision(decision, flags) {
  if (decision === "conflict" || flags.conflict) return "conflict";
  if (decision === "fail") return "missing";
  if (decision === "unknown") return "missing";
  if (decision === "partial" || flags.partial) return "partial";
  return "complete";
}

function makeFinding({ id, code, message, citationIds, extra = {} }) {
  const finding = {
    id,
    code: code || null,
    message,
    citationIds: unique(citationIds),
    ...extra,
  };
  requireCitedFinding(finding);
  return finding;
}

function makeItem({ id, kind, subject, operation, citationIds, change, inInventory, extra = {} }) {
  const item = {
    id,
    kind,
    subject,
    operation: operation && operation.method && operation.route
      ? {
          method: operation.method,
          route: operation.route,
          ...(operation.mcpTool ? { mcpTool: operation.mcpTool } : {}),
          ...(operation.operationId ? { operationId: operation.operationId } : {}),
        }
      : null,
    citationIds: unique(citationIds),
    coverage: coverageForKind(kind),
    reasonCode: extra.reasonCode || null,
    oldRef: extra.oldRef || null,
    newRef: extra.newRef || null,
    change,
    inInventory,
    ...extra,
  };
  requireCitedFinding(item);
  return item;
}

/**
 * Build a cited migration checklist. Unknown when cites are missing.
 */
export function transformMigrationChecklist(rawInput, options = {}) {
  const limitations = [...TRANSFORM_LIMITATIONS];
  if (!isPlainObject(rawInput) || hasHostileKey(rawInput)) {
    const clock = isPlainObject(rawInput) ? rawInput.clock : null;
    if (!clock) {
      throw new Error("clock required (operator-supplied; do not invent)");
    }
    const packet = outputShell({ clock, evidenceClass: "synthetic", limitations });
    packet.decision = "fail";
    packet.coverage = "missing";
    packet.findings = [];
    packet.checklist = [];
    return packet;
  }

  const loaded = materializeInput(rawInput, options);
  const evidenceClass = EVIDENCE_CLASSES.includes(loaded.evidenceClass)
    ? loaded.evidenceClass
    : "synthetic";

  if (!loaded.clock) {
    throw new Error("clock required (operator-supplied; do not invent)");
  }

  const citations = loaded.citations.map((row) => ({
    id: row.id,
    source: row.source || row.path || row.url,
    path: row.path || null,
    url: row.url || null,
    sha256: row.sha256 || null,
    retrievedAt: row.retrievedAt || null,
    license: row.license || null,
  }));
  const cite = (id) => citations.find((row) => row.id === id);

  const findings = [];
  const checklist = [];
  const flags = { fail: false, conflict: false, unknown: false, partial: false };

  const inventoryCiteId = loaded.inventoryMeta?.citationId || (cite("inventory") ? "inventory" : null);
  const oldCiteIds = loaded.oldDocs.filter((d) => !d.missing).map((d) => d.citationId);
  const newCiteIds = loaded.newDocs.filter((d) => !d.missing).map((d) => d.citationId);

  if (loaded.malformedInventory) {
    flags.fail = true;
    const citationIds = inventoryCiteId ? [inventoryCiteId] : citations.slice(0, 1).map((row) => row.id);
    if (citationIds.length) {
      findings.push(
        makeFinding({
          id: "malformed-inventory",
          message: "operations is not an array of {method,route}",
          citationIds,
          extra: { change: "invalid-input", reason: "operations is not an array of {method,route}" },
        }),
      );
      checklist.push(
        makeItem({
          id: "malformed-inventory",
          kind: "unknown",
          subject: "operations",
          operation: null,
          citationIds,
          change: "invalid-input",
          inInventory: false,
          extra: { reasonCode: "hostile_input", coverage: "missing" },
        }),
      );
    }
  }

  if (loaded.listedNewMissing.length) {
    flags.fail = true;
    const path = loaded.listedNewMissing[0];
    const citationIds = oldCiteIds.length ? oldCiteIds : citations.slice(0, 1).map((row) => row.id);
    if (citationIds.length) {
      findings.push(
        makeFinding({
          id: "missing-new-docs",
          code: "missing_source",
          message: `newDocs path ${path} is not present`,
          citationIds,
          extra: { change: "invalid-input", reason: `newDocs path ${path} is not present` },
        }),
      );
      checklist.push(
        makeItem({
          id: "missing-new-docs",
          kind: "missing",
          subject: "newDocs",
          operation: null,
          citationIds,
          change: "invalid-input",
          inInventory: false,
          extra: { reasonCode: "missing_source", coverage: "missing" },
        }),
      );
    }
  }

  const inventoryOps = [];
  if (!loaded.malformedInventory && Array.isArray(loaded.inventoryOpsRaw)) {
    for (const row of loaded.inventoryOpsRaw) {
      const normalized = normalizeInventoryOp(row);
      if (!normalized.ok || normalized.malformed) {
        flags.fail = true;
        const citationIds = inventoryCiteId ? [inventoryCiteId] : citations.slice(0, 1).map((row) => row.id);
        if (citationIds.length && !findings.some((f) => f.id === "malformed-inventory")) {
          findings.push(
            makeFinding({
              id: "malformed-inventory",
              message: "operations is not an array of {method,route}",
              citationIds,
              extra: { change: "invalid-input" },
            }),
          );
        }
        continue;
      }
      inventoryOps.push(normalized.op);
    }
    if (loaded.inventoryOpsRaw.length && inventoryOps.length === 0 && loaded.inventoryOpsRaw.every((row) => !isWellFormedHttpOp(row) && !row.sourceLiteral && !row.inventoryKey)) {
      flags.fail = true;
    }
  }

  const seenKeys = new Set();

  function emit({ op, change, inInventory, citationIds, values, oldHits, newHits, message, reasonCode, extra }) {
    const ids = unique(citationIds).filter((id) => citations.some((row) => row.id === id));
    if (!ids.length) {
      flags.unknown = true;
      return;
    }
    const kind = kindForChange(change);
    const id = extra?.id || itemIdFor(op, change, inInventory);
    const subject = operationKey(op) || op?.inventoryKey || op?.id || id;
    if (kind === "conflict") flags.conflict = true;
    if (kind === "missing" || kind === "partial") flags.partial = true;
    if (kind === "unknown") flags.unknown = true;
    const finding = makeFinding({
      id,
      code: reasonCode && REASON_CODES.includes(reasonCode) ? reasonCode : null,
      message,
      citationIds: ids,
      extra: {
        operation: op && op.method && op.route
          ? { method: op.method, route: op.route, ...(op.mcpTool ? { mcpTool: op.mcpTool } : {}) }
          : undefined,
        change,
        inInventory,
        values: values || undefined,
      },
    });
    findings.push(finding);
    checklist.push(
      makeItem({
        id,
        kind,
        subject,
        operation: op,
        citationIds: ids,
        change,
        inInventory,
        extra: {
          values: values || undefined,
          reasonCode: reasonCode || null,
          oldRef: oldHits?.[0] ? { docId: oldHits[0].docId } : null,
          newRef: newHits?.[0] ? { docId: newHits[0].docId } : null,
        },
      }),
    );
  }

  if (!flags.fail) {
    for (const op of inventoryOps) {
      const key = operationKey(op);
      if (key) seenKeys.add(key);
      const http = Boolean(op.method && op.route);
      const oldHits = http ? hitsForHttpOp(loaded.oldDocs, op) : hitsForLiteral(loaded.oldDocs, op);
      const newHits = http ? hitsForHttpOp(loaded.newDocs, op) : hitsForLiteral(loaded.newDocs, op);
      const newConsensus = consensusFields(newHits);
      const oldConsensus = consensusFields(oldHits);
      const inventoryCites = unique([
        ...(op.citationIds || []),
        inventoryCiteId,
      ]).filter((id) => id && citations.some((row) => row.id === id));

      if (newConsensus.conflict) {
        const field = TABLE_FIELD_ORDER.find((name) => (newConsensus.valuesByField[name] || []).length > 1)
          || Object.keys(newConsensus.valuesByField).find((name) => (newConsensus.valuesByField[name] || []).length > 1);
        const values = field ? newConsensus.valuesByField[field] : [];
        emit({
          op,
          change: "conflict",
          inInventory: true,
          citationIds: [...newHits.map((h) => h.citationId), ...inventoryCites],
          values,
          oldHits,
          newHits,
          message: field
            ? `new docs disagree on ${field} for ${key}: ${values.join(" vs ")}`
            : `new docs disagree for ${key}`,
          reasonCode: "conflicting_source",
        });
        continue;
      }

      if (newHits.length === 0) {
        emit({
          op,
          change: "missing-in-new",
          inInventory: true,
          citationIds: inventoryCites.length ? inventoryCites : oldHits.map((h) => h.citationId),
          oldHits,
          newHits,
          message: `${key || op.inventoryKey || op.id} has no new-docs table row`,
          reasonCode: "partial_coverage",
        });
        continue;
      }

      if (oldHits.length && newHits.length && http) {
        const diffs = compareFieldSets(oldConsensus.fields, newConsensus.fields);
        if (oldConsensus.conflict) {
          flags.conflict = true;
        }
        if (diffs.length === 0 && !oldConsensus.conflict) {
          emit({
            op,
            change: "unchanged",
            inInventory: true,
            citationIds: [...oldHits.map((h) => h.citationId), ...newHits.map((h) => h.citationId), ...inventoryCites],
            oldHits,
            newHits,
            message: `${key} is cited in old and new docs with the same documented fields`,
          });
        } else {
          emit({
            op,
            change: "changed",
            inInventory: true,
            citationIds: [...oldHits.map((h) => h.citationId), ...newHits.map((h) => h.citationId), ...inventoryCites],
            oldHits,
            newHits,
            values: diffs,
            message: `${key} documented fields differ between old and new: ${diffs.map((d) => d.field).join(", ")}`,
          });
        }
        continue;
      }

      if (!http && oldHits.length && newHits.length) {
        emit({
          op,
          change: "unchanged",
          inInventory: true,
          citationIds: [...oldHits.map((h) => h.citationId), ...newHits.map((h) => h.citationId), ...inventoryCites],
          oldHits,
          newHits,
          message: `${op.inventoryKey || op.sourceLiteral || key} is present in supplied old and new docs`,
        });
        continue;
      }

      if (!oldHits.length && newHits.length) {
        emit({
          op,
          change: "added",
          inInventory: true,
          citationIds: [...newHits.map((h) => h.citationId), ...inventoryCites],
          newHits,
          message: `${key || op.inventoryKey} is cited in new docs and the caller inventory`,
        });
      }
    }

    const newHttpOps = [];
    for (const doc of loaded.newDocs) {
      for (const rec of doc.operations || []) {
        const key = `${rec.method} ${rec.route}`;
        if (seenKeys.has(key)) continue;
        newHttpOps.push({ rec, doc });
      }
    }
    const groupedNew = new Map();
    for (const row of newHttpOps) {
      const key = `${row.rec.method} ${row.rec.route}`;
      const list = groupedNew.get(key) || [];
      list.push(row);
      groupedNew.set(key, list);
    }
    for (const [key, rows] of groupedNew.entries()) {
      const op = {
        method: rows[0].rec.method,
        route: rows[0].rec.route,
        mcpTool: rows[0].rec.mcpTool || rows[0].rec.fields?.mcpTool || null,
        key,
      };
      const hits = rows.map((row) => ({
        ...row.rec,
        docId: row.doc.id,
        citationId: row.doc.citationId,
      }));
      const consensus = consensusFields(hits);
      if (consensus.conflict) {
        const field = TABLE_FIELD_ORDER.find((name) => (consensus.valuesByField[name] || []).length > 1);
        emit({
          op,
          change: "conflict",
          inInventory: false,
          citationIds: hits.map((h) => h.citationId),
          values: field ? consensus.valuesByField[field] : [],
          newHits: hits,
          message: `new docs disagree on ${field} for ${key}`,
          reasonCode: "conflicting_source",
        });
        continue;
      }
      const oldHits = hitsForHttpOp(loaded.oldDocs, op);
      if (oldHits.length) continue;
      emit({
        op,
        change: "added",
        inInventory: false,
        citationIds: hits.map((h) => h.citationId),
        newHits: hits,
        message: `${key} is documented in new docs but is not in the caller inventory`,
      });
    }
  }

  if (loaded.notes.some((note) => note.code === "missing_citation")) flags.unknown = true;

  const decision = pickDecision(flags);
  const coverage = coverageForDecision(decision, flags);

  if (loaded.notes.some((n) => n.code === "conflicting_source") && decision !== "fail") {
    limitations.push("A supplied sha256 disagreed with bytes read from path; bytes were not overwritten.");
  }

  const sources = [];
  for (const doc of [...loaded.oldDocs, ...loaded.newDocs]) {
    if (doc.missing) continue;
    sources.push({
      id: doc.id,
      side: doc.side,
      path: doc.path,
      url: doc.url,
      sha256: doc.sha256,
    });
  }
  if (loaded.inventoryMeta) {
    sources.push({
      id: loaded.inventoryMeta.id,
      path: loaded.inventoryMeta.path,
      sha256: loaded.inventoryMeta.sha256,
    });
  }

  const envelope = createEnvelope({
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    clock: loaded.clock,
    evidenceClass,
    sources,
    findings,
    decision,
    limitations: [...BASELINE_LIMITATIONS, ...limitations],
    citations,
  });

  const packet = {
    ...envelope,
    schema: OUTPUT_SCHEMA,
    packetSchema: PACKET_SCHEMA,
    checklist,
    coverage,
    sourcePin: loaded.sourcePin,
    issues: loaded.notes,
  };

  const checked = validateOutput(packet);
  if (!checked.ok) {
    packet.limitations = [
      ...packet.limitations,
      "Output failed schema validateOutput; packet is still returned for diagnosis.",
    ];
    packet.schemaIssues = checked.issues;
  }

  return packet;
}

export { transformMigrationChecklist as transform };

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function transformFixtureCase(caseId, options = {}) {
  const root = options.root || SYNTHETIC_ROOT;
  const casePath = join(root, "cases", `${caseId}.json`);
  const spec = loadJson(casePath);
  return transformMigrationChecklist(spec, { root, ...options });
}

const SYNTHETIC_CASES = [
  "positive-complete",
  "negative-missing-new-docs",
  "negative-malformed-inventory",
  "partial-batch-undocumented",
  "conflict-challenge-resource",
];

export function selfCheck() {
  const results = [];
  for (const id of SYNTHETIC_CASES) {
    const spec = loadJson(join(SYNTHETIC_ROOT, "cases", `${id}.json`));
    const packet = transformMigrationChecklist(spec, { root: SYNTHETIC_ROOT });
    const expected = spec.expect?.decision;
    const findingIds = (packet.findings || []).map((row) => row.id);
    const expectIds = (spec.expect?.findings || []).map((row) => row.id);
    const missing = expectIds.filter((fid) => !findingIds.includes(fid));
    const ok = packet.decision === expected && missing.length === 0;
    results.push({
      id,
      ok,
      decision: packet.decision,
      expected,
      findingIds,
      expectIds,
      missing,
      coverage: packet.coverage,
    });
  }

  const realInputPath = join(REAL_ROOT, "input.json");
  if (existsSync(realInputPath)) {
    const real = transformMigrationChecklist(loadJson(realInputPath), { root: REAL_ROOT });
    const inventedRename = (real.findings || []).some((row) => row.change === "renamed" || row.kind === "renamed");
    const uncited = (real.findings || []).some((row) => !row.citationIds?.length);
    results.push({
      id: "real-x402-v1-v2",
      ok:
        DECISIONS.includes(real.decision) &&
        real.citations.length > 0 &&
        !inventedRename &&
        !uncited &&
        real.payment.attempted === false &&
        real.decision !== "fail",
      decision: real.decision,
      findingIds: (real.findings || []).map((row) => row.id),
      inventedRename,
    });
  }

  const schemaInput = validateInput;
  const unknownPacket = transformMigrationChecklist({
    clock: "2026-09-10T12:00:00.000Z",
    evidenceClass: "synthetic",
    oldDocs: [{ id: "old", text: "| method | route |\n| --- | --- |\n| GET | /extract |" }],
    newDocs: [{ id: "new", text: "| method | route |\n| --- | --- |\n| GET | /extract |" }],
    operations: [{ method: "GET", route: "/extract" }],
    citations: [],
  });
  results.push({
    id: "unknown-missing-cites",
    ok: unknownPacket.decision === "unknown" && (unknownPacket.findings || []).every((row) => row.citationIds?.length),
    decision: unknownPacket.decision,
  });

  results.push({
    id: "schema-export",
    ok: typeof schemaInput === "function" && PACKET_SCHEMA.startsWith("s137."),
  });

  return {
    ok: results.every((row) => row.ok),
    results,
  };
}

function printPacket(packet) {
  const compact = {
    schema: packet.schema,
    jobId: packet.jobId,
    decision: packet.decision,
    coverage: packet.coverage,
    evidenceClass: packet.evidenceClass,
    clock: packet.clock,
    findings: (packet.findings || []).map((row) => ({
      id: row.id,
      change: row.change,
      inInventory: row.inInventory,
      citationIds: row.citationIds,
      message: row.message,
      values: row.values,
    })),
    checklist: (packet.checklist || []).map((row) => ({
      id: row.id,
      kind: row.kind,
      subject: row.subject,
      citationIds: row.citationIds,
    })),
    citations: (packet.citations || []).map((row) => ({
      id: row.id,
      path: row.path,
      sha256: row.sha256,
    })),
    payment: packet.payment,
    cost: packet.cost,
  };
  process.stdout.write(`${JSON.stringify(compact, null, 2)}\n`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-check") out.selfCheck = true;
    else if (arg === "--case") out.case = argv[++i];
    else if (arg === "--root") out.root = argv[++i];
    else if (arg === "--input") out.input = argv[++i];
    else out._.push(arg);
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheck) {
    const report = selfCheck();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.ok ? 0 : 1);
  }
  if (args.case) {
    const packet = transformFixtureCase(args.case, { root: args.root || SYNTHETIC_ROOT });
    printPacket(packet);
    process.exit(0);
  }
  if (args.input) {
    const inputPath = resolve(args.input);
    const root = args.root || dirname(inputPath);
    const packet = transformMigrationChecklist(loadJson(inputPath), { root });
    printPacket(packet);
    process.exit(0);
  }
  process.stdout.write(
    [
      "Usage:",
      "  node src/migration-checklist/transform.mjs --self-check",
      "  node src/migration-checklist/transform.mjs --case positive-complete",
      "  node src/migration-checklist/transform.mjs --input fixtures/real/migration/input.json --root fixtures/real/migration",
      "",
    ].join("\n"),
  );
}
