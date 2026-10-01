import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MACHINE_ACQUISITION_CACHE_CONTROL,
  MACHINE_ACQUISITION_MAX_BYTES,
} from "../machine-acquisition.mjs";

export const PUBLIC_ACQUISITION_PREFIX = "/.well-known/public-acquisition";
export const PUBLIC_ACQUISITION_INDEX_PATH = `${PUBLIC_ACQUISITION_PREFIX}/index.json`;
export const PUBLIC_ACQUISITION_ASSET_PREFIX = `${PUBLIC_ACQUISITION_PREFIX}/assets`;
export const ARCHIVE_CACHE_CONTROL = MACHINE_ACQUISITION_CACHE_CONTROL;
export const INDEX_CACHE_CONTROL = "public, max-age=300";
export const MAX_ASSET_BYTES = MACHINE_ACQUISITION_MAX_BYTES;
export const MAX_SET_BYTES = 8_388_608;
export const MAX_MEMBERS = 2_000;

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = join(MODULE_DIR, "manifest.json");
const DEFAULT_BYTES = join(MODULE_DIR, "bytes");
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BLOCKED_SEGMENTS = new Set([
  ".env",
  "id_rsa",
  "id_dsa",
  "id_ed25519",
  "credentials.json",
  "secrets.json",
]);

function fail(message, code = "public_acquisition_invalid") {
  const error = new Error(`public acquisition invalid: ${message}`);
  error.code = code;
  throw error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readRegularFile(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    fail(`cannot open without following symlinks: ${path}: ${error.message}`, "symlink");
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) fail(`not a regular file: ${path}`, "unsafe_path");
    if (st.size > MAX_ASSET_BYTES) fail(`file exceeds ${MAX_ASSET_BYTES} bytes: ${path}`, "wrong_byte_length");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function credentialSegment(name) {
  const lower = name.toLowerCase();
  if (BLOCKED_SEGMENTS.has(lower)) return true;
  return lower.endsWith(".key") || lower.endsWith(".p12") || lower.endsWith(".pfx");
}

function safeRelative(rel) {
  if (typeof rel !== "string" || rel === "" || rel.startsWith("/") || rel.includes("\\") || rel.includes("\0")) return null;
  const parts = rel.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || credentialSegment(part))) return null;
  return rel;
}

function walkFiles(dir, base = "") {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    fail(`cannot read ${dir}: ${error.message}`, "missing_asset");
  }
  const files = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) fail(`symlink is not servable: ${rel}`, "symlink");
    if (credentialSegment(entry.name)) fail(`private addition: ${rel}`, "private_addition");
    if (entry.isDirectory()) files.push(...walkFiles(path, rel));
    else if (entry.isFile()) files.push(rel);
    else fail(`unsupported directory entry: ${rel}`, "unsafe_addition");
  }
  return files;
}

function assertHttpsOrigin(url, allowedHosts) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    fail(`original URL is not a URL: ${error.message}`, "arbitrary_upstream");
  }
  if (parsed.username || parsed.password) fail("original URL carries credentials", "credential_url");
  if (parsed.protocol !== "https:") fail(`original URL is not https: ${url}`, "arbitrary_upstream");
  if (!allowedHosts.includes(parsed.hostname)) fail(`original host is not allowlisted: ${parsed.hostname}`, "arbitrary_upstream");
  return parsed;
}

function readOctal(header, start, length) {
  const text = header.toString("utf8", start, start + length).replace(/\0.*$/s, "").trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) fail("tar header has a non-octal field", "unsafe_member");
  return Number.parseInt(text, 8);
}

function headerChecksumOk(header) {
  const stored = readOctal(header, 148, 8);
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += (i >= 148 && i < 156) ? 32 : header[i];
  return sum === stored;
}

function cString(header, start, length) {
  return header.toString("utf8", start, start + length).replace(/\0.*$/s, "");
}

