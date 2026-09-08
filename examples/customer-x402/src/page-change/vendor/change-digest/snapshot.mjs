import { createHash } from "node:crypto";
import { openSync, closeSync, readSync, fstatSync, constants } from "node:fs";
import { extname, basename } from "node:path";
import { SNAPSHOT_SCHEMA, excerpt } from "./limits.mjs";

const MEDIA = Object.freeze({
  json: "application/json",
  html: "text/html",
  text: "text/plain",
});

export function sha256(bufferOrString) {
  const bytes = Buffer.isBuffer(bufferOrString) ? bufferOrString : Buffer.from(bufferOrString, "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

export function decodeUtf8(buffer) {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

function extensionMediaType(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") return MEDIA.json;
  if (ext === ".html" || ext === ".htm") return MEDIA.html;
  if (ext === ".txt" || ext === ".md") return MEDIA.text;
  return null;
}

export function parseObservedAt(value) {
  if (value === undefined || value === null || value === "") return { observedAt: null, error: null };
  if (typeof value !== "string") return { observedAt: null, error: "observed_at_invalid" };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    return { observedAt: null, error: "observed_at_invalid" };
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return { observedAt: null, error: "observed_at_invalid" };
  if (new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return { observedAt: null, error: "observed_at_invalid" };
  return { observedAt: new Date(ms).toISOString(), error: null };
}

function isEnvelope(value) {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && (value.schema === SNAPSHOT_SCHEMA || value.mediaType || Object.hasOwn(value, "observedAt") || Object.hasOwn(value, "body")),
  );
}

export function missingSnapshot(source = {}) {
  return {
    status: "missing",
    mediaType: null,
    observedAt: null,
    truncated: false,
    byteLength: 0,
    sha256: null,
    body: null,
    parsed: null,
    source,
    issues: ["missing_source"],
  };
}

function overLimit(source, byteLength, sha, issues) {
  return {
    status: "over_limit",
    mediaType: null,
    observedAt: null,
    truncated: true,
    byteLength,
    sha256: sha,
    body: null,
    parsed: null,
    source,
    issues,
  };
}

export function loadSnapshot(input, limits, role = "snapshot") {
  if (input && typeof input === "object" && input.missing === true) {
    return missingSnapshot({ kind: input.source?.kind ?? "supplied", path: input.source?.path ?? null, role });
  }
  if (typeof input === "string") return loadSnapshotFromPath(input, limits, role);
  if (Buffer.isBuffer(input)) return materializeSnapshot({ raw: input, source: { kind: "supplied", path: null, role } }, limits);
  if (input && typeof input === "object") {
    return materializeSnapshot({
      envelope: input,
      source: { kind: input.source?.kind ?? "supplied", path: input.source?.path ?? null, role },
    }, limits);
  }
  return {
    status: "invalid",
    mediaType: null,
    observedAt: null,
    truncated: false,
    byteLength: 0,
    sha256: null,
    body: null,
    parsed: null,
    source: { kind: "supplied", path: null, role },
    issues: ["invalid_input"],
  };
}

export function loadSnapshotFromPath(path, limits, role = "snapshot") {
  const source = { kind: "file", path, role };
  let raw;
  try {
    raw = readBoundedFile(path, limits.maxBytes);
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return missingSnapshot(source);
    return {
      status: "invalid",
      mediaType: extensionMediaType(path),
      observedAt: null,
      truncated: false,
      byteLength: 0,
      sha256: null,
      body: null,
      parsed: null,
      source,
      issues: ["unreadable_source"],
    };
  }
  return materializeSnapshot({ raw, source, hintMediaType: extensionMediaType(path) }, limits);
}

export function readBoundedFile(path, maxBytes) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("source must be a regular file");
    // Only one byte beyond the limit is read, never the entire rejected file.
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes + 1));
    let count = 0;
    while (count < buffer.length) {
      const n = readSync(fd, buffer, count, buffer.length - count, null);
      if (!n) break;
      count += n;
    }
    const final = fstatSync(fd);
    if (final.size !== stat.size || final.mtimeMs !== stat.mtimeMs) throw new Error("source changed while reading");
    return buffer.subarray(0, count);
  } finally { closeSync(fd); }
}

