import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rename, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ACQUISITION_SKILL_NAME = "route-lock-receipt";
export const ACQUISITION_PREFIX = `/.well-known/skills/${ACQUISITION_SKILL_NAME}`;
export const MACHINE_ACQUISITION_CACHE_CONTROL = "public, max-age=3600";
export const MACHINE_ACQUISITION_MAX_BYTES = 1_048_576;
export const DECLARED_EXTRACT_OPERATION = Object.freeze({
  method: "GET",
  origin: "https://agents.samedaydesk.com",
  route: "/extract",
});
export const DEFAULT_MERCHANT_RECIPIENT = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
export const NEO_SKILL_URL = "https://neomorphic.io/.well-known/skills/route-lock-receipt/SKILL.md";
export const NEO_INDEX_URL = "https://neomorphic.io/.well-known/skills/index.json";
export const PUBLIC_SOURCE_COMMIT = "79a18338251769f22ca31a951008fca62dc70797";

const RECIPIENT_RE = /^0x[0-9a-fA-F]{40}$/;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BUNDLE = join(MODULE_DIR, "machine-acquisition", "bundles", ACQUISITION_SKILL_NAME);
const DEFAULT_PINS = join(MODULE_DIR, "machine-acquisition", "pins.json");

function fail(message) {
  const error = new Error(`machine acquisition invalid: ${message}`);
  error.code = "machine_acquisition_invalid";
  throw error;
}