function logicalName(header) {
  const name = cString(header, 0, 100);
  const magic = header.toString("ascii", 257, 262);
  const prefix = magic === "ustar" ? cString(header, 345, 155) : "";
  const joined = prefix ? `${prefix}/${name}` : name;
  return joined.endsWith("/") ? joined.slice(0, -1) : joined;
}

export function inventoryArchive(bytes) {
  let raw;
  try {
    raw = gunzipSync(bytes);
  } catch (error) {
    fail(`archive is not gzip: ${error.message}`, "unsafe_member");
  }
  const members = [];
  let offset = 0;
  let pendingName = null;
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      if (raw.subarray(offset).some((byte) => byte !== 0)) fail("archive has data after the end marker", "unsafe_member");
      break;
    }
    if (!headerChecksumOk(header)) fail("tar checksum does not match", "unsafe_member");
    const type = String.fromCharCode(header[156]);
    const size = readOctal(header, 124, 12);
    const dataEnd = offset + size;
    const padded = offset + (Math.ceil(size / 512) * 512);
    if (padded > raw.length) fail("tar member extends past the archive", "unsafe_member");
    const data = raw.subarray(offset, dataEnd);
    offset = padded;
    if (type === "L") {
      pendingName = data.toString("utf8").replace(/\0.*$/s, "");
      continue;
    }
    if (type === "K") {
      pendingName = null;
      continue;
    }
    let path = pendingName || logicalName(header);
    pendingName = null;
    if (path.endsWith("/")) path = path.slice(0, -1);
    if (type !== "0" && type !== "\0" && type !== "5") fail(`unsupported tar member type ${type} at ${path}`, "unsafe_member");
    if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0")) fail(`unsafe member path: ${path}`, "unsafe_member");
    if (path.split("/").some((part) => part === "" || part === "." || part === "..")) fail(`unsafe member path: ${path}`, "unsafe_member");
    if (path.split("/").some((part) => credentialSegment(part))) fail(`private member: ${path}`, "private_addition");
    if (type === "5") {
      if (size !== 0) fail(`directory member has a body: ${path}`, "unsafe_member");
      members.push({ bytes: 0, kind: "directory", path, sha256: null });
      continue;
    }
    members.push({ bytes: data.length, kind: "file", path, sha256: sha256(data) });
  }
  if (pendingName) fail("archive ended during a long-name header", "unsafe_member");
  if (members.length > MAX_MEMBERS) fail(`member count exceeds ${MAX_MEMBERS}`, "unsafe_member");
  members.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return members;
}

function sameMembers(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function loadInventory(manifestDir, asset) {
  const rel = safeRelative(asset.inventory?.path || "");
  if (!rel || !rel.startsWith("inventories/") || rel.split("/").length !== 2) {
    fail(`inventory path is not allowlisted: ${asset.relativePath}`, "unsafe_path");
  }
  const path = resolve(manifestDir, rel);
  const root = resolve(manifestDir);
  if (relative(root, path).startsWith("..")) fail("inventory path escapes the module", "unsafe_path");
  const bytes = readRegularFile(path);
  if (sha256(bytes) !== asset.inventory.fileSha256) fail(`inventory bytes changed: ${rel}`, "changed_bytes");
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`inventory is not JSON: ${error.message}`, "unsafe_member");
  }
  if (!parsed || !Array.isArray(parsed.members)) fail(`inventory members missing: ${rel}`, "inventory_mismatch");
  if (parsed.members.length !== asset.inventory.memberCount) fail(`inventory count changed: ${rel}`, "inventory_mismatch");
  return parsed.members.map((member) => ({
    bytes: member.bytes,
    kind: member.kind,
    path: member.path,
    sha256: member.sha256,
  }));
}

