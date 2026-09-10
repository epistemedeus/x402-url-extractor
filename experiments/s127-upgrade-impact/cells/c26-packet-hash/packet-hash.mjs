/**
 * Canonical JSON hash / replay identity for S127 upgrade-impact packets.
 *
 * Cell-local (c26). Sorted object keys + sha256, matching S122 / src/prior.mjs
 * stableStringify so payload hashes can replay against immutable priors.
 *
 * Packet hash includes the envelope (clock, prior, limitations).
 * Payload hash is the decision-relevant subset (c08 PRIOR_PAYLOAD_KEYS),
 * with provenance.retrievedAt stripped so recapture of the same bytes matches.
 * Decision hash is the action|unknown|no_action surface (bindings + summary),
 * with binding order and rationale stripped so replay detects identical decisions.
 *
 * Schema: s127.upgrade-impact.packet-hash.v1
 * Offline. No network, no lifecycle scripts, no payment.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const HASH_SCHEMA = "s127.upgrade-impact.packet-hash.v1";
export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";
export const HASH_ALGO = "sha256";

/** Decision-relevant fields hashed into a prior payload. Envelope excluded. */
export const PAYLOAD_KEYS = Object.freeze([
  "caller",
  "dependency",
  "provenance",
  "usage",
  "exportDiff",
  "bindings",
  "summary",
]);

export const EVIDENCE_LABELS = Object.freeze(["fixture", "live-capture", "synthetic"]);
export const DECISIONS = Object.freeze(["action", "unknown", "no_action"]);

export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function unwrapPacket(input) {
  if (!isPlainObject(input)) return input;
  if (input.ok === true && isPlainObject(input.packet)) return input.packet;
  if (
    isPlainObject(input.packet) &&
    !isPlainObject(input.dependency) &&
    !isPlainObject(input.caller)
  ) {
    return input.packet;
  }
  return input;
}

/**
 * Recursively sort object keys. Array order is preserved (arrays are ordered).
 * Own properties named __proto__/constructor/prototype are copied via
 * defineProperty so they remain keys, not prototype mutations.
 */