export function compareNodeVersion(left, right) {
  const parse = (value) => String(value).replace(/^v/, "").split(".").map((part) => Number(part));
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i += 1) {
    const delta = (a[i] || 0) - (b[i] || 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

export function nodeEngineSatisfies(version, range) {
  const match = /^>=(\d+\.\d+\.\d+)$/.exec(String(range || "").trim());
  if (!match) fail(`unsupported node range: ${range}`);
  return compareNodeVersion(version, match[1]) >= 0;
}

export function assertNodeEngine(version, range) {
  if (!nodeEngineSatisfies(version, range)) {
    const error = new Error(`node ${version} does not satisfy ${range}`);
    error.code = "node_engine_unsatisfied";
    throw error;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readRegularFile(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    fail(`cannot open without following symlinks: ${path}: ${error.message}`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) fail(`not a regular file: ${path}`);
    if (st.size > MACHINE_ACQUISITION_MAX_BYTES) fail(`file exceeds ${MACHINE_ACQUISITION_MAX_BYTES} bytes: ${path}`);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function walkFiles(dir, base = "") {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    fail(`cannot read ${dir}: ${error.message}`);
  }
  const files = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) fail(`symlink is not servable: ${rel}`);
    if (entry.isDirectory()) files.push(...walkFiles(path, rel));
    else if (entry.isFile()) files.push(rel);
    else fail(`unsupported directory entry: ${rel}`);
  }
  return files;
}

function frontmatterValue(markdown, key) {
  if (!markdown.startsWith("---\n")) fail("SKILL.md is missing frontmatter");
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) fail("SKILL.md frontmatter does not close");
  for (const line of markdown.slice(4, end).split("\n")) {
    if (line.startsWith(`${key}: `)) return line.slice(key.length + 2).trim();
  }
  return "";
}

function declaredOperationFromSkill(markdown) {
  const match = markdown.match(/map --url (\S+)/);
  if (!match) fail("SKILL.md is missing the map --url operation");
  let url;
  try {
    url = new URL(match[1]);
  } catch (error) {
    fail(`SKILL.md map URL is not a URL: ${error.message}`);
  }
  return { method: "GET", origin: url.origin, route: url.pathname };
}

function contentType(rel) {
  if (rel === "SKILL.md") return "text/markdown; charset=utf-8";
  if (rel.endsWith(".json")) return "application/json; charset=utf-8";
  if (rel.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export function loadMachineAcquisition(bundleDir = DEFAULT_BUNDLE, pinsPath = DEFAULT_PINS) {
  const pins = JSON.parse(readRegularFile(pinsPath).toString("utf8"));
  if (pins.skill !== ACQUISITION_SKILL_NAME) fail(`pin skill ${pins.skill} is not ${ACQUISITION_SKILL_NAME}`);
  if (pins.license !== "MIT") fail("pin license is not MIT");
  if (pins.publicSourceCommit !== PUBLIC_SOURCE_COMMIT) fail("pin source commit changed");
  if (pins.originSkill !== NEO_SKILL_URL || pins.originIndex !== NEO_INDEX_URL) fail("pin Neo URL changed");
  if (!pins.files || typeof pins.files !== "object" || Array.isArray(pins.files)) fail("pin file map is missing");
  const pinned = Object.keys(pins.files);
  const present = walkFiles(bundleDir).sort();
  const expected = [...pinned].sort();
  if (present.join("\n") !== expected.join("\n")) {
    fail(`bundle file set does not match pins: ${present.join(", ")}`);
  }
  const files = new Map();
  for (const rel of pinned) {
    const bytes = readRegularFile(join(bundleDir, ...rel.split("/")));
    const digest = sha256(bytes);
    if (digest !== pins.files[rel]) fail(`changed content: ${rel}`);
    files.set(rel, bytes);
  }
  const skillMarkdown = files.get("SKILL.md").toString("utf8");
  const declared = declaredOperationFromSkill(skillMarkdown);
  if (declared.method !== DECLARED_EXTRACT_OPERATION.method
    || declared.origin !== DECLARED_EXTRACT_OPERATION.origin
    || declared.route !== DECLARED_EXTRACT_OPERATION.route) {
    fail(`declared operation changed: ${declared.method} ${declared.origin}${declared.route}`);
  }
  const manifest = JSON.parse(files.get("references/manifest.json").toString("utf8"));
  if (manifest.indexUrl !== NEO_INDEX_URL || manifest.deploymentUrl !== NEO_SKILL_URL) {
    fail("frozen manifest Neo URL changed");
  }
  if (manifest.executableSha256 !== pins.executableSha256) fail("manifest executable hash drifted from pins");
  if (sha256(files.get(pins.executable)) !== pins.executableSha256) fail("executable bytes do not match the pin");
  const description = frontmatterValue(skillMarkdown, "description");
  const name = frontmatterValue(skillMarkdown, "name");
  if (name !== ACQUISITION_SKILL_NAME || !description) fail("SKILL.md name or description is missing");
  return {
    name,
    description,
    files,
    order: pinned,
    pins,
    declaredOperation: DECLARED_EXTRACT_OPERATION,
    bundleDir,
  };
}

export function acquisitionIndexSkill({ bundle = loadMachineAcquisition(), recipient = DEFAULT_MERCHANT_RECIPIENT } = {}) {
  if (!RECIPIENT_RE.test(recipient)) fail(`recipient is not an EVM address: ${recipient}`);
  return {
    name: bundle.name,
    description: bundle.description,
    files: [...bundle.order],
    source: {
      license: "MIT",
      publisher: "Neomorphic LLC",
      publicSourceCommit: PUBLIC_SOURCE_COMMIT,
      originUrl: NEO_SKILL_URL,
      originIndex: NEO_INDEX_URL,
      notice: "Public bytes mirrored for clients whose HTTP client receives HTTP 403 from the Neo origin. Neo archive URLs and frozen versioned artifacts are unchanged. This mirror is not a paid offer.",
      operation: {
        method: DECLARED_EXTRACT_OPERATION.method,
        origin: DECLARED_EXTRACT_OPERATION.origin,
        route: DECLARED_EXTRACT_OPERATION.route,
        recipient,
      },
    },
  };
}

function acquisitionRelative(pathname, originalUrl) {
  const raw = String(originalUrl || pathname || "").split("?")[0];
  const path = String(pathname || "").split("?")[0];
  const under = (value) => value === ACQUISITION_PREFIX || value.startsWith(`${ACQUISITION_PREFIX}/`);
  if (!under(raw) && !under(path)) return { owned: false };
  if (raw.includes("%") || raw.includes("\\") || raw.includes("\0") || path.includes("%") || path.includes("\\") || path.includes("\0")) {
    return { owned: true, reject: true };
  }
  const rel = path.slice(ACQUISITION_PREFIX.length + 1);
  if (!rel || rel.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return { owned: true, reject: true };
  }
  return { owned: true, rel };
}

function send(res, { status, headers, body, method }) {
  res.status(status);
  for (const [name, value] of Object.entries(headers)) res.set(name, value);
  if (method === "HEAD" || body == null) {
    if (body != null) res.set("Content-Length", String(Buffer.byteLength(body)));
    return res.end();
  }
  if (Buffer.isBuffer(body)) {
    res.set("Content-Length", String(body.length));
    return res.end(body);
  }
  return res.send(body);
}

export function handleMachineAcquisitionRequest(req, res, {
  bundle = loadMachineAcquisition(),
  publicUrl,
} = {}) {
  const method = String(req.method || "GET").toUpperCase();
  const resolved = acquisitionRelative(req.path, req.originalUrl || req.url);
  if (!resolved.owned) return false;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": MACHINE_ACQUISITION_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  };
  if (resolved.reject || !bundle.files.has(resolved.rel)) {
    return send(res, {
      status: 404,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Not found" }),
      method,
    }) || true;
  }
  if (method === "OPTIONS") {
    return send(res, { status: 204, headers: { ...headers, "Content-Length": "0" }, body: null, method }) || true;
  }
  if (method !== "GET" && method !== "HEAD") {
    return send(res, {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8", Allow: "GET, HEAD, OPTIONS" },
      body: JSON.stringify({ error: "Method not allowed" }),
      method,
    }) || true;
  }
  const body = bundle.files.get(resolved.rel);
  const type = contentType(resolved.rel);
  let canonical = "";
  if (publicUrl) {
    const origin = new URL(publicUrl).origin;
    canonical = `${origin}${ACQUISITION_PREFIX}/${resolved.rel}`;
  }
  return send(res, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": type,
      ...(canonical ? { Link: `<${canonical}>; rel="canonical"` } : {}),
    },
    body,
    method,
  }) || true;
}

export function mountMachineAcquisition(app, { publicUrl, bundle = loadMachineAcquisition() } = {}) {
  app.use((req, res, next) => {
    const handled = handleMachineAcquisitionRequest(req, res, { bundle, publicUrl });
    if (handled === false) return next();
    return undefined;
  });
  return { name: bundle.name, files: [...bundle.order] };
}

function safeRelative(rel) {
  if (typeof rel !== "string" || rel === "" || rel.includes("\\") || rel.includes("\0") || rel.startsWith("/")) return null;
  const parts = rel.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return rel;
}

async function fetchManual(fetchImpl, url) {
  const parsed = new URL(url);
  if (parsed.username || parsed.password) {
    const error = new Error("credential_url");
    error.code = "credential_url";
    throw error;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    const error = new Error("unsupported_protocol");
    error.code = "unsupported_protocol";
    throw error;
  }
  const response = await fetchImpl(url, { redirect: "manual" });
  return response;
}

export async function installFromWellKnown({
  indexUrl,
  skillName = ACQUISITION_SKILL_NAME,
  dest,
  pins = null,
  fetchImpl = fetch,
}) {
  const baseResult = {
    ok: false,
    nativeHermesInstall: false,
    client: "node-fetch-manual-redirect",
    headerSpoof: false,
    privateGit: false,
    filesWritten: [],
  };
  const failInstall = async (code, extra = {}) => ({ ...baseResult, ...extra, code });
  let indexResponse;
  try {
    indexResponse = await fetchManual(fetchImpl, indexUrl);
  } catch (error) {
    return failInstall(error.code || "index_fetch_failed", { message: error.message });
  }
  if (indexResponse.status >= 300 && indexResponse.status < 400) return failInstall("redirect_rejected", { status: indexResponse.status });
  if (indexResponse.status !== 200) return failInstall("index_unavailable", { status: indexResponse.status });
  let index;
  try {
    index = await indexResponse.json();
  } catch {
    return failInstall("malformed_index");
  }
  if (!index || !Array.isArray(index.skills)) return failInstall("malformed_index");
  const entry = index.skills.find((skill) => skill && skill.name === skillName);
  if (!entry || !Array.isArray(entry.files) || entry.files.length === 0) return failInstall("malformed_index");
  const relatives = [];
  for (const rel of entry.files) {
    const safe = safeRelative(rel);
    if (!safe) return failInstall("unsafe_path", { path: rel });
    relatives.push(safe);
  }
  if (!relatives.includes("SKILL.md")) return failInstall("missing_support_file", { path: "SKILL.md" });
  const base = indexUrl.endsWith("/index.json") ? indexUrl.slice(0, -"/index.json".length) : "";
  if (!base.endsWith(`/${skillName}`) && !base.endsWith("/.well-known/skills")) {
    return failInstall("malformed_index");
  }
  const skillBase = base.endsWith(`/${skillName}`) ? base : `${base}/${skillName}`;
  const downloaded = new Map();
  for (const rel of relatives) {
    const fileUrl = `${skillBase}/${rel.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
    let response;
    try {
      response = await fetchManual(fetchImpl, fileUrl);
    } catch (error) {
      return failInstall(error.code || "file_fetch_failed", { path: rel, message: error.message });
    }
    if (response.status >= 300 && response.status < 400) return failInstall("redirect_rejected", { path: rel, status: response.status });
    if (response.status === 404) return failInstall("missing_support_file", { path: rel });
    if (response.status !== 200) return failInstall("file_unavailable", { path: rel, status: response.status });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (pins && pins[rel] && sha256(bytes) !== pins[rel]) return failInstall("changed_content", { path: rel });
    if (pins && !pins[rel]) return failInstall("unpinned_file", { path: rel });
    downloaded.set(rel, bytes);
  }
  const staging = await mkdtemp(join(tmpdir(), "machine-acquisition-install-"));
  try {
    for (const [rel, bytes] of downloaded) {
      const path = join(staging, ...rel.split("/"));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: "wx" });
    }
    await rename(staging, dest);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    return failInstall(error.code === "ENOTEMPTY" || error.code === "EEXIST" ? "dest_exists" : "write_failed", { message: error.message });
  }
  return {
    ...baseResult,
    ok: true,
    code: "installed",
    filesWritten: [...downloaded.keys()],
  };
}

export function classifyInstallEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return { accepted: false, reason: "evidence_missing" };
  if (evidence.headerSpoof === true) return { accepted: false, reason: "spoofed_header_called_native" };
  if (evidence.nativeHermesInstall === true && evidence.client !== "hermes-cli") {
    return { accepted: false, reason: "non_hermes_client_called_native" };
  }
  if (evidence.nativeRuntimeAvailable === false) return { accepted: false, reason: "native_runtime_unavailable", abstain: true };
  if (!evidence.skillMdOnDisk) return { accepted: false, reason: "skill_md_missing" };
  if (evidence.requiresExecutable && !evidence.executableOnDisk) return { accepted: false, reason: "executable_missing" };
  if (evidence.executableSha256 && evidence.observedExecutableSha256 !== evidence.executableSha256) {
    return { accepted: false, reason: "executable_changed" };
  }
  return {
    accepted: true,
    nativeHermesInstall: evidence.nativeHermesInstall === true && evidence.client === "hermes-cli",
    reason: evidence.nativeHermesInstall === true ? "native_hermes_install" : "non_native_install",
  };
}

export function extractChallengePayTo(decisionRequest) {
  const raw = decisionRequest?.subject?.runtime?.headers?.["payment-required"];
  if (typeof raw !== "string" || raw === "") return null;
  let body;
  try {
    body = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
  const payTo = body?.accepts?.[0]?.payTo;
  return typeof payTo === "string" ? payTo : null;
}

export function bindingFromCapture({ receipt, payTo, recipient = DEFAULT_MERCHANT_RECIPIENT }) {
  const operation = receipt?.operation;
  if (!operation) fail("capture receipt has no operation");
  if (operation.method !== DECLARED_EXTRACT_OPERATION.method) fail("capture method is not the declared operation");
  if (operation.origin !== DECLARED_EXTRACT_OPERATION.origin) fail("capture origin is not the declared operation");
  if (operation.route !== DECLARED_EXTRACT_OPERATION.route) fail("capture route is not the declared operation");
  if (!RECIPIENT_RE.test(payTo || "") || payTo.toLowerCase() !== recipient.toLowerCase()) {
    fail("capture recipient is not the merchant recipient");
  }
  return {
    method: operation.method,
    origin: operation.origin,
    route: operation.route,
    recipient,
    bindingDigest: operation.bindingDigest || null,
  };
}

export function authorizeReceiptAction(receipt, binding, { now, readReceipt, observedRecipient } = {}) {
  const denied = (reason, exitCode = 3) => ({
    schema: "samedaydesk.machine-acquisition.second-process.v1",
    actionAuthorized: false,
    newAuthority: "denied",
    observationAccepted: false,
    paymentPermitted: false,
    fundsReserved: false,
    ownerPayment: false,
    paidServiceLaunch: false,
    executed: false,
    reason,
    exitCode,
  });
  if (!receipt || typeof receipt !== "object" || !binding) return denied("unreadable", 2);
  const operation = receipt.operation || {};
  if (operation.method !== binding.method) return denied("changed-method");
  if (operation.origin !== binding.origin) return denied("changed-origin");
  if (operation.route !== binding.route) return denied("changed-route");
  if (receipt.mutation === "changed-recipient" || receipt.route?.code === "recipient_changed") return denied("changed-recipient");
  if (typeof observedRecipient === "string" && observedRecipient.toLowerCase() !== String(binding.recipient || "").toLowerCase()) {
    return denied("changed-recipient");
  }
  if (typeof readReceipt !== "function") return denied("unreadable", 2);
  const reading = readReceipt(receipt, { now: now || new Date().toISOString() });
  const reason = reading?.currentAuthority?.reason || "unreadable";
  if (reading?.currentAuthority?.observationCurrent !== true) {
    return denied(reason, reason === "unreadable" ? 2 : 3);
  }
  return {
    schema: "samedaydesk.machine-acquisition.second-process.v1",
    actionAuthorized: false,
    newAuthority: "denied",
    observationAccepted: true,
    paymentPermitted: false,
    fundsReserved: false,
    ownerPayment: false,
    paidServiceLaunch: false,
    executed: false,
    reason: "current-observation",
    exitCode: 0,
    checkedAt: now || null,
  };
}