function assertAssetShape(asset, allowedHosts) {
  if (!asset || typeof asset !== "object") fail("asset is missing");
  if (!ID_PATTERN.test(asset.id || "") || !ID_PATTERN.test(asset.version || "")) fail(`asset id is not allowlisted: ${asset.id}@${asset.version}`, "unsafe_path");
  if (!FILE_PATTERN.test(asset.filename || "")) fail(`asset filename is not allowlisted: ${asset.filename}`, "unsafe_path");
  const expectedRel = `${asset.id}/${asset.version}/${asset.filename}`;
  if (asset.relativePath !== expectedRel || safeRelative(asset.relativePath) !== expectedRel) {
    fail(`asset path is not the id/version/filename triple: ${asset.relativePath}`, "unsafe_path");
  }
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || asset.bytes > MAX_ASSET_BYTES) {
    fail(`asset length is outside the mount bound: ${asset.relativePath}`, "wrong_byte_length");
  }
  if (typeof asset.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(asset.sha256)) fail(`asset sha256 is missing: ${asset.relativePath}`, "changed_bytes");
  if (typeof asset.mediaType !== "string" || asset.mediaType === "" || asset.mediaType.length > 128) fail(`asset media type is missing: ${asset.relativePath}`);
  if (asset.runtimeDownload === true || asset.fetchUrl || asset.upstreamUrl) fail("runtime download is not part of this mount", "runtime_download_forbidden");
  if (asset.writable === true) fail(`writable asset is refused: ${asset.relativePath}`, "writable_path");
  if (asset.sourceQualification !== "unknown") fail(`source qualification must stay unknown: ${asset.relativePath}`, "source_qualification");
  if (asset.hostedAcquisitionVerified !== false) fail("draft must not claim hosted acquisition", "hosted_claim");
  if (asset.privateGit !== "unavailable") fail("private Git availability is not established", "private_git");
  if (asset.paidLaunch !== false || asset.measuredSavings !== false || asset.independentDemand !== false) {
    fail("mirror must not claim launch, savings, or demand", "unearned_claim");
  }
  assertHttpsOrigin(asset.originalUrl, allowedHosts);
  const original = new URL(asset.originalUrl);
  if (original.pathname !== `/downloads/${expectedRel}`) fail(`original path does not match the asset: ${asset.originalUrl}`, "arbitrary_upstream");
}

export function loadPublicAcquisition({
  manifestPath = DEFAULT_MANIFEST,
  bytesRoot = DEFAULT_BYTES,
  manifest = null,
} = {}) {
  const manifestDir = dirname(resolve(manifestPath));
  let document = manifest;
  if (!document) {
    document = JSON.parse(readRegularFile(manifestPath).toString("utf8"));
  }
  if (!document || document.schema !== "samedaydesk.public-acquisition.receiving.v1") fail("receiving manifest schema is not recognized");
  if (document.draft !== true || document.productionHosted !== false || document.hostedAcquisitionVerified !== false) {
    fail("receiving manifest claims this draft is hosted", "hosted_claim");
  }
  if (document.runtimeDownloadFallback !== false) fail("runtime download fallback is refused", "runtime_download_forbidden");
  if (document.primaryRouteRemainsAvailable !== true) fail("primary origin route must remain available");
  if (document.sourceQualification !== "unknown") fail("set source qualification must stay unknown", "source_qualification");
  if (!Array.isArray(document.allowedOriginalHosts) || document.allowedOriginalHosts.length === 0) fail("original host allowlist is missing", "arbitrary_upstream");
  if (!Array.isArray(document.assets) || document.assets.length === 0) fail("receiving manifest has no assets");
  const declared = new Set();
  const files = new Map();
  let total = 0;
  for (const asset of document.assets) {
    assertAssetShape(asset, document.allowedOriginalHosts);
    if (declared.has(asset.relativePath)) fail(`duplicate asset: ${asset.relativePath}`, "unsafe_addition");
    declared.add(asset.relativePath);
    const path = join(bytesRoot, ...asset.relativePath.split("/"));
    let bytes;
    try {
      bytes = readRegularFile(path);
    } catch (error) {
      if (error.code === "ENOENT" || /no such file/i.test(error.message)) fail(`missing asset: ${asset.relativePath}`, "missing_asset");
      throw error;
    }
    if (bytes.length !== asset.bytes) fail(`wrong byte length: ${asset.relativePath}`, "wrong_byte_length");
    if (sha256(bytes) !== asset.sha256) fail(`changed bytes: ${asset.relativePath}`, "changed_bytes");
    total += bytes.length;
    if (total > MAX_SET_BYTES) fail("public set exceeds the mount bound", "wrong_byte_length");
    if (asset.role === "archive") {
      const expected = loadInventory(manifestDir, asset);
      const observed = inventoryArchive(bytes);
      if (!sameMembers(observed, expected)) fail(`member inventory does not match: ${asset.relativePath}`, "inventory_mismatch");
      const prefixes = Array.isArray(asset.forbiddenPathPrefixes) ? asset.forbiddenPathPrefixes : [];
      for (const member of observed) {
        if (prefixes.some((prefix) => member.path.includes(prefix))) {
          fail(`private member: ${member.path}`, "private_addition");
        }
      }
    } else if (asset.inventory) {
      fail(`non-archive carries an inventory: ${asset.relativePath}`, "unsafe_addition");
    }
    files.set(asset.relativePath, { asset, bytes });
  }
  let present;
  try {
    present = walkFiles(bytesRoot);
  } catch (error) {
    if (error.code === "ENOENT") fail("bytes directory is missing", "missing_asset");
    throw error;
  }
  for (const rel of present) {
    if (!declared.has(rel)) {
      const code = rel.split("/").some((part) => credentialSegment(part)) ? "private_addition" : "unsafe_addition";
      fail(`undeclared file: ${rel}`, code);
    }
  }
  if (present.length !== declared.size) fail("byte set does not match the manifest", "missing_asset");
  return { document, files, order: [...declared] };
}