export function sortKeys(value, seen = new WeakSet()) {
  if (value && typeof value === "object") {
    if (seen.has(value)) throw new TypeError("unhashable: circular structure");
    seen.add(value);
  }
  if (Array.isArray(value)) return value.map((item) => sortKeys(item, seen));
  if (value && typeof value === "object") {
    if (!isPlainObject(value)) {
      throw new TypeError(
        `unhashable: non-plain object (${value.constructor?.name || typeof value}); hash JSON values only`,
      );
    }
    const out = {};
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(out, key, {
        value: sortKeys(value[key], seen),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  if (typeof value === "bigint") {
    throw new TypeError("unhashable: bigint is not JSON");
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`unhashable: ${typeof value} is not JSON`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("unhashable: non-finite number is not JSON");
  }
  return value;
}

/** Canonical JSON text: JSON.stringify of recursively key-sorted value. No extra whitespace. */
export function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

export function canonicalJson(value) {
  return stableStringify(value);
}

export function canonicalBytes(value) {
  return Buffer.from(stableStringify(value), "utf8");
}

/** Artifact bytes: canonical JSON plus trailing newline (S122 document style). Not used in the digest. */
export function documentBytes(value) {
  return Buffer.from(`${stableStringify(value)}\n`, "utf8");
}

export function sha256Hex(value) {
  const input =
    typeof value === "string" || Buffer.isBuffer(value) ? value : stableStringify(value);
  return createHash("sha256").update(input).digest("hex");
}

function canonicalizeProvenance(prov) {
  if (prov == null) return undefined;
  const list = Array.isArray(prov) ? prov : [prov];
  return list.map((entry) => {
    if (!isPlainObject(entry)) return entry;
    return {
      locator: entry.url || entry.path || entry.locator || null,
      url: entry.url ?? null,
      path: entry.path ?? null,
      contentSha256: entry.contentSha256 ?? null,
      coverage: entry.coverage ?? null,
      label: entry.label ?? null,
    };
  });
}

/**
 * Decision-relevant payload. Matches src/prior.mjs canonicalPayload:
 * drops clock/createdAt/prior/limitations/schema and provenance.retrievedAt.
 */
export function canonicalPayload(input) {
  if (!isPlainObject(input)) return null;
  const src =
    isPlainObject(input.payload) && !isPlainObject(input.dependency) && !isPlainObject(input.caller)
      ? input.payload
      : unwrapPacket(input);
  if (!isPlainObject(src)) return null;
  const out = {};
  for (const key of PAYLOAD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(src, key) || src[key] === undefined) continue;
    if (key === "provenance") {
      const proven = canonicalizeProvenance(src.provenance);
      if (proven !== undefined) out.provenance = proven;
      continue;
    }
    out[key] = src[key];
  }
  try {
    return JSON.parse(stableStringify(out));
  } catch {
    return null;
  }
}

function cmpText(a, b) {
  const sa = a == null ? "" : String(a);
  const sb = b == null ? "" : String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

function normalizeListItem(item) {
  if (item == null) return "";
  if (typeof item === "string") return item;
  if (typeof item === "number" || typeof item === "boolean") return String(item);
  if (isPlainObject(item) && item.symbol != null) return String(item.symbol);
  try {
    return stableStringify(item);
  } catch {
    return String(item);
  }
}

function normalizeStringList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeListItem).sort(cmpText);
}

function bindingRow(row) {
  if (!isPlainObject(row)) {
    return { changeKind: null, decision: null, symbol: null, used: false };
  }
  return {
    changeKind: row.changeKind ?? null,
    decision: row.decision ?? null,
    symbol: row.symbol ?? row.name ?? row.export ?? null,
    used: row.used === true,
  };
}

/**
 * Decision surface for replay: per-symbol decisions + summary nextAction.
 * Binding array order and rationale wording do not affect this view.
 * unknownReasons / unusedChanges / actionableChanges are sorted.
 */
export function decisionView(input) {
  const src = unwrapPacket(input);
  const bindings = Array.isArray(src?.bindings) ? src.bindings.map(bindingRow) : [];
  bindings.sort(
    (a, b) =>
      cmpText(a.symbol, b.symbol) ||
      cmpText(a.changeKind, b.changeKind) ||
      cmpText(a.decision, b.decision) ||
      cmpText(a.used, b.used),
  );
  const summary = isPlainObject(src?.summary) ? src.summary : {};
  return {
    bindings,
    summary: {
      actionableChanges: normalizeStringList(summary.actionableChanges),
      nextAction: summary.nextAction ?? null,
      unknownReasons: normalizeStringList(summary.unknownReasons),
      unusedChanges: normalizeStringList(summary.unusedChanges),
    },
  };
}

function labelFrom(input) {
  if (!isPlainObject(input)) return null;
  const labels = [];
  if (typeof input.label === "string") labels.push(input.label);
  const body = unwrapPacket(input);
  if (isPlainObject(body) && typeof body.label === "string") labels.push(body.label);
  const prov = Array.isArray(body?.provenance) ? body.provenance : [];
  for (const row of prov) {
    if (typeof row?.label === "string") labels.push(row.label);
  }
  const unique = [...new Set(labels)];
  if (unique.includes("live-capture")) return "live-capture";
  if (unique.includes("synthetic")) return "synthetic";
  if (unique.includes("fixture")) return "fixture";
  return unique[0] ?? null;
}

function evidenceClassFrom(input) {
  const body = unwrapPacket(input);
  if (!isPlainObject(body)) return "unlabeled";
  return body.caller?.evidenceClass || input.evidenceClass || labelFrom(input) || "unlabeled";
}

export function packetHash(input) {
  const packet = unwrapPacket(input);
  if (!isPlainObject(packet)) {
    throw new TypeError("packetHash requires a plain object packet");
  }
  return sha256Hex(packet);
}

export function payloadHash(input) {
  const payload = canonicalPayload(input);
  if (!payload) {
    throw new TypeError("payloadHash requires a packet or prior payload object");
  }
  return sha256Hex(payload);
}

export function decisionHash(input) {
  return sha256Hex(decisionView(input));
}

export function hashPacket(input, options = {}) {
  const packet = unwrapPacket(input);
  if (!isPlainObject(packet)) {
    return { ok: false, code: "invalid_packet", message: "packet must be a plain object" };
  }
  let packetCanonical;
  try {
    packetCanonical = stableStringify(packet);
  } catch (error) {
    return {
      ok: false,
      code: "unhashable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const payload = canonicalPayload(packet);
  const decision = decisionView(packet);
  const result = {
    ok: true,
    schema: HASH_SCHEMA,
    algo: HASH_ALGO,
    packetSchema: typeof packet.schema === "string" ? packet.schema : null,
    packetHash: sha256Hex(packetCanonical),
    payloadHash: payload ? sha256Hex(payload) : null,
    decisionHash: sha256Hex(decision),
    nextAction: decision.summary.nextAction,
    evidenceClass: evidenceClassFrom(packet),
    label: labelFrom(packet) || "unlabeled",
  };
  if (options.verbose) {
    result.canonicalPacket = packetCanonical;
    result.payload = payload;
    result.decision = decision;
  }
  return result;
}

export function hashPacketFile(path, options = {}) {
  let raw;
  try {
    raw = readFileSync(path);
  } catch (error) {
    return {
      ok: false,
      code: "unreadable",
      path,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    return {
      ok: false,
      code: "invalid_json",
      path,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const hashed = hashPacket(parsed, options);
  if (!hashed.ok) return { ...hashed, path };
  return {
    ...hashed,
    path,
    sourceBytes: raw.length,
    sourceSha256: sha256Hex(raw),
  };
}

export function hashPacketText(text, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      code: "invalid_json",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return hashPacket(parsed, options);
}

export function compareReplay(a, b) {
  const ha = hashPacket(a);
  const hb = hashPacket(b);
  if (!ha.ok || !hb.ok) {
    return { ok: false, code: "compare_failed", a: ha, b: hb };
  }
  return {
    ok: true,
    identicalPacket: ha.packetHash === hb.packetHash,
    identicalPayload: ha.payloadHash === hb.payloadHash && ha.payloadHash != null,
    identicalDecision: ha.decisionHash === hb.decisionHash,
    a: {
      packetHash: ha.packetHash,
      payloadHash: ha.payloadHash,
      decisionHash: ha.decisionHash,
      nextAction: ha.nextAction,
    },
    b: {
      packetHash: hb.packetHash,
      payloadHash: hb.payloadHash,
      decisionHash: hb.decisionHash,
      nextAction: hb.nextAction,
    },
  };
}

/**
 * Recursively copy a JSON value with object keys in reverse lexicographic order.
 * Used to materialize key-order fixtures. Not part of the digest.
 */
export function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (isPlainObject(value)) {
    const out = {};
    const keys = Object.keys(value).sort().reverse();
    for (const key of keys) {
      Object.defineProperty(out, key, {
        value: reverseKeys(value[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

export function coverageNotes() {
  return Object.freeze({
    algorithm: HASH_ALGO,
    canonicalization: "JSON.stringify(sortKeys(value)); object keys lexicographic; array order preserved",
    notRfc8785: true,
    integerLikeKeys:
      "JSON.stringify enumerates integer-like keys in numeric order; packet contract fields are not integer-like",
    envelopeExcludedFromPayload: ["schema", "createdAt", "clock", "prior", "limitations"],
    provenanceStrippedFromPayload: ["retrievedAt"],
    decisionExcludes: ["rationale", "binding array order", "envelope", "provenance", "usage", "exportDiff"],
    tsAndDynamic: "unknown; this module does not analyze source",
  });
}