export function materializeSnapshot({ raw, envelope, source, hintMediaType = null }, limits) {
  const issues = [];
  if (raw) {
    const digest = sha256(raw);
    if (raw.byteLength > limits.maxBytes) {
      return overLimit(source, raw.byteLength, null, ["byte_limit"]);
    }
    let text;
    try {
      text = decodeUtf8(raw);
    } catch {
      return {
        status: "invalid",
        mediaType: hintMediaType,
        observedAt: null,
        truncated: false,
        byteLength: raw.byteLength,
        sha256: digest,
        body: null,
        parsed: null,
        source,
        issues: ["invalid_utf8"],
      };
    }
    if (hintMediaType === MEDIA.json || (!hintMediaType && text.trimStart().startsWith("{"))) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          status: "invalid",
          mediaType: MEDIA.json,
          observedAt: null,
          truncated: false,
          byteLength: raw.byteLength,
          sha256: digest,
          body: text,
          parsed: null,
          source,
          issues: ["invalid_json"],
        };
      }
      if (isEnvelope(parsed) && Object.hasOwn(parsed, "body")) {
        return materializeSnapshot({ envelope: parsed, source, hintMediaType: parsed.mediaType ?? hintMediaType }, limits);
      }
      return finishSnapshot({
        mediaType: MEDIA.json,
        observedAt: null,
        truncated: false,
        body: parsed,
        text,
        byteLength: raw.byteLength,
        sha256: digest,
        source,
        issues,
      });
    }
    return finishSnapshot({
      mediaType: hintMediaType ?? MEDIA.text,
      observedAt: null,
      truncated: false,
      body: text,
      text,
      byteLength: raw.byteLength,
      sha256: digest,
      source,
      issues,
    });
  }

  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return {
      status: "invalid",
      mediaType: null,
      observedAt: null,
      truncated: false,
      byteLength: 0,
      sha256: null,
      body: null,
      parsed: null,
      source,
      issues: ["invalid_envelope"],
    };
  }

  const truncated = envelope.truncated === true;
  const mediaType = normalizeMediaType(envelope.mediaType ?? hintMediaType);
  const observed = parseObservedAt(envelope.observedAt);
  if (observed.error) issues.push(observed.error);
  if (envelope.status === "missing" || envelope.body === undefined || envelope.body === null) {
    if (envelope.status === "missing" || envelope.body === null) {
      return {
        ...missingSnapshot(source),
        mediaType,
        observedAt: observed.observedAt,
        truncated,
        issues: ["missing_source", ...issues],
      };
    }
  }

  let body = envelope.body;
  let text;
  if (typeof body === "string") {
    text = body;
  } else if (mediaType === MEDIA.json) {
    text = JSON.stringify(body);
  } else {
    issues.push("body_type_invalid");
    return {
      status: "invalid",
      mediaType,
      observedAt: observed.observedAt,
      truncated,
      byteLength: 0,
      sha256: null,
      body: null,
      parsed: null,
      source,
      issues,
    };
  }

  const bytes = Buffer.byteLength(text, "utf8");
  const digest = sha256(text);
  if (bytes > limits.maxBytes) {
    return overLimit(source, bytes, digest, ["byte_limit", ...issues]);
  }

  let parsed = body;
  if (mediaType === MEDIA.json && typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return {
        status: "invalid",
        mediaType,
        observedAt: observed.observedAt,
        truncated,
        byteLength: bytes,
        sha256: digest,
        body: text,
        parsed: null,
        source,
        issues: ["invalid_json", ...issues],
      };
    }
  }

  return finishSnapshot({
    mediaType,
    observedAt: observed.observedAt,
    truncated,
    body: parsed,
    text,
    byteLength: bytes,
    sha256: digest,
    source,
    issues,
  });
}

function normalizeMediaType(value) {
  if (!value) return MEDIA.text;
  const lower = String(value).toLowerCase();
  if (lower === MEDIA.json || lower === "json") return MEDIA.json;
  if (lower === MEDIA.html || lower === "html") return MEDIA.html;
  if (lower === MEDIA.text || lower === "text" || lower === "text/markdown") return MEDIA.text;
  return lower;
}

function finishSnapshot({ mediaType, observedAt, truncated, body, text, byteLength, sha256: digest, source, issues }) {
  const status = truncated ? "truncated" : "present";
  return {
    status,
    mediaType,
    observedAt,
    truncated,
    byteLength,
    sha256: digest,
    body,
    parsed: body,
    text,
    source,
    issues,
    excerpt: excerpt(typeof body === "string" ? body : JSON.stringify(body), 120),
    filename: source?.path ? basename(source.path) : null,
  };
}

export { MEDIA };