export function buildAcquisitionDocument(published, { publicUrl } = {}) {
  const origin = publicUrl ? new URL(publicUrl).origin : null;
  const assets = published.order.map((rel) => {
    const { asset } = published.files.get(rel);
    const alternatePath = `${PUBLIC_ACQUISITION_ASSET_PREFIX}/${asset.relativePath}`;
    return {
      id: asset.id,
      version: asset.version,
      role: asset.role,
      filename: asset.filename,
      bytes: asset.bytes,
      sha256: asset.sha256,
      mediaType: asset.mediaType,
      originalUrl: asset.originalUrl,
      alternatePath,
      alternateUrl: origin ? `${origin}${alternatePath}` : null,
      licenseId: asset.licenseId,
      attribution: asset.attribution,
      sourceQualification: "unknown",
      privateGit: "unavailable",
      hostedAcquisitionVerified: false,
      memberCount: asset.inventory?.memberCount ?? null,
      inventorySha256: asset.inventory?.fileSha256 ?? null,
    };
  });
  return {
    schema: "samedaydesk.public-acquisition.document.v1",
    draft: true,
    productionHosted: false,
    hostedAcquisitionVerified: false,
    deploymentReadback: "untested",
    primaryOrigin: published.document.primaryOrigin,
    primaryRouteRemainsAvailable: true,
    alternateOrigin: origin,
    alternateOriginStatus: origin ? "configured-not-verified" : "unconfigured",
    privateGit: "unavailable",
    paidLaunch: false,
    measuredSavings: false,
    independentDemand: false,
    runtimeDownloadFallback: false,
    sourceQualification: "unknown",
    assets,
  };
}

function resolveAcquisitionPath(pathname, originalUrl) {
  const raw = String(originalUrl || pathname || "").split("?")[0];
  const path = String(pathname || "").split("?")[0];
  const under = (value) => value === PUBLIC_ACQUISITION_PREFIX || value.startsWith(`${PUBLIC_ACQUISITION_PREFIX}/`);
  if (!under(raw) && !under(path)) return { owned: false };
  if (raw.includes("%") || raw.includes("\\") || raw.includes("\0") || path.includes("%") || path.includes("\\") || path.includes("\0")) {
    return { owned: true, reject: true };
  }
  if (path === PUBLIC_ACQUISITION_INDEX_PATH) return { owned: true, index: true };
  if (!path.startsWith(`${PUBLIC_ACQUISITION_ASSET_PREFIX}/`)) return { owned: true, reject: true };
  const rel = path.slice(PUBLIC_ACQUISITION_ASSET_PREFIX.length + 1);
  if (!rel || rel.split("/").some((part) => part === "" || part === "." || part === "..")) return { owned: true, reject: true };
  return { owned: true, rel };
}

function send(res, { status, headers, body, method }) {
  res.status(status);
  for (const [name, value] of Object.entries(headers)) res.set(name, value);
  if (method === "HEAD" || body == null) {
    if (body != null) res.set("Content-Length", String(Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body)));
    return res.end();
  }
  if (Buffer.isBuffer(body)) {
    res.set("Content-Length", String(body.length));
    return res.end(body);
  }
  res.set("Content-Length", String(Buffer.byteLength(body)));
  return res.end(body);
}

export function handlePublicAcquisitionRequest(req, res, {
  published,
  publicUrl,
} = {}) {
  const method = String(req.method || "GET").toUpperCase();
  const resolved = resolveAcquisitionPath(req.path, req.originalUrl || req.url);
  if (!resolved.owned) return false;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff",
  };
  const notFound = () => send(res, {
    status: 404,
    headers: { ...headers, "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ error: "Not found" }),
    method,
  });
  if (resolved.reject) {
    notFound();
    return true;
  }
  if (method === "OPTIONS") {
    send(res, { status: 204, headers: { ...headers, "Cache-Control": INDEX_CACHE_CONTROL, "Content-Length": "0" }, body: null, method });
    return true;
  }
  if (method !== "GET" && method !== "HEAD") {
    send(res, {
      status: 405,
      headers: { ...headers, "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", Allow: "GET, HEAD, OPTIONS" },
      body: JSON.stringify({ error: "Method not allowed" }),
      method,
    });
    return true;
  }
  if (resolved.index) {
    const body = `${JSON.stringify(buildAcquisitionDocument(published, { publicUrl }), null, 2)}\n`;
    let canonical = "";
    if (publicUrl) canonical = `${new URL(publicUrl).origin}${PUBLIC_ACQUISITION_INDEX_PATH}`;
    send(res, {
      status: 200,
      headers: {
        ...headers,
        "Cache-Control": INDEX_CACHE_CONTROL,
        "Content-Type": "application/json; charset=utf-8",
        ...(canonical ? { Link: `<${canonical}>; rel="canonical"` } : {}),
      },
      body,
      method,
    });
    return true;
  }
  const stored = published.files.get(resolved.rel);
  if (!stored) {
    notFound();
    return true;
  }
  let canonical = "";
  if (publicUrl) canonical = `${new URL(publicUrl).origin}${PUBLIC_ACQUISITION_ASSET_PREFIX}/${stored.asset.relativePath}`;
  send(res, {
    status: 200,
    headers: {
      ...headers,
      "Cache-Control": ARCHIVE_CACHE_CONTROL,
      "Content-Type": stored.asset.mediaType,
      ETag: `"${stored.asset.sha256}"`,
      ...(canonical ? { Link: `<${canonical}>; rel="canonical"` } : {}),
    },
    body: stored.bytes,
    method,
  });
  return true;
}

export function mountPublicAcquisition(app, {
  publicUrl,
  manifestPath = DEFAULT_MANIFEST,
  bytesRoot = DEFAULT_BYTES,
  published = null,
} = {}) {
  const loaded = published || loadPublicAcquisition({ manifestPath, bytesRoot });
  app.use((req, res, next) => {
    const handled = handlePublicAcquisitionRequest(req, res, { published: loaded, publicUrl });
    if (handled === false) return next();
    return undefined;
  });
  return { files: loaded.order.length, index: PUBLIC_ACQUISITION_INDEX_PATH };
}
