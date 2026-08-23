import { createHash, createHmac, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  appendFile,
  chmod,
  mkdir,
  open as fsOpen,
  readFile,
  lstat as fsLstat,
} from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  decodeEventLog,
  fallback,
  getAddress,
  http,
  parseAbiItem,
} from "viem";
import { base } from "viem/chains";

import { normalizeCommercePayerClasses } from "./commerce-events.mjs";
import { isProxy } from "node:util/types";

const SCHEMA_VERSION = "samedaydesk.commerce-settlement-reconciliation.v1";
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function parseLines(contents) {
  let invalidLines = 0;
  const records = String(contents || "").split("\n").filter(Boolean).flatMap((line) => {
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed] : [];
    } catch {
      invalidLines += 1;
      return [];
    }
  });
  return { invalidLines, records };
}

function payerClassByActor(secret, payerClasses) {
  return new Map([...normalizeCommercePayerClasses(payerClasses)].map(([address, paymentClass]) => [
    createHmac("sha256", secret).update(`payer:${address}`).digest("hex").slice(0, 24),
    paymentClass,
  ]));
}

function issue(code, subject) {
  return { code, subjectHash: `sha256:${sha256(subject).slice(0, 24)}` };
}

function decodeIncomingTransfers(receipt, { asset, treasury }) {
  return (receipt?.logs || []).flatMap((log) => {
    if (String(log?.address || "").toLowerCase() !== asset.toLowerCase()) return [];
    try {
      const decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics, strict: true });
      if (decoded.eventName !== "Transfer") return [];
      const to = getAddress(decoded.args.to);
      if (to !== treasury) return [];
      return [{
        from: getAddress(decoded.args.from),
        amountAtomic: BigInt(decoded.args.value),
      }];
    } catch {
      return [];
    }
  });
}

function addAmount(bucket, key, amount) {
  if (!bucket[key]) bucket[key] = { settlements: 0, amountAtomic: "0" };
  bucket[key].settlements += 1;
  bucket[key].amountAtomic = (BigInt(bucket[key].amountAtomic) + amount).toString();
}

export function summarizeCommerceSettlementLedger(contents, {
  paymentClassBySourceEventId = new Map(),
} = {}) {
  const parsed = parseLines(contents);
  const byClass = Object.create(null);
  const byRoute = Object.create(null);
  const references = new Set();
  let reconciledSettlements = 0;
  let amountAtomic = 0n;
  for (const record of parsed.records) {
    if (record?.schemaVersion !== SCHEMA_VERSION || record?.state !== "reconciled") continue;
    if (!TRANSACTION_HASH_PATTERN.test(String(record.settlementReference || ""))) continue;
    if (!/^\d+$/.test(String(record.amountAtomic || ""))) continue;
    const reference = String(record.settlementReference).toLowerCase();
    if (references.has(reference)) continue;
    references.add(reference);
    const amount = BigInt(record.amountAtomic);
    reconciledSettlements += 1;
    amountAtomic += amount;
    const currentPaymentClass = paymentClassBySourceEventId.get(String(record.sourceEventId || ""))
      || record.paymentClass
      || "unclassified";
    addAmount(byClass, String(currentPaymentClass), amount);
    addAmount(byRoute, String(record.route || "/:unknown"), amount);
  }
  return {
    schemaVersion: "samedaydesk.commerce-settlement-summary.v1",
    reconciledSettlements,
    distinctSettlementReferences: references.size,
    amountAtomic: amountAtomic.toString(),
    byClass,
    byRoute,
    invalidLines: parsed.invalidLines,
  };
}

function currentPaymentClassBySourceEventId(eventContents, {
  actorSecret,
  payerClasses,
  settlementEvidenceSince,
} = {}) {
  const classesByActor = payerClassByActor(actorSecret, payerClasses);
  const sinceMs = Date.parse(settlementEvidenceSince);
  const result = new Map();
  for (const event of parseLines(eventContents).records) {
    if (event?.result !== "paid_success" || Date.parse(event.ts) < sinceMs) continue;
    const sourceEventId = String(event.id || "");
    if (!sourceEventId) continue;
    result.set(sourceEventId, event.paymentActor
      ? classesByActor.get(event.paymentActor) || "unclassified"
      : "unclassified");
  }
  return result;
}

export async function reconcileCommerceSettlementEvents(eventContents, ledgerContents, {
  actorSecret,
  asset = BASE_USDC,
  client,
  network = "eip155:8453",
  payerClasses = "",
  settlementEvidenceSince,
  treasury,
  now = () => new Date(),
} = {}) {
  if (typeof actorSecret !== "string" || actorSecret.length < 16) fail("commerce actor secret is required for settlement reconciliation");
  if (network !== "eip155:8453") fail("commerce settlement reconciliation supports Base mainnet only");
  const normalizedAsset = getAddress(asset);
  if (normalizedAsset !== getAddress(BASE_USDC)) fail("commerce settlement reconciliation requires canonical Base USDC");
  const normalizedTreasury = getAddress(treasury);
  const sinceMs = Date.parse(settlementEvidenceSince);
  if (!Number.isFinite(sinceMs)) fail("settlement evidence baseline is required");
  if (!client?.getTransactionReceipt || !client?.getBlock) fail("Base public client is required");

  const events = parseLines(eventContents);
  const existing = parseLines(ledgerContents);
  const existingReferences = new Set(existing.records
    .map((record) => String(record?.settlementReference || "").toLowerCase())
    .filter((reference) => TRANSACTION_HASH_PATTERN.test(reference)));
  const classesByActor = payerClassByActor(actorSecret, payerClasses);
  const grouped = new Map();
  for (const event of events.records) {
    if (event?.result !== "paid_success" || Date.parse(event.ts) < sinceMs) continue;
    const reference = String(event.settlementReference || "").toLowerCase();
    if (!TRANSACTION_HASH_PATTERN.test(reference)) continue;
    if (!grouped.has(reference)) grouped.set(reference, []);
    grouped.get(reference).push(event);
  }

  const issues = [];
  const newRecords = [];
  let alreadyReconciled = 0;
  for (const [reference, matchingEvents] of grouped) {
    if (existingReferences.has(reference)) {
      alreadyReconciled += 1;
      continue;
    }
    if (matchingEvents.length !== 1) {
      issues.push(issue("duplicate_paid_event_reference", reference));
      continue;
    }
    const event = matchingEvents[0];
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: reference });
    } catch {
      issues.push(issue("receipt_unavailable", reference));
      continue;
    }
    if (receipt?.status !== "success") {
      issues.push(issue("transaction_unsuccessful", reference));
      continue;
    }
    const transfers = decodeIncomingTransfers(receipt, { asset: normalizedAsset, treasury: normalizedTreasury });
    if (transfers.length !== 1) {
      issues.push(issue("treasury_transfer_count_mismatch", reference));
      continue;
    }
    const transfer = transfers[0];
    if (transfer.amountAtomic <= 0n) {
      issues.push(issue("transfer_amount_invalid", reference));
      continue;
    }
    if (event.settlementAmountAtomic !== null && event.settlementAmountAtomic !== undefined
      && String(transfer.amountAtomic) !== String(event.settlementAmountAtomic)) {
      issues.push(issue("response_amount_mismatch", reference));
      continue;
    }
    if (event.settlementNetwork && String(event.settlementNetwork).toLowerCase() !== network) {
      issues.push(issue("response_network_mismatch", reference));
      continue;
    }
    if (event.settlementCurrency && String(event.settlementCurrency).toLowerCase() !== normalizedAsset.toLowerCase()) {
      issues.push(issue("response_currency_mismatch", reference));
      continue;
    }
    if (event.settlementProtocol && event.paymentProtocol && event.settlementProtocol !== event.paymentProtocol) {
      issues.push(issue("response_protocol_mismatch", reference));
      continue;
    }
    const observedPaymentActor = createHmac("sha256", actorSecret)
      .update(`payer:${transfer.from.toLowerCase()}`)
      .digest("hex")
      .slice(0, 24);
    if (event.paymentActor && event.paymentActor !== observedPaymentActor) {
      issues.push(issue("payer_continuity_mismatch", reference));
      continue;
    }
    let block;
    try {
      block = await client.getBlock({ blockNumber: receipt.blockNumber });
    } catch {
      issues.push(issue("block_unavailable", reference));
      continue;
    }
    const paymentClass = classesByActor.get(event.paymentActor || observedPaymentActor) || "unclassified";
    newRecords.push({
      schemaVersion: SCHEMA_VERSION,
      reconciliationId: `sddsr_${sha256(`${event.id}|${reference}|${transfer.amountAtomic}`).slice(0, 40)}`,
      reconciledAt: now().toISOString(),
      state: "reconciled",
      sourceEventId: String(event.id || ""),
      sourceEventTimestamp: new Date(event.ts).toISOString(),
      route: String(event.route || "/:unknown"),
      protocol: String(event.paymentProtocol || event.settlementProtocol || "unknown"),
      paymentClass,
      settlementReference: reference,
      network,
      asset: normalizedAsset,
      treasury: normalizedTreasury,
      amountAtomic: transfer.amountAtomic.toString(),
      blockNumber: String(receipt.blockNumber),
      blockTimestamp: new Date(Number(block.timestamp) * 1_000).toISOString(),
      payerContinuity: event.paymentActor ? "matched_request_pseudonym" : "onchain_only",
    });
  }

  return {
    newRecords,
    issues,
    eligibleSettlementReferences: grouped.size,
    alreadyReconciled,
    invalidEventLines: events.invalidLines,
    invalidLedgerLines: existing.invalidLines,
  };
}

async function readExisting(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function issueCounts(issues) {
  const counts = Object.create(null);
  for (const item of issues || []) counts[item.code] = (counts[item.code] || 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Settlement-plane writer-generation frozen contract, revisions 4 through 7.
//
// T4a amendment 3 replaces observer-authored generation inference with a
// fsynced private manifest published through one pinned O_DIRECTORY namespace
// and read back only through the exact descriptor transaction
// temp / manifest A / ledger / manifest B / temp. The parent parser and
// accumulator remain the sole money authority; public operational state is
// never hydrated or failed by private evidence.
//
// Same-effective-UID boundary (revision 7): no write-capable open of an
// existing fixed temp precedes a successful non-writing inspection, every
// write descriptor is reopened only through /proc/self/fd/<inspectionFd>,
// and every mandatory checkpoint observation fails closed on mismatch.
// Atomic exclusion against a nonconforming same-UID process acting strictly
// inside a check/action syscall gap is expressly NOT claimed; such an action
// is labeled "OUTSIDE_SAME_UID_ATOMIC_BOUNDARY" and observed changes still withhold.
//
// Lifecycle: disabled | never_run | restart_pending | ok | corrupt | unstable.

export const SETTLEMENT_PLANE_CAPTURE_SCHEMA = "samedaydesk.commerce-settlement-plane-capture.v1";
const SETTLEMENT_SUMMARY_SCHEMA = "samedaydesk.commerce-settlement-summary.v1";
const GENERATION_MANIFEST_SCHEMA = "samedaydesk.commerce-settlement-generation.v1";
const RUN_ID_SCHEMA = "samedaydesk.commerce-settlement-run-id.v1";
const GENERATION_PAYLOAD_SCHEMA = "samedaydesk.commerce-settlement-plane-generation.v1";
const OBSERVATION_PAYLOAD_SCHEMA = "samedaydesk.commerce-settlement-plane-observation.v1";
const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DIGIT_AMOUNT = /^\d+$/u;
const PRODUCTION_MAX_CUT_BYTES = 8 * 1024 * 1024;
const PRODUCTION_MAX_ATTEMPTS = 8;
const PRODUCTION_MAX_RETRY_DELAY_MS = 1_000;

export const SETTLEMENT_PLANE_LIFECYCLE_STATES = Object.freeze(new Set([
  "never_run",
  "running",
  "ok",
  "restart_pending",
  "unstable",
  "corrupt",
]));

export const SETTLEMENT_GENERATION_LIFECYCLE_STATES = Object.freeze([
  "disabled",
  "never_run",
  "restart_pending",
  "ok",
  "corrupt",
  "unstable",
]);

// Exact reason-or-null authority (revision 5 section 8): 43 values including
// null. No worker-authored rename or reordering is permitted.
export const SETTLEMENT_PLANE_REASONS = Object.freeze([
  "disabled",
  "hostile_options",
  "hostile_limits",
  "ledger_path_invalid",
  "data_directory_untrusted",
  "data_directory_io_error",
  "publication_in_progress_or_orphan",
  "publication_temp_untrusted",
  "generation_manifest_missing",
  "generation_manifest_too_large",
  "generation_manifest_not_regular_file",
  "generation_manifest_wrong_mode",
  "generation_manifest_short_read",
  "generation_manifest_invalid_utf8",
  "generation_manifest_invalid_json",
  "generation_manifest_noncanonical",
  "generation_manifest_schema_invalid",
  "generation_manifest_namespace_mismatch",
  "generation_manifest_run_id_mismatch",
  "generation_manifest_changed",
  "reconciliation_failed",
  "ledger_absent_after_complete_run",
  "ledger_disappeared",
  "ledger_not_regular_file",
  "ledger_wrong_mode",
  "ledger_too_large",
  "ledger_short_read",
  "ledger_identity_changed",
  "ledger_generation_mismatch",
  "io_eintr",
  "io_eagain",
  "io_ebusy",
  "io_estale",
  "io_eacces",
  "io_eperm",
  "io_emfile",
  "io_enfile",
  "io_eloop",
  "io_enotdir",
  "io_unknown",
  "descriptor_close_failed",
  "sleep_failed",
]);

const REASON_AUTHORITY = Object.freeze(new Set(SETTLEMENT_PLANE_REASONS));

// Frozen closure labels implemented by this mutation (revisions 5-7):
// OPERATIONAL_SPLIT, ACYCLIC_IDS, FIXED_TEMP, HOSTILE_MODEL,
// WRITER_FAULT_SEAM, RETRY_TAXONOMY, MISSING_DIRECTORY, ALLOCATION_METRIC,
// PINNED_PARENT_APPEND, WRITER_CONTENTION, PINNED_TEMP_IDENTITY,
// LEDGER_PATH_GRAMMAR.

// Fixed runtime publication names. The fixed temp bounds crash accumulation
// to at most one orphan file and is never deleted, truncated, adopted, or
// replaced automatically.
const MANIFEST_NAME = "commerce-settlement-generation.json";
const TEMP_NAME = ".commerce-settlement-generation.tmp";
const LEDGER_NAME = "commerce-settlements.ndjson";
const MAX_MANIFEST_BYTES = 8_192;
const CONTENDER_POISON_OFFSET = 8_192;
const CONTENDER_POISON_BYTE = 0x21;
const MAX_LEASE_TRANSITIONS = 8;

// Linux O_PATH is not exported by Node's fs.constants; revision 6 freezes the
// Linux header value directly (asm-generic/fcntl.h: 010000000).
const O_PATH_LINUX_R6 = 0o10000000;

// Fixed capture bounds. Callers may lower maxCutBytes/attempts/delay; they
// cannot raise them past these production maxima.
export const DEFAULT_CUT_LIMITS = Object.freeze({
  maxCutBytes: PRODUCTION_MAX_CUT_BYTES,
  attempts: 3,
  retryDelayMs: 25,
});

export const LEDGER_OPEN_FLAGS = fsConstants.O_RDONLY
  | fsConstants.O_NONBLOCK
  | fsConstants.O_NOFOLLOW;

export const DEFAULT_LEDGER_IO = Object.freeze({
  stat: (file) => fsLstat(file, { bigint: true }),
  open: (file, flags = LEDGER_OPEN_FLAGS) => fsOpen(file, flags),
  fstat: (handle) => handle.stat({ bigint: true }),
  read: (handle, buffer, offset, length, position) => handle.read(buffer, offset, length, position),
  close: (handle) => handle.close(),
});

function defaultSleep(ms) {
  const delay = Number.isSafeInteger(ms) && ms > 0 ? ms : 0;
  return new Promise((resolve) => { setTimeout(resolve, delay); });
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function ownValue(object, key) {
  return inspectOwn(object, key).value;
}

function inspectOwn(object, key) {
  try {
    if (object == null || (typeof object !== "object" && typeof object !== "function")) {
      return { threw: false, value: undefined };
    }
    if (!Object.hasOwn(object, key)) return { threw: false, value: undefined };
    return { threw: false, value: object[key] };
  } catch {
    return { threw: true, value: undefined };
  }
}

function errorCode(error) {
  try {
    const code = ownValue(error, "code");
    return typeof code === "string" ? code : "";
  } catch {
    return "";
  }
}

// Hostile-model primitive: proxy values are rejected with isProxy before any
// reflection, so rejection causes zero proxy traps (HOSTILE_MODEL).
function hostileProxy(value) {
  try {
    return isProxy(value);
  } catch {
    return false;
  }
}


function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return value;
}

function statScalar(value) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function millisToNs(ms) {
  if (typeof ms === "bigint") return (ms * 1_000_000n).toString();
  if (typeof ms === "number" && Number.isFinite(ms)) {
    const ns = Math.round(ms * 1e6);
    return Number.isFinite(ns) ? String(ns) : null;
  }
  return null;
}

function identityOf(stat) {
  if (!stat || typeof stat !== "object") return null;
  return Object.freeze({
    dev: toFiniteNumber(stat.dev),
    ino: toFiniteNumber(stat.ino),
    mode: toFiniteNumber(stat.mode),
  });
}

function generationOf(stat) {
  if (!stat || typeof stat !== "object") return null;
  return Object.freeze({
    dev: statScalar(stat.dev),
    ino: statScalar(stat.ino),
    mode: statScalar(stat.mode),
    size: statScalar(stat.size),
    mtimeNs: statScalar(stat.mtimeNs) ?? millisToNs(stat.mtimeMs),
    ctimeNs: statScalar(stat.ctimeNs) ?? millisToNs(stat.ctimeMs),
  });
}

function sameFileGeneration(left, right) {
  if (!left || !right) return false;
  for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) {
    if (left[key] == null || right[key] == null || left[key] !== right[key]) return false;
  }
  return true;
}

function isRegularFileStat(stat) {
  try {
    if (!stat || typeof stat !== "object") return false;
    if (typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink()) return false;
    return typeof stat.isFile === "function" && stat.isFile() === true;
  } catch {
    return false;
  }
}

function isSymlinkStat(stat) {
  try {
    return Boolean(stat && typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink());
  } catch {
    return false;
  }
}

function safeByteSize(stat) {
  const size = stat?.size;
  if (typeof size === "bigint") {
    if (size < 0n || size > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(size);
  }
  if (Number.isSafeInteger(size) && size >= 0) return size;
  return null;
}

function clampLimit(value, fallback, min, max) {
  if (!Number.isSafeInteger(value) || value < min) return fallback;
  return Math.min(value, max);
}

function normalizeCutLimits(limits) {
  return {
    maxCutBytes: clampLimit(
      limits?.maxCutBytes,
      DEFAULT_CUT_LIMITS.maxCutBytes,
      1,
      PRODUCTION_MAX_CUT_BYTES,
    ),
    attempts: clampLimit(
      limits?.attempts,
      DEFAULT_CUT_LIMITS.attempts,
      1,
      PRODUCTION_MAX_ATTEMPTS,
    ),
    retryDelayMs: clampLimit(
      limits?.retryDelayMs,
      DEFAULT_CUT_LIMITS.retryDelayMs,
      0,
      PRODUCTION_MAX_RETRY_DELAY_MS,
    ),
  };
}

function canonicalIsoTimestampMs(value) {
  if (typeof value !== "string" || value.length !== 24 || !ISO_UTC_TIMESTAMP.test(value)) return null;
  try {
    const parsed = new Date(value);
    const ms = parsed.getTime();
    if (!Number.isSafeInteger(ms) || parsed.toISOString() !== value) return null;
    return ms;
  } catch {
    return null;
  }
}

function canonicalBaselineIso(value) {
  try {
    if (typeof value !== "string" || value.length === 0) return null;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function isNonRegularOpenError(code) {
  return code === "ELOOP"
    || code === "EISDIR"
    || code === "ENOTDIR"
    || code === "ENXIO"
    || code === "EAGAIN"
    || code === "EWOULDBLOCK";
}

function bytesFromCut(cut) {
  const value = ownValue(cut, "bytes");
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return null;
}

async function readExactBytes(io, handle, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await io.read(handle, bytes, offset, size - offset, offset);
    if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0) break;
    offset += bytesRead;
  }
  return { bytes, byteCount: offset };
}

// Cut one stable snapshot of the ledger file: no-follow lstat ->
// O_RDONLY|O_NONBLOCK|O_NOFOLLOW open -> fstat -> sized pread -> fstat ->
// close. The cut only counts as coherent when the path generation, the
// pre-read fd generation, and the post-read fd generation agree on
// identity, size, and nanosecond mtime/ctime, the opened descriptor is a
// regular file, and the number of bytes actually read equals that size.
// Otherwise the attempt is torn; after `limits.attempts` tries the cut is
// explicitly `unstable`. A path that disappears after it was observed is
// instability, not clean absence. ENOENT on first observation is a plain
// absent ledger and does not fabricate a zero-byte digest.
export async function captureStableLedgerCut(ledgerPath, {
  limits = DEFAULT_CUT_LIMITS,
  io = DEFAULT_LEDGER_IO,
  sleep = defaultSleep,
} = {}) {
  const bounds = normalizeCutLimits(limits);
  if (hostileProxy(ledgerPath) || typeof ledgerPath !== "string" || ledgerPath.length === 0) {
    return {
      present: false,
      unstable: true,
      regularFile: false,
      reason: "ledger_path_invalid",
      attemptsUsed: 0,
    };
  }

  let lastReason = "torn_cut";
  let observedPresent = false;
  for (let attempt = 1; attempt <= bounds.attempts; attempt += 1) {
    let beforeStat;
    try {
      beforeStat = await io.stat(ledgerPath, { bigint: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        if (observedPresent) {
          return {
            present: false,
            unstable: true,
            regularFile: false,
            reason: "ledger_disappeared",
            attemptsUsed: attempt,
          };
        }
        return { present: false, unstable: false, regularFile: false, attemptsUsed: attempt };
      }
      return {
        present: true,
        unstable: true,
        regularFile: false,
        reason: "ledger_unreadable",
        attemptsUsed: attempt,
      };
    }
    if (isSymlinkStat(beforeStat) || !isRegularFileStat(beforeStat)) {
      return {
        present: true,
        unstable: true,
        irregular: true,
        regularFile: false,
        reason: "ledger_not_regular_file",
        identity: identityOf(beforeStat),
        attemptsUsed: attempt,
      };
    }
    const pathSize = safeByteSize(beforeStat);
    if (pathSize === null) {
      return {
        present: true,
        unstable: true,
        regularFile: false,
        reason: "ledger_size_unsafe",
        identity: identityOf(beforeStat),
        attemptsUsed: attempt,
      };
    }
    if (pathSize > bounds.maxCutBytes) {
      return {
        present: true,
        unstable: true,
        regularFile: false,
        reason: "ledger_too_large",
        identity: identityOf(beforeStat),
        attemptsUsed: attempt,
      };
    }

    observedPresent = true;
    const pathGeneration = generationOf(beforeStat);
    let handle = null;
    let torn = false;
    let reason = "torn_cut";
    let before = null;
    let after = null;
    let bytes = null;
    let byteCount = 0;
    let descriptorProvedRegular = false;
    try {
      handle = await io.open(ledgerPath, LEDGER_OPEN_FLAGS);
      before = await io.fstat(handle, { bigint: true });
      if (isSymlinkStat(before) || !isRegularFileStat(before)) {
        return {
          present: true,
          unstable: true,
          irregular: true,
          regularFile: false,
          reason: "ledger_not_regular_file",
          identity: identityOf(before),
          attemptsUsed: attempt,
        };
      }
      descriptorProvedRegular = true;
      const fdSize = safeByteSize(before);
      if (fdSize === null) {
        return {
          present: true,
          unstable: true,
          regularFile: false,
          reason: "ledger_size_unsafe",
          identity: identityOf(before),
          attemptsUsed: attempt,
        };
      }
      if (fdSize > bounds.maxCutBytes) {
        return {
          present: true,
          unstable: true,
          regularFile: false,
          reason: "ledger_too_large",
          identity: identityOf(before),
          attemptsUsed: attempt,
        };
      }
      if (!sameFileGeneration(pathGeneration, generationOf(before))) {
        torn = true;
      } else if (fdSize === 0) {
        bytes = Buffer.alloc(0);
        byteCount = 0;
        after = await io.fstat(handle, { bigint: true });
        if (
          !isRegularFileStat(after)
          || !sameFileGeneration(generationOf(before), generationOf(after))
          || safeByteSize(after) !== 0
        ) {
          torn = true;
        }
      } else {
        const exact = await readExactBytes(io, handle, fdSize);
        bytes = exact.bytes;
        byteCount = exact.byteCount;
        if (byteCount !== fdSize) {
          torn = true;
          reason = "byte_count_mismatch";
        } else {
          after = await io.fstat(handle, { bigint: true });
          if (
            !isRegularFileStat(after)
            || !sameFileGeneration(generationOf(before), generationOf(after))
            || safeByteSize(after) !== byteCount
          ) {
            torn = true;
          }
        }
      }
      if (!torn) {
        let pathAfter;
        try {
          pathAfter = await io.stat(ledgerPath, { bigint: true });
        } catch (error) {
          if (errorCode(error) === "ENOENT") {
            torn = true;
            reason = "ledger_disappeared";
          } else {
            torn = true;
            reason = "ledger_read_error";
          }
        }
        if (!torn) {
          if (isSymlinkStat(pathAfter) || !isRegularFileStat(pathAfter)) {
            return {
              present: true,
              unstable: true,
              irregular: true,
              regularFile: false,
              reason: "ledger_not_regular_file",
              identity: identityOf(pathAfter),
              attemptsUsed: attempt,
            };
          }
          if (!sameFileGeneration(generationOf(before), generationOf(pathAfter))) {
            torn = true;
          }
        }
      }
    } catch (error) {
      const code = errorCode(error);
      if (isNonRegularOpenError(code)) {
        return {
          present: true,
          unstable: true,
          irregular: true,
          regularFile: false,
          reason: "ledger_not_regular_file",
          attemptsUsed: attempt,
        };
      }
      torn = true;
      reason = code === "ENOENT" && observedPresent ? "ledger_disappeared" : "ledger_read_error";
    } finally {
      if (handle) await io.close(handle).catch(() => {});
    }

    if (!torn && bytes && descriptorProvedRegular) {
      return {
        present: true,
        unstable: false,
        regularFile: true,
        attemptsUsed: attempt,
        identity: identityOf(after || before),
        bytes,
        byteCount,
        byteDigest: sha256Hex(bytes),
      };
    }
    lastReason = reason;
    if (reason === "ledger_disappeared") {
      return {
        present: false,
        unstable: true,
        regularFile: false,
        reason: "ledger_disappeared",
        attemptsUsed: attempt,
      };
    }
    if (attempt < bounds.attempts) await sleep(bounds.retryDelayMs);
  }
  return {
    present: true,
    unstable: true,
    regularFile: false,
    reason: lastReason,
    attemptsUsed: bounds.attempts,
  };
}

function normalizeRunState(runState) {
  if (runState === null || runState === undefined) return null;
  if (typeof runState !== "object" || Array.isArray(runState)) return null;
  const lastIssueCounts = Object.create(null);
  try {
    const counts = ownValue(runState, "lastIssueCounts");
    if (counts && typeof counts === "object") {
      for (const code of Object.keys(counts)) {
        if (!Object.hasOwn(counts, code) || typeof code !== "string") continue;
        let count;
        try {
          count = counts[code];
        } catch {
          continue;
        }
        if (Number.isSafeInteger(count) && count >= 0) lastIssueCounts[code] = count;
      }
    }
  } catch {
    // Issue evidence that cannot be read safely is dropped, never guessed.
  }
  let impossibleLastRunAt = false;
  let lastRunAt = null;
  try {
    if (Object.hasOwn(runState, "lastRunAt") && runState.lastRunAt != null) {
      if (canonicalIsoTimestampMs(runState.lastRunAt) === null) impossibleLastRunAt = true;
      else lastRunAt = runState.lastRunAt;
    }
  } catch {
    impossibleLastRunAt = true;
    lastRunAt = null;
  }
  let lastError = null;
  try {
    lastError = typeof ownValue(runState, "lastError") === "string" ? ownValue(runState, "lastError") : null;
  } catch {
    lastError = null;
  }
  let runGenerationId = null;
  try {
    runGenerationId = typeof ownValue(runState, "runGenerationId") === "string"
      ? ownValue(runState, "runGenerationId")
      : null;
  } catch {
    runGenerationId = null;
  }
  return Object.freeze({
    runGenerationId,
    lastRunAt,
    impossibleLastRunAt,
    lastError,
    lastIssueCounts: Object.freeze({ ...lastIssueCounts }),
  });
}

// Classify one parsed ledger row. Only fully canonical reconciled settlement
// records may contribute revenue; everything else is named issue evidence
// (`unrecognized_ledger_record`, false-economic amounts, unsafe amounts,
// impossible timestamps) that is never silently dropped and never counted
// as money.
function own(record, key) {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function classifyLedgerRecord(record) {
  try {
    if (record === null || typeof record !== "object" || Array.isArray(record)) return "corrupt_line";
    if (own(record, "schemaVersion") !== SCHEMA_VERSION || own(record, "state") !== "reconciled") {
      return "unrecognized_ledger_record";
    }
    const reference = String(own(record, "settlementReference") || "");
    if (!TRANSACTION_HASH_PATTERN.test(reference)) return "unrecognized_ledger_record";
    const amountAtomic = own(record, "amountAtomic");
    if (!DIGIT_AMOUNT.test(String(amountAtomic ?? ""))) return "unsafe_amount_atomic";
    return "revenue";
  } catch {
    return "hostile_ledger_record";
  }
}

function resolveLifecycle({ cut, running, runState, corruptLines, withheld, byteCount }) {
  if (withheld || ownValue(cut, "unstable")) return "unstable";
  if (running) return "running";
  if (corruptLines > 0) return "corrupt";
  if (runState?.lastError) return "restart_pending";
  if (!runState) {
    return ownValue(cut, "present") === true && byteCount > 0 ? "restart_pending" : "never_run";
  }
  if (ownValue(cut, "present") !== true) return "restart_pending";
  return "ok";
}

function readCutIdentity(cut) {
  try {
    const identity = ownValue(cut, "identity");
    if (!identity || typeof identity !== "object") return null;
    return Object.freeze({
      dev: identity.dev,
      ino: identity.ino,
      mode: identity.mode,
    });
  } catch {
    return null;
  }
}

function snapshotRunObservation(observeRun, runState, running) {
  if (typeof observeRun !== "function") {
    return { runState, running: Boolean(running) };
  }
  try {
    const observed = observeRun();
    return {
      runState: observed && typeof observed === "object" ? observed.runState : null,
      running: Boolean(observed?.running),
    };
  } catch {
    return { runState: null, running: false };
  }
}

function runObservationChanged(before, after) {
  return before.runState !== after.runState || before.running !== after.running;
}

function unstableFallbackSnapshot(capturedAtDate, reason = "hostile_cut") {
  const generationId = `setlcut_${sha256Hex(JSON.stringify([
    SETTLEMENT_PLANE_CAPTURE_SCHEMA,
    "unstable",
    reason,
  ])).slice(0, 32)}`;
  return Object.freeze({
    schemaVersion: SETTLEMENT_PLANE_CAPTURE_SCHEMA,
    capturedAt: capturedAtDate,
    generationId,
    observationId: `setlobs_${sha256Hex(JSON.stringify([generationId, capturedAtDate])).slice(0, 32)}`,
    lifecycle: "unstable",
    enabled: false,
    baseline: null,
    attemptsUsed: 0,
    ledger: Object.freeze({
      present: false,
      regularFile: false,
      identity: null,
      byteCount: null,
      byteDigest: null,
    }),
    integrity: Object.freeze({
      corruptLines: 0,
      issues: Object.freeze(Object.create(null)),
      reason,
    }),
    summary: null,
    run: null,
    runFromPreviousGeneration: false,
  });
}

function freezeBuckets(bucket) {
  const frozen = Object.create(null);
  for (const [key, value] of Object.entries(bucket || {})) {
    frozen[key] = Object.freeze({ ...value });
  }
  return Object.freeze(frozen);
}

// Pure core. Builds one frozen generation snapshot from an already-stable cut
// plus the in-memory run generation captured atomically by reference. Hostile
// tests exercise this directly with objects JSON.parse would never produce.
export function buildCommerceSettlementPlaneSnapshot({
  cut,
  enabled = true,
  baseline = "",
  runState = null,
  running = false,
  now = () => new Date(),
} = {}) {
  const capturedAtDate = (() => {
    try {
      const value = now();
      return value instanceof Date && Number.isSafeInteger(value.getTime())
        ? value.toISOString()
        : new Date().toISOString();
    } catch {
      return new Date().toISOString();
    }
  })();

  try {
    const normalizedRun = normalizeRunState(runState);
    let baselineIso = null;
    try {
      baselineIso = canonicalBaselineIso(baseline);
    } catch {
      baselineIso = null;
    }

    const issues = Object.create(null);
    let corruptLines = 0;
    let summaryDigest = null;
    let summary = null;
    let withheld = false;
    let withholdReason = null;
    let byteCount = null;
    let byteDigest = null;
    let hostileCut = false;
    for (const key of [
      "unstable",
      "present",
      "reason",
      "identity",
      "byteDigest",
      "byteCount",
      "bytes",
      "attemptsUsed",
      "regularFile",
      "irregular",
    ]) {
      if (inspectOwn(cut, key).threw) hostileCut = true;
    }
    let unstableCut = hostileCut || inspectOwn(cut, "unstable").value === true;
    if (hostileCut) {
      withheld = true;
      withholdReason = "hostile_cut";
    }

    if (unstableCut) {
      withheld = true;
      const reasonValue = inspectOwn(cut, "reason").value;
      withholdReason = hostileCut
        ? "hostile_cut"
        : (typeof reasonValue === "string" && reasonValue.length > 0
          ? reasonValue
          : (withholdReason || "torn_cut"));
    } else if (inspectOwn(cut, "present").value === true) {
      const bytes = bytesFromCut(cut);
      if (bytes === null) {
        withheld = true;
        withholdReason = "ledger_bytes_missing";
      } else {
        const actualDigest = sha256Hex(bytes);
        const declaredCount = ownValue(cut, "byteCount");
        const declaredDigest = ownValue(cut, "byteDigest");
        if (
          (declaredCount != null && declaredCount !== bytes.length)
          || (typeof declaredDigest === "string" && declaredDigest !== actualDigest)
        ) {
          withheld = true;
          withholdReason = "byte_digest_mismatch";
        } else {
          byteCount = bytes.length;
          byteDigest = actualDigest;
          const text = bytes.toString("utf8");
          const parentSummary = summarizeCommerceSettlementLedger(text);
          corruptLines = Number.isSafeInteger(parentSummary.invalidLines)
            ? parentSummary.invalidLines
            : 0;
          const seenReferences = new Set();
          for (const line of text.split("\n")) {
            if (line.length === 0) continue;
            let parsed;
            try {
              parsed = JSON.parse(line);
            } catch {
              continue;
            }
            const classification = classifyLedgerRecord(parsed);
            if (classification === "revenue") {
              const reference = String(own(parsed, "settlementReference") || "").toLowerCase();
              if (seenReferences.has(reference)) {
                issues.duplicate_ledger_reference = (issues.duplicate_ledger_reference || 0) + 1;
                continue;
              }
              if (reference) seenReferences.add(reference);
              continue;
            }
            if (classification === "corrupt_line") {
              corruptLines += 1;
              continue;
            }
            issues[classification] = (issues[classification] || 0) + 1;
          }
          summary = {
            schemaVersion: parentSummary.schemaVersion || SETTLEMENT_SUMMARY_SCHEMA,
            reconciledSettlements: parentSummary.reconciledSettlements,
            distinctSettlementReferences: parentSummary.distinctSettlementReferences,
            amountAtomic: parentSummary.amountAtomic,
            byClass: parentSummary.byClass,
            byRoute: parentSummary.byRoute,
            invalidLines: parentSummary.invalidLines,
          };
          summaryDigest = sha256Hex(JSON.stringify(summary));
        }
      }
    }

    // H11: a literal regularFile:false cut returns ledger_not_regular_file,
    // null summary, and null byte facts even when caller bytes/hashes look valid.
    const declaredRegular = inspectOwn(cut, "regularFile").value === true;
    if (!withheld && !unstableCut && !declaredRegular) {
      withheld = true;
      withholdReason = "ledger_not_regular_file";
      summary = null;
      summaryDigest = null;
      corruptLines = 0;
      for (const key of Object.keys(issues)) delete issues[key];
      byteCount = null;
      byteDigest = null;
    }

    const lifecycle = resolveLifecycle({
      cut,
      running: Boolean(running),
      runState: normalizedRun,
      corruptLines,
      withheld,
      byteCount,
    });
    const generationSeed = JSON.stringify([
      SETTLEMENT_PLANE_CAPTURE_SCHEMA,
      lifecycle,
      withheld ? null : byteDigest,
      summaryDigest,
      normalizedRun ?? null,
      Boolean(enabled),
      baselineIso,
    ]);
    const generationId = `setlcut_${sha256Hex(generationSeed).slice(0, 32)}`;
    const observationId = `setlobs_${sha256Hex(JSON.stringify([generationId, capturedAtDate])).slice(0, 32)}`;
    let attemptsUsed = 0;
    try {
      const rawAttempts = ownValue(cut, "attemptsUsed");
      attemptsUsed = Number.isSafeInteger(rawAttempts) ? rawAttempts : 0;
    } catch {
      attemptsUsed = 0;
    }
    const descriptorRegular = ownValue(cut, "regularFile") === true;

    return Object.freeze({
      schemaVersion: SETTLEMENT_PLANE_CAPTURE_SCHEMA,
      capturedAt: capturedAtDate,
      generationId,
      observationId,
      lifecycle,
      enabled: Boolean(enabled),
      baseline: baselineIso,
      attemptsUsed,
      ledger: Object.freeze({
        present: ownValue(cut, "present") === true,
        regularFile: descriptorRegular,
        identity: readCutIdentity(cut),
        // Byte facts are withheld entirely when no stable cut exists: absence of
        // evidence is never reported as zero evidence.
        byteCount,
        byteDigest,
      }),
      integrity: Object.freeze({
        corruptLines,
        issues: Object.freeze({ ...issues }),
        reason: withheld ? withholdReason : null,
      }),
      summary: summary === null
        ? null
        : Object.freeze({
          ...summary,
          byClass: freezeBuckets(summary.byClass),
          byRoute: freezeBuckets(summary.byRoute),
          digest: summaryDigest,
        }),
      run: normalizedRun,
      // While a reconcile is in flight, run fields belong to the previous
      // completed generation and are labelled as such instead of being mixed.
      runFromPreviousGeneration: running === true,
    });
  } catch {
    return unstableFallbackSnapshot(capturedAtDate);
  }
}

// ---------------------------------------------------------------------------
// T4a amendment 3, revisions 4-7: writer-generation and settlement stable-cut
// contract implementation. The parent money authority above is unchanged.
// ---------------------------------------------------------------------------

const ISSUE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const LOWER_HEX_64 = /^[0-9a-f]{64}$/u;
const NONCE_HEX_32 = /^[0-9a-f]{32}$/u;

function canonicalMillisecondUtc(ms) {
  return new Date(ms).toISOString();
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function firstNhex(value, count) {
  return createHash("sha256").update(value).digest("hex").slice(0, count);
}

// Literal acyclic identifiers (revision 4 section 5, revision 5 section 7).
function namespaceIdentity(devDecimal, inoDecimal) {
  const preimage = Buffer.from(
    `samedaydesk.settlement-namespace.v1\0${devDecimal}\0${inoDecimal}`,
    "utf8",
  );
  return `setlns_${firstNhex(preimage, 32)}`;
}

function runGenerationIdOf(payload) {
  return `setlrun_${firstNhex(Buffer.from(JSON.stringify(payload), "utf8"), 24)}`;
}

function summaryDigestOf(summary) {
  return sha256Bytes(Buffer.from(JSON.stringify(summary), "utf8"));
}

function generationIdOf(payload) {
  return `setlcut_${firstNhex(Buffer.from(JSON.stringify(payload), "utf8"), 32)}`;
}

function observationIdOf(payload) {
  return `setlobs_${firstNhex(Buffer.from(JSON.stringify(payload), "utf8"), 32)}`;
}

// Issue pairs: sorted by ascending UTF-16 code-unit order via sort() with no
// comparator; exact grammar ^[a-z][a-z0-9_]{0,63}$; at most 64 unique codes.
function issuePairsFrom(countsObject) {
  if (!countsObject || typeof countsObject !== "object") return [];
  const codes = Object.keys(countsObject).filter((code) => (
    ISSUE_CODE_PATTERN.test(code)
    && Object.hasOwn(countsObject, code)
    && Number.isSafeInteger(countsObject[code])
    && countsObject[code] >= 0
  ));
  const unique = [...new Set(codes)].sort();
  if (unique.length > 64) return null;
  return unique.map((code) => [code, countsObject[code]]);
}

function issueCountObject(pairs) {
  const result = Object.create(null);
  for (const [code, count] of pairs || []) result[code] = count;
  return result;
}

// Exact `ledgerPath` classifier override (revision 7 section 7). A proxy or
// revoked proxy value is hostile_options without a trap; every nonproxy value
// whose primitive typeof is not exactly "string" is ledger_path_invalid
// without reflection, iteration, coercion, or recursive traversal - a cyclic
// ordinary object used only as the path is path-invalid, not hostile.
function classifyLedgerPath(rawValue) {
  if (hostileProxy(rawValue)) return "hostile_options";
  if (rawValue === undefined || rawValue === null || typeof rawValue !== "string") {
    return "ledger_path_invalid";
  }
  return validateLedgerPathGrammar(rawValue) ? null : "ledger_path_invalid";
}

// Primitive-string grammar (revision 6 section 7.2, unchanged in revision 7):
// well-formed NFC, 1..4096 UTF-8 bytes, no NUL/C0/DEL/backslash, absolute
// normalized POSIX form, exactly one leading slash, no repeated or trailing
// slash, nonempty non-dot components of at most 255 UTF-8 bytes, exact
// basename commerce-settlements.ndjson. No coercion or repair of any kind.
function validateLedgerPathGrammar(value) {
  try {
    if (!String.prototype.isWellFormed.call(value)) return false;
    if (value.normalize("NFC") !== value) return false;
    const utf8Bytes = Buffer.byteLength(value, "utf8");
    if (utf8Bytes < 1 || utf8Bytes > 4096) return false;
    if (/[\u0000-\u001F\u007F\\]/u.test(value)) return false;
    if (!path.posix.isAbsolute(value)) return false;
    if (path.posix.normalize(value) !== value) return false;
    if (!value.startsWith("/") || value.includes("//") || value.endsWith("/")) return false;
    for (const component of value.slice(1).split("/")) {
      if (component.length === 0 || component === "." || component === "..") return false;
      if (Buffer.byteLength(component, "utf8") > 255) return false;
      if (!String.prototype.isWellFormed.call(component)) return false;
      if (component.normalize("NFC") !== component) return false;
    }
    return path.posix.basename(value) === LEDGER_NAME;
  } catch {
    return false;
  }
}

// OS error mapping is literal (revision 5 section 10). Contextual ENOENT uses
// the manifest/ledger/directory rows instead of io_unknown.
const IO_ERROR_MAP = Object.freeze({
  EINTR: { reason: "io_eintr", retry: true },
  EAGAIN: { reason: "io_eagain", retry: true },
  EBUSY: { reason: "io_ebusy", retry: true },
  ESTALE: { reason: "io_estale", retry: true },
  EACCES: { reason: "io_eacces", retry: false },
  EPERM: { reason: "io_eperm", retry: false },
  EMFILE: { reason: "io_emfile", retry: false },
  ENFILE: { reason: "io_enfile", retry: false },
  ELOOP: { reason: "io_eloop", retry: false },
  ENOTDIR: { reason: "io_enotdir", retry: false },
});

function mapIoError(error) {
  const mapped = IO_ERROR_MAP[errorCode(error)];
  if (mapped) return mapped;
  if (errorCode(error) === "ENOENT") return { reason: "contextual_enoent", retry: false };
  return { reason: "io_unknown", retry: false };
}

// Descriptor-safe hostile model (revision 4 section 9): proxy values reject
// before any reflection so rejection causes zero proxy traps; accessors are
// rejected without invocation.

const CAPTURE_OPTION_KEYS = Object.freeze([
  "ledgerPath",
  "enabled",
  "baseline",
  "limits",
  "io",
  "sleep",
  "now",
]);

function plainRecordGuard(value) {
  if (value === null || typeof value !== "object") return false;
  if (hostileProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return true;
}

// Snapshot the outer capture options record before any branch selection,
// normalization, function call, or I/O. Accessor descriptors are rejected
// without being invoked.
function snapshotOuterOptions(options) {
  if (!plainRecordGuard(options)) return null;
  const ownKeys = Reflect.ownKeys(options);
  for (const key of ownKeys) {
    if (typeof key !== "string") return null; // symbol keys rejected
  }
  for (const key of ownKeys) {
    if (!CAPTURE_OPTION_KEYS.includes(key)) return null; // extra keys rejected
  }
  const snapshotValues = {};
  for (const key of CAPTURE_OPTION_KEYS) {
    if (!ownKeys.includes(key)) continue;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(options, key);
    } catch {
      return null;
    }
    if (!descriptor) continue;
    if (descriptor.get || descriptor.set) return null; // accessor rejected un-invoked
    snapshotValues[key] = descriptor.value; // one stable data descriptor per present key
  }
  return Object.freeze(snapshotValues);
}

// Recursive closed validation used for the io record: cycles, repeated
// aliases, symbols, accessors, proxies, bigints, and budget failures all
// reject before authority.
function validateIoRecord(value) {
  if (value === null || typeof value !== "object" || hostileProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  let nodeBudget = 96;
  const stack = [value];
  const seen = new Set([value]);
  while (stack.length > 0) {
    const node = stack.pop();
    nodeBudget -= 1;
    if (nodeBudget < 0) return false;
    let keys;
    try {
      keys = Reflect.ownKeys(node);
    } catch {
      return false;
    }
    for (const key of keys) {
      if (typeof key !== "string") return false;
      let child;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor || descriptor.get || descriptor.set) return false;
        child = descriptor.value;
      } catch {
        return false;
      }
      if (child === null) continue;
      const kind = typeof child;
      if (kind === "function") {
        if (hostileProxy(child)) return false;
        continue; // io functions themselves are admitted members
      }
      if (kind === "symbol" || kind === "bigint") return false;
      if (kind !== "object") continue;
      if (hostileProxy(child)) return false;
      if (Buffer.isBuffer(child)) continue;
      if (seen.has(child)) return false; // cycle or repeated alias
      const childPrototype = Object.getPrototypeOf(child);
      if (childPrototype !== Object.prototype && childPrototype !== Array.prototype) return false;
      seen.add(child);
      stack.push(child);
    }
  }
  return true;
}

async function pinnedOpenDirectory(directoryPath) {
  const handle = await fsOpen(
    directoryPath,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat({ bigint: true });
    const expectedUid = typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
    const trustedDirectory = stat.isDirectory()
      && (expectedUid === null || stat.uid === expectedUid)
      && (stat.mode & 0o777n) === 0o700n
      && typeof stat.dev === "bigint" && stat.dev >= 0n
      && typeof stat.ino === "bigint" && stat.ino >= 0n;
    if (!trustedDirectory) {
      void safeClose(handle);
      return { trusted: false };
    }
    return {
      trusted: true,
      handle,
      dev: stat.dev.toString(10),
      ino: stat.ino.toString(10),
      procPrefix: `/proc/self/fd/${handle.fd}/`,
    };
  } catch (error) {
    void safeClose(handle);
    throw error;
  }
}

async function safeClose(handle) {
  if (!handle) return true;
  try {
    await handle.close();
    return true;
  } catch {
    return false;
  }
}

// Non-writing inspection primitive: numeric Linux O_PATH | O_NOFOLLOW through
// the pinned directory namespace. It pins a final symlink's own inode, does
// not activate FIFO/socket/device/directory, and cannot alter metadata.
async function opathInspect(prefix, name) {
  const handle = await fsOpen(`${prefix}${name}`, O_PATH_LINUX_R6 | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({ bigint: true });
    return { handle, stat };
  } catch (error) {
    void safeClose(handle);
    throw error;
  }
}

// TrustedTempIdentityR7 predicate: regular file, effective-UID owner, mode
// 0600, exactly one link, size 0..8193, nonnegative bigint identity.
function trustedTempPredicate(stat) {
  try {
    const expectedUid = typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
    return Boolean(
      stat.isFile()
      && (expectedUid === null || stat.uid === expectedUid)
      && (stat.mode & 0o777n) === 0o600n
      && stat.nlink === 1n
      && stat.size >= 0n
      && stat.size <= 8193n
      && typeof stat.dev === "bigint"
      && stat.dev >= 0n
      && typeof stat.ino === "bigint"
      && stat.ino >= 0n,
    );
  } catch {
    return false;
  }
}

// Capture temp trust (revision 6 section 6): begins with the same non-writing
// O_PATH inspection. Capture never obtains write authority over temp content
// and never reads, parses, deletes, truncates, renames, adopts, chmods, or
// repairs it.
async function inspectCaptureTemp(prefix) {
  let opened;
  try {
    opened = await opathInspect(prefix, TEMP_NAME);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { absent: true };
    return { error };
  }
  const { handle, stat } = opened;
  try {
    if (!trustedTempPredicate(stat)) return { untrusted: true };
    return { present: true, dev: stat.dev, ino: stat.ino, size: stat.size };
  } finally {
    void safeClose(handle); // exactly-once close of the inspection descriptor
  }
}

// Positional bounded read of exactly `size` bytes from an admitted regular
// descriptor; a zero-byte or short read before the admitted count is a torn
// attempt, never EOF success. The single Buffer allocation is bounded by the
// admitted size (ALLOCATION_METRIC: largest single read buffer <= cap).
async function positionalReadExact(handle, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    const bytesRead = Number(result?.bytesRead ?? result ?? 0);
    if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0) break;
    offset += bytesRead;
  }
  return { bytes, byteCount: offset };
}

// Canonical manifest reader validation (revision 4 section 6, revision 5/7
// issue grammar). Parses once, validates the closed object, reconstructs the
// literal run payload, recomputes its ID, rebuilds canonical bytes, and
// requires them to equal the file bytes exactly.
function parseCanonicalManifest(bytes, actualNamespaceId) {
  if (bytes.length < 1 || bytes[bytes.length - 1] !== 0x0a) return "generation_manifest_noncanonical";
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return "generation_manifest_invalid_utf8";
  let parsed;
  try {
    parsed = JSON.parse(text.slice(0, -1));
  } catch {
    return "generation_manifest_invalid_json";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "generation_manifest_schema_invalid";
  }
  const expectedKeys = [
    "schemaVersion",
    "state",
    "generationNonce",
    "runGenerationId",
    "completedAt",
    "namespaceId",
    "ledgerName",
    "ledgerPresent",
    "ledgerByteCount",
    "ledgerByteDigest",
    "lastError",
    "lastIssueCounts",
  ];
  if (JSON.stringify(Object.keys(parsed)) !== JSON.stringify(expectedKeys)) {
    return "generation_manifest_schema_invalid";
  }
  if (parsed.schemaVersion !== GENERATION_MANIFEST_SCHEMA) return "generation_manifest_schema_invalid";
  if (parsed.state !== "complete" && parsed.state !== "failed") return "generation_manifest_schema_invalid";
  if (typeof parsed.generationNonce !== "string" || !NONCE_HEX_32.test(parsed.generationNonce)) {
    return "generation_manifest_schema_invalid";
  }
  if (typeof parsed.runGenerationId !== "string" || !/^setlrun_[0-9a-f]{24}$/u.test(parsed.runGenerationId)) {
    return "generation_manifest_schema_invalid";
  }
  if (typeof parsed.completedAt !== "string" || canonicalIsoTimestampMs(parsed.completedAt) === null) {
    return "generation_manifest_schema_invalid";
  }
  if (typeof parsed.namespaceId !== "string" || !/^setlns_[0-9a-f]{32}$/u.test(parsed.namespaceId)) {
    return "generation_manifest_schema_invalid";
  }
  if (actualNamespaceId !== null && parsed.namespaceId !== actualNamespaceId) {
    return "generation_manifest_namespace_mismatch";
  }
  if (parsed.ledgerName !== LEDGER_NAME) return "generation_manifest_schema_invalid";
  if (parsed.state === "complete" && parsed.ledgerPresent === true) {
    if (!Number.isSafeInteger(parsed.ledgerByteCount) || parsed.ledgerByteCount < 0) {
      return "generation_manifest_schema_invalid";
    }
    if (typeof parsed.ledgerByteDigest !== "string" || !LOWER_HEX_64.test(parsed.ledgerByteDigest)) {
      return "generation_manifest_schema_invalid";
    }
    if (parsed.lastError !== null) return "generation_manifest_schema_invalid";
  } else if (parsed.state === "complete" && parsed.ledgerPresent === false) {
    if (parsed.ledgerByteCount !== null || parsed.ledgerByteDigest !== null) {
      return "generation_manifest_schema_invalid";
    }
    if (parsed.lastError !== null) return "generation_manifest_schema_invalid";
  } else if (parsed.state === "failed") {
    if (parsed.ledgerPresent !== null || parsed.ledgerByteCount !== null
      || parsed.ledgerByteDigest !== null || parsed.lastError !== "reconciliation_failed") {
      return "generation_manifest_schema_invalid";
    }
  } else {
    return "generation_manifest_schema_invalid";
  }
  const pairs = issuePairsFrom(parsed.lastIssueCounts);
  if (!pairs || JSON.stringify(issueCountObject(pairs)) !== JSON.stringify(parsed.lastIssueCounts)) {
    return "generation_manifest_schema_invalid";
  }
  const runPayload = [
    RUN_ID_SCHEMA,
    parsed.state,
    parsed.generationNonce,
    parsed.completedAt,
    parsed.namespaceId,
    LEDGER_NAME,
    parsed.ledgerPresent,
    parsed.ledgerByteCount,
    parsed.ledgerByteDigest,
    parsed.lastError,
    pairs,
  ];
  if (runGenerationIdOf(runPayload) !== parsed.runGenerationId) {
    return "generation_manifest_run_id_mismatch";
  }
  const canonical = `${JSON.stringify(parsed)}\n`;
  if (Buffer.compare(Buffer.from(canonical, "utf8"), bytes) !== 0) {
    return "generation_manifest_noncanonical";
  }
  const namedRunPayload = Object.freeze({
    state: parsed.state,
    nonce: parsed.generationNonce,
    completedAt: parsed.completedAt,
    namespaceId: parsed.namespaceId,
    ledgerPresent: parsed.ledgerPresent,
    ledgerByteCount: parsed.ledgerByteCount,
    ledgerByteDigest: parsed.ledgerByteDigest,
    lastError: parsed.lastError,
    runGenerationId: parsed.runGenerationId,
    runIssuePairs: pairs,
    accepted: false,
  });
  return { manifest: parsed, runPayload: namedRunPayload, runIssuePairs: pairs };
}

function withAccepted(runPayload, overrides = {}) {
  return { ...runPayload, ...overrides };
}

async function openNamedAdmissibleFile({
  prefix,
  name,
  cap,
  actualNamespaceId,
  tooLargeReason,
  notRegularReason,
  wrongModeReason,
  shortReadReason,
  changedReason,
}) {
  // Non-writing O_PATH inspection of the exact fixed name pins the inode
  // without read or write authority; the read descriptor is then reopened
  // only through the kernel-owned /proc/self/fd/<inspectionFd> alias.
  let inspectionHandle = null;
  let inspectionStat = null;
  try {
    const inspected = await opathInspect(prefix, name);
    inspectionHandle = inspected.handle;
    inspectionStat = inspected.stat;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { outcome: "absent" };
    const mapped = mapIoError(error);
    return mapped.retry
      ? { outcome: "retryable", reason: mapped.reason }
      : { outcome: "terminal", reason: mapped.reason === "contextual_enoent" ? "io_unknown" : mapped.reason };
  }
  let inspectionCloseFailed = false;
  let handle;
  try {
    // Read reopen through the kernel-owned descriptor alias; the target is
    // the fd itself, never a second traversal of the untrusted name.
    handle = await fsOpen(
      `/proc/self/fd/${inspectionHandle.fd}`,
      fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
    );
    // Exactly-once close of the non-writing inspection descriptor; its
    // failure replaces an otherwise successful capture.
    try {
      await inspectionHandle.close();
      inspectionHandle = null;
    } catch {
      inspectionCloseFailed = true;
    }
  } catch (error) {
    void safeClose(inspectionHandle);
    const mapped = mapIoError(error);
    return mapped.retry
      ? { outcome: "retryable", reason: mapped.reason }
      : { outcome: "terminal", reason: mapped.reason === "contextual_enoent" ? "io_unknown" : mapped.reason };
  }
  try {
    const reopenStat = await handle.stat({ bigint: true });
    if (reopenStat.dev !== inspectionStat.dev || reopenStat.ino !== inspectionStat.ino) {
      void safeClose(handle);
      void safeClose(inspectionHandle);
      return { outcome: "retryable", reason: changedReason };
    }
  } catch (error) {
    void safeClose(handle);
    void safeClose(inspectionHandle);
    const mapped = mapIoError(error);
    return mapped.retry
      ? { outcome: "retryable", reason: mapped.reason }
      : { outcome: "terminal", reason: mapped.reason };
  }
  void safeClose(inspectionHandle);
  inspectionHandle = null;
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      void safeClose(handle);
      return { outcome: "terminal", reason: notRegularReason };
    }
    if ((before.mode & 0o777n) !== 0o600n) {
      void safeClose(handle);
      return { outcome: "terminal", reason: wrongModeReason };
    }
    if (before.size > BigInt(cap)) {
      void safeClose(handle);
      return { outcome: "terminal", reason: tooLargeReason };
    }
    const exact = await positionalReadExact(handle, Number(before.size));
    if (exact.byteCount !== Number(before.size)) {
      void safeClose(handle);
      return { outcome: "retryable", reason: shortReadReason };
    }
    const after = await handle.stat({ bigint: true });
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size) {
      void safeClose(handle);
      return { outcome: "retryable", reason: changedReason };
    }
    if (inspectionCloseFailed) {
      void safeClose(handle);
      return { outcome: "terminal", reason: "descriptor_close_failed" };
    }
    if (name === MANIFEST_NAME) {
      const validated = parseCanonicalManifest(exact.bytes, actualNamespaceId);
      if (typeof validated === "string") {
        void safeClose(handle);
        return { outcome: "terminal", reason: validated };
      }
      return { outcome: "validated", handle, bytes: exact.bytes, parsed: validated };
    }
    return { outcome: "validated", handle, bytes: exact.bytes };
  } catch (error) {
    void safeClose(handle);
    const mapped = mapIoError(error);
    return mapped.retry
      ? { outcome: "retryable", reason: mapped.reason }
      : { outcome: "terminal", reason: mapped.reason === "contextual_enoent" ? changedReason : mapped.reason };
  }
}

function incrementPair(map, code) {
  map.set(code, (map.get(code) || 0) + 1);
}

// The public capture entry point. Hostile outer options are snapshotted
// before any branch selection, limit normalization, function call, or I/O;
// pre-I/O rejections use attemptsUsed 0 with zero filesystem, sleep, clock,
// parser, and caller-I/O calls.
export async function captureCommerceSettlementPlane(options = {}) {
  const snapshot = snapshotOuterOptions(options);
  const enabledBoolean = snapshot?.enabled === undefined ? true : snapshot.enabled === true;
  const baselineIsoOrNull = snapshot?.baseline === undefined || snapshot.baseline === "" || snapshot.baseline === null
    ? null
    : canonicalBaselineIso(snapshot.baseline);

  const buildResult = ({
    lifecycle,
    reason,
    preIoRejection = false,
    attemptsUsed,
    namespaceIdValue = null,
    ledgerPresent = null,
    ledgerRegularFile = false,
    identity = null,
    byteCount = null,
    byteDigest = null,
    summary = null,
    corruptLines = 0,
    captureIssuePairs = [],
    runPayload = null,
  }) => {
    const acceptedCompletePresent = runPayload !== null
      && runPayload.state === "complete"
      && runPayload.ledgerPresent === true
      && runPayload.accepted === true
      && summary !== null;
    const generationPayload = [
      GENERATION_PAYLOAD_SCHEMA,
      SETTLEMENT_PLANE_CAPTURE_SCHEMA,
      lifecycle,
      enabledBoolean,
      baselineIsoOrNull,
      runPayload ? runPayload.runGenerationId : null,
      runPayload ? runPayload.state : null,
      runPayload ? runPayload.namespaceId : namespaceIdValue,
      runPayload ? runPayload.ledgerPresent : ledgerPresent,
      ledgerRegularFile,
      acceptedCompletePresent ? runPayload.ledgerByteCount : null,
      acceptedCompletePresent ? runPayload.ledgerByteDigest : null,
      acceptedCompletePresent ? summaryDigestOf(summary) : null,
      corruptLines,
      captureIssuePairs,
      reason === null || REASON_AUTHORITY.has(reason) ? reason : null,
    ];
    const generationId = generationIdOf(generationPayload);
    // capturedAt is obtained after all capture facts are final; injected now
    // is called at most once and falls back to system time on throw.
    let capturedAtMs = null;
    let usedSystemClock = false;
    try {
      const nowFn = snapshot?.now;
      if (typeof nowFn === "function") {
        const value = nowFn(); // injected now is called at most once
        if (value instanceof Date && Number.isSafeInteger(value.getTime())) capturedAtMs = value.getTime();
      }
    } catch {
      capturedAtMs = null;
    }
    if (capturedAtMs === null) {
      if (!preIoRejection) usedSystemClock = true; // one system fallback for real capture paths
    }
    const capturedAt = capturedAtMs === null && preIoRejection
      ? null
      : canonicalMillisecondUtc(capturedAtMs ?? Date.now());
    const observationId = observationIdOf([
      OBSERVATION_PAYLOAD_SCHEMA,
      generationId,
      capturedAt,
      attemptsUsed,
    ]);
    return Object.freeze({
      schemaVersion: SETTLEMENT_PLANE_CAPTURE_SCHEMA,
      capturedAt,
      generationId,
      observationId,
      lifecycle,
      enabled: enabledBoolean,
      baseline: baselineIsoOrNull,
      attemptsUsed,
      ledger: Object.freeze({
        present: runPayload ? runPayload.ledgerPresent : ledgerPresent,
        regularFile: ledgerRegularFile,
        identity,
        byteCount: acceptedCompletePresent ? runPayload.ledgerByteCount : byteCount,
        byteDigest: acceptedCompletePresent ? runPayload.ledgerByteDigest : byteDigest,
      }),
      integrity: Object.freeze({
        corruptLines,
        issues: Object.freeze(issueCountObject(captureIssuePairs)),
        reason,
      }),
      summary: summary === null
        ? null
        : Object.freeze({
          ...summary,
          byClass: freezeBuckets(summary.byClass),
          byRoute: freezeBuckets(summary.byRoute),
        }),
      summaryDigest: acceptedCompletePresent ? summaryDigestOf(summary) : null,
      run: runPayload
        ? Object.freeze({
          runGenerationId: runPayload.runGenerationId,
          state: runPayload.state,
          generationNonce: runPayload.nonce,
          completedAt: runPayload.completedAt,
          namespaceId: runPayload.namespaceId,
          lastError: runPayload.lastError,
          lastIssueCounts: Object.freeze(issueCountObject(runPayload.runIssuePairs)),
        })
        : null,
    });
  };

  if (enabledBoolean === false) {
    return buildResult({
      lifecycle: "disabled",
      reason: "disabled",
      attemptsUsed: 0,
    });
  }

  // Classifier order (revision 6 section 7.1 / revision 7 section 7):
  // hostile mechanics, then hostile limits, then path grammar.
  if (!snapshot) {
    return buildResult({ lifecycle: "unstable", reason: "hostile_options", attemptsUsed: 0, preIoRejection: true });
  }
  const limitsInput = snapshot.limits;
  if (limitsInput !== undefined) {
    if (!plainRecordGuard(limitsInput)) {
      return buildResult({ lifecycle: "unstable", reason: "hostile_limits", attemptsUsed: 0, preIoRejection: true });
    }
    const ownLimitKeys = Reflect.ownKeys(limitsInput);
    for (const key of ownLimitKeys) {
      if (typeof key !== "string" || !["maxCutBytes", "attempts", "retryDelayMs"].includes(key)) {
        return buildResult({ lifecycle: "unstable", reason: "hostile_limits", attemptsUsed: 0, preIoRejection: true });
      }
      const descriptor = Object.getOwnPropertyDescriptor(limitsInput, key);
      if (!descriptor || descriptor.get || descriptor.set) {
        return buildResult({ lifecycle: "unstable", reason: "hostile_limits", attemptsUsed: 0, preIoRejection: true });
      }
      if (typeof descriptor.value !== "number" || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) {
        return buildResult({ lifecycle: "unstable", reason: "hostile_limits", attemptsUsed: 0, preIoRejection: true });
      }
    }
    if (ownLimitKeys.includes("maxCutBytes") && limitsInput.maxCutBytes > PRODUCTION_MAX_CUT_BYTES) {
      return buildResult({ lifecycle: "unstable", reason: "hostile_limits", attemptsUsed: 0, preIoRejection: true });
    }
  }
  if (snapshot.enabled !== undefined && typeof snapshot.enabled !== "boolean") {
    return buildResult({ lifecycle: "unstable", reason: "hostile_options", attemptsUsed: 0, preIoRejection: true });
  }
  if (snapshot.baseline !== undefined && snapshot.baseline !== null && typeof snapshot.baseline !== "string") {
    return buildResult({ lifecycle: "unstable", reason: "hostile_options", attemptsUsed: 0, preIoRejection: true });
  }
  for (const callable of ["sleep", "now"]) {
    const value = snapshot[callable];
    if (value === undefined) continue;
    if (hostileProxy(value) || typeof value !== "function") {
      return buildResult({ lifecycle: "unstable", reason: "hostile_options", attemptsUsed: 0, preIoRejection: true });
    }
  }
  if (snapshot.io !== undefined && !validateIoRecord(snapshot.io)) {
    return buildResult({ lifecycle: "unstable", reason: "hostile_options", attemptsUsed: 0, preIoRejection: true });
  }
  const pathReason = classifyLedgerPath(snapshot.ledgerPath);
  if (pathReason) {
    return buildResult({ lifecycle: "unstable", reason: pathReason, attemptsUsed: 0, preIoRejection: true });
  }

  const configuredLedgerPath = snapshot.ledgerPath;
  const dataDir = path.posix.dirname(configuredLedgerPath);

  const bounds = normalizeCutLimits(limitsInput);
  const maxAttempts = bounds.attempts;
  let directoryHandle = null;
  let lastRetryableReason = null;
  let directoryCloseFailed = false;

  async function closePinnedDirectory() {
    if (!directoryHandle) return;
    try {
      await directoryHandle.close();
    } catch {
      directoryCloseFailed = true;
    }
    directoryHandle = null;
  }

  async function captureSleep(delayMs) {
    const sleepFn = snapshot.sleep;
    if (typeof sleepFn === "function") {
      await sleepFn(delayMs);
    } else {
      await defaultSleep(delayMs);
    }
  }

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // Pin the data directory once per attempt (O_DIRECTORY | O_NOFOLLOW).
      let pinnedActual;
      try {
        pinnedActual = await pinnedOpenDirectory(dataDir);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          return buildResult({ lifecycle: "never_run", reason: null, attemptsUsed: 1 });
        }
        const mapped = mapIoError(error);
        if (mapped.retry && attempt < maxAttempts) {
          lastRetryableReason = mapped.reason;
          try {
            await captureSleep(bounds.retryDelayMs);
          } catch {
            return buildResult({
              lifecycle: "unstable",
              reason: "sleep_failed",
              attemptsUsed: attempt,
            });
          }
          continue;
        }
        return buildResult({
          lifecycle: "unstable",
          reason: "data_directory_io_error",
          attemptsUsed: attempt,
        });
      }
      if (!pinnedActual.trusted) {
        return buildResult({
          lifecycle: "unstable",
          reason: "data_directory_untrusted",
          attemptsUsed: attempt,
        });
      }
      directoryHandle = pinnedActual.handle;
      const actualNamespaceId = namespaceIdentity(pinnedActual.dev, pinnedActual.ino);

      const outcome = await runReaderAttempt(pinnedActual, actualNamespaceId, attempt);
      if (outcome.snapshot !== null) {
        await closePinnedDirectory();
        if (directoryCloseFailed && !outcome.snapshot.integrity.reason) {
          return buildResult({
            lifecycle: "unstable",
            reason: "descriptor_close_failed",
            attemptsUsed: attempt,
            namespaceIdValue: actualNamespaceId,
            ledgerPresent: true,
            ledgerRegularFile: true,
          });
        }
        return outcome.snapshot;
      }
      if (outcome.retryable) {
        lastRetryableReason = outcome.reason;
        if (attempt < maxAttempts) {
          try {
            await captureSleep(bounds.retryDelayMs);
          } catch {
            return buildResult({
              lifecycle: "unstable",
              reason: "sleep_failed",
              attemptsUsed: attempt,
              namespaceIdValue: actualNamespaceId,
            });
          }
          continue;
        }
        return buildResult({
          lifecycle: "unstable",
          reason: outcome.reason,
          attemptsUsed: attempt,
          namespaceIdValue: actualNamespaceId,
        });
      }
      return buildResult({
        lifecycle: "unstable",
        reason: outcome.reason,
        attemptsUsed: attempt,
        namespaceIdValue: actualNamespaceId,
      });
    }
    return buildResult({
      lifecycle: "unstable",
      reason: lastRetryableReason || "io_unknown",
      attemptsUsed: maxAttempts,
    });

    // One reader attempt: pinned directory, temp absence, manifest A, ledger
    // when required, manifest B, second temp absence, exact comparisons.
    async function runReaderAttempt(pinnedActual, actualNamespaceId, attempt) {
      const prefix = pinnedActual.procPrefix;

      const tempBefore = await inspectCaptureTemp(prefix);
      if (tempBefore.error) {
        const mapped = mapIoError(tempBefore.error);
        if (mapped.retry) return { snapshot: null, retryable: true, reason: mapped.reason };
        return { snapshot: null, retryable: false, reason: "data_directory_io_error" };
      }
      if (tempBefore.untrusted) return { snapshot: null, retryable: false, reason: "publication_temp_untrusted" };
      if (tempBefore.present) return { snapshot: null, retryable: false, reason: "publication_in_progress_or_orphan" };

      const manifestA = await openAndValidateManifest(prefix, actualNamespaceId);
      if (manifestA.outcome === "absent") {
        const ledgerProbe = await probeLedgerPresence(prefix);
        if (ledgerProbe.absent) {
          return { snapshot: buildResult({
            lifecycle: "never_run",
            reason: null,
            attemptsUsed: attempt,
            namespaceIdValue: actualNamespaceId,
            ledgerPresent: false,
            ledgerRegularFile: false,
          }) };
        }
        if (ledgerProbe.error) {
          const mapped = mapIoError(ledgerProbe.error);
          if (mapped.retry) return { snapshot: null, retryable: true, reason: mapped.reason };
          return { snapshot: null, retryable: false, reason: "generation_manifest_missing" };
        }
        return { snapshot: null, retryable: true, reason: "generation_manifest_missing" };
      }
      if (manifestA.outcome === "retryable") {
        void safeClose(manifestA.handle);
        return { snapshot: null, retryable: true, reason: manifestA.reason };
      }
      if (manifestA.outcome === "terminal") {
        void safeClose(manifestA.handle);
        return { snapshot: null, retryable: false, reason: manifestA.reason };
      }
      const manifest = manifestA.parsed;

      if (manifest.manifest.state === "failed") {
        const manifestB = await openAndValidateManifest(prefix, actualNamespaceId);
        const identical = manifestB.outcome === "validated"
          && Buffer.compare(manifestB.bytes, manifestA.bytes) === 0;
        const bRetryable = manifestB.outcome === "retryable" || manifestB.outcome === "absent";
        void safeClose(manifestB.handle);
        if (identical) {
          void safeClose(manifestA.handle);
          const secondTempCheck = await inspectCaptureTemp(prefix);
          if (secondTempCheck.present || secondTempCheck.untrusted) {
            return { snapshot: buildResult({
              lifecycle: "unstable",
              reason: secondTempCheck.untrusted ? "publication_temp_untrusted" : "publication_in_progress_or_orphan",
              attemptsUsed: attempt,
              namespaceIdValue: actualNamespaceId,
              ledgerRegularFile: false,
              runPayload: withAccepted(manifest.runPayload),
            }) };
          }
          return { snapshot: buildResult({
            lifecycle: "unstable",
            reason: "reconciliation_failed",
            attemptsUsed: attempt,
            namespaceIdValue: actualNamespaceId,
            ledgerRegularFile: false,
            runPayload: withAccepted(manifest.runPayload),
          }) };
        }
        void safeClose(manifestA.handle);
        if (bRetryable) return { snapshot: null, retryable: true, reason: "generation_manifest_changed" };
        if (manifestB.outcome === "terminal") {
          return { snapshot: null, retryable: false, reason: manifestB.reason };
        }
        return { snapshot: null, retryable: true, reason: "generation_manifest_changed" };
      }

      if (manifest.manifest.ledgerPresent === false) {
        const ledgerProbe = await probeLedgerPresence(prefix);
        const secondTempAfterB = await inspectCaptureTemp(prefix);
        void safeClose(manifestA.handle);
        if (secondTempAfterB.present || secondTempAfterB.untrusted) {
          return { snapshot: buildResult({
            lifecycle: "unstable",
            reason: secondTempAfterB.untrusted ? "publication_temp_untrusted" : "publication_in_progress_or_orphan",
            attemptsUsed: attempt,
            namespaceIdValue: actualNamespaceId,
            ledgerPresent: false,
            ledgerRegularFile: false,
            runPayload: withAccepted(manifest.runPayload),
          }) };
        }
        if (ledgerProbe.absent) {
          return { snapshot: buildResult({
            lifecycle: "restart_pending",
            reason: "ledger_absent_after_complete_run",
            attemptsUsed: attempt,
            namespaceIdValue: actualNamespaceId,
            ledgerPresent: false,
            ledgerRegularFile: false,
            runPayload: withAccepted(manifest.runPayload),
          }) };
        }
        if (ledgerProbe.error) {
          const mapped = mapIoError(ledgerProbe.error);
          if (mapped.retry) return { snapshot: null, retryable: true, reason: mapped.reason };
          return { snapshot: null, retryable: false, reason: "ledger_generation_mismatch" };
        }
        return { snapshot: null, retryable: true, reason: "ledger_generation_mismatch" };
      }

      // Complete-present: open the ledger no-follow nonblocking, fstat before
      // allocation, require regular 0600, positionally read the admitted
      // count under the cap, fstat again.
      const ledger = await openAdmittedLedger(prefix, manifest.manifest);
      if (ledger.outcome === "retryable") {
        void safeClose(ledger.handle);
        void safeClose(manifestA.handle);
        return { snapshot: null, retryable: true, reason: ledger.reason };
      }
      if (ledger.outcome === "terminal") {
        void safeClose(ledger.handle);
        void safeClose(manifestA.handle);
        return { snapshot: null, retryable: false, reason: ledger.reason };
      }

      const manifestB = await openAndValidateManifest(prefix, actualNamespaceId);

      // Descriptor-close failures replace an otherwise successful capture.
      let closeFailed = false;
      if (!(await safeClose(ledger.handle))) closeFailed = true;
      if (!(await safeClose(manifestA.handle))) closeFailed = true;
      if (manifestB.handle && !(await safeClose(manifestB.handle))) closeFailed = true;

      if (closeFailed) {
        return { snapshot: buildResult({
          lifecycle: "unstable",
          reason: "descriptor_close_failed",
          attemptsUsed: attempt,
          namespaceIdValue: actualNamespaceId,
          ledgerPresent: true,
          ledgerRegularFile: true,
          identity: ledger.identity,
        }) };
      }

      const byteIdenticalB = manifestB.outcome === "validated"
        && Buffer.compare(manifestB.bytes, manifestA.bytes) === 0;
      if (manifestB.outcome === "terminal") {
        return { snapshot: null, retryable: false, reason: manifestB.reason };
      }
      if (!byteIdenticalB) {
        return { snapshot: null, retryable: true, reason: "generation_manifest_changed" };
      }
      const secondTemp = await inspectCaptureTemp(prefix);
      if (secondTemp.present || secondTemp.untrusted) {
        return { snapshot: buildResult({
          lifecycle: "unstable",
          reason: secondTemp.untrusted ? "publication_temp_untrusted" : "publication_in_progress_or_orphan",
          attemptsUsed: attempt,
          namespaceIdValue: actualNamespaceId,
          ledgerPresent: true,
          ledgerRegularFile: true,
          identity: ledger.identity,
          runPayload: withAccepted(manifest.runPayload),
        }) };
      }

      // Accepted capture: money parity comes from the unchanged parent
      // summarizer on the exact captured bytes; additive issue analysis never
      // contributes money (OPERATIONAL_SPLIT, one parser per physical line).
      const text = ledger.bytes.toString("utf8");
      const summary = summarizeCommerceSettlementLedger(text);
      let corruptLines = Number.isSafeInteger(summary.invalidLines) ? summary.invalidLines : 0;
      const captureIssuesMap = new Map();
      const seenReferences = new Set();
      for (const line of text.split("\n")) {
        if (line.length === 0) continue;
        let parsedLine;
        try {
          parsedLine = JSON.parse(line); // exactly one parse per physical line
        } catch {
          continue;
        }
        const classification = classifyLedgerRecord(parsedLine);
        if (classification === "revenue") {
          const reference = String(own(parsedLine, "settlementReference") || "").toLowerCase();
          if (seenReferences.has(reference)) {
            incrementPair(captureIssuesMap, "duplicate_ledger_reference");
            continue;
          }
          if (reference) seenReferences.add(reference);
          continue;
        }
        if (classification === "corrupt_line") {
          corruptLines += 1;
          continue;
        }
        incrementPair(captureIssuesMap, classification);
      }
      const captureIssuePairs = [...captureIssuesMap.entries()].sort();
      return { snapshot: buildResult({
        lifecycle: corruptLines > 0 ? "corrupt" : "ok",
        reason: null,
        attemptsUsed: attempt,
        namespaceIdValue: actualNamespaceId,
        ledgerPresent: true,
        ledgerRegularFile: true,
        identity: ledger.identity,
        byteCount: ledger.bytes.length,
        byteDigest: sha256Bytes(ledger.bytes),
        summary,
        corruptLines,
        captureIssuePairs,
        runPayload: withAccepted(manifest.runPayload, {
          accepted: true,
          ledgerByteCount: ledger.bytes.length,
          ledgerByteDigest: sha256Bytes(ledger.bytes),
        }),
      }) };
    }

    async function openAndValidateManifest(prefix, actualNamespaceId) {
      return openNamedAdmissibleFile({
        prefix,
        name: MANIFEST_NAME,
        cap: MAX_MANIFEST_BYTES,
        actualNamespaceId,
        tooLargeReason: "generation_manifest_too_large",
        notRegularReason: "generation_manifest_not_regular_file",
        wrongModeReason: "generation_manifest_wrong_mode",
        shortReadReason: "generation_manifest_short_read",
        changedReason: "generation_manifest_changed",
      });
    }

    async function probeLedgerPresence(prefix) {
      let opened;
      try {
        opened = await opathInspect(prefix, LEDGER_NAME);
      } catch (error) {
        if (errorCode(error) === "ENOENT") return { absent: true };
        return { error };
      }
      void safeClose(opened.handle);
      return { present: true };
    }
  } catch (error) {
    // An unexpected capture fault withholds privately; public callers see a
    // frozen unstable snapshot, never a thrown money-path failure.
    await closePinnedDirectory();
    const reason = errorCode(error) === "ENOENT" ? "generation_manifest_missing" : "io_unknown";
    return buildResult({
      lifecycle: "unstable",
      reason,
      attemptsUsed: 1,
    });
  } finally {
    await closePinnedDirectory();
  }

  async function openAdmittedLedger(prefix, manifestFields) {
    let inspectionHandle = null;
    let inspectionStat = null;
    try {
      const inspected = await opathInspect(prefix, LEDGER_NAME);
      inspectionHandle = inspected.handle;
      inspectionStat = inspected.stat;
    } catch (error) {
      const mapped = mapIoError(error);
      if (errorCode(error) === "ENOENT") return { outcome: "retryable", reason: "ledger_disappeared" };
      return mapped.retry
        ? { outcome: "retryable", reason: mapped.reason }
        : { outcome: "terminal", reason: mapped.reason === "contextual_enoent" ? "ledger_disappeared" : mapped.reason };
    }
    if (!inspectionStat.isFile() || (inspectionStat.mode & 0o777n) !== 0o600n) {
      void safeClose(inspectionHandle);
      return {
        outcome: "terminal",
        reason: !inspectionStat.isFile() ? "ledger_not_regular_file" : "ledger_wrong_mode",
      };
    }
    if (inspectionStat.size > BigInt(PRODUCTION_MAX_CUT_BYTES)) {
      void safeClose(inspectionHandle);
      return { outcome: "terminal", reason: "ledger_too_large" };
    }
    if (inspectionStat.size !== BigInt(manifestFields.ledgerByteCount)) {
      void safeClose(inspectionHandle);
      return { outcome: "retryable", reason: "ledger_generation_mismatch" };
    }
    let handle;
    try {
      handle = await fsOpen(
        `/proc/self/fd/${inspectionHandle.fd}`,
        fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
      );
    } catch (error) {
      void safeClose(inspectionHandle);
      const mapped = mapIoError(error);
      if (errorCode(error) === "ENOENT") return { outcome: "retryable", reason: "ledger_disappeared" };
      return mapped.retry
        ? { outcome: "retryable", reason: mapped.reason }
        : { outcome: "terminal", reason: mapped.reason === "contextual_enoent" ? "ledger_disappeared" : mapped.reason };
    }
    let inspectionCloseFailed = false;
    try {
      await inspectionHandle.close();
      inspectionHandle = null;
    } catch {
      inspectionCloseFailed = true;
    }
    try {
      const reopenStat = await handle.stat({ bigint: true });
      if (reopenStat.dev !== inspectionStat.dev || reopenStat.ino !== inspectionStat.ino
        || (reopenStat.mode & 0o777n) !== 0o600n || reopenStat.size !== inspectionStat.size) {
        void safeClose(handle);
        void safeClose(inspectionHandle);
        return { outcome: "retryable", reason: "ledger_identity_changed" };
      }
    } catch (error) {
      void safeClose(handle);
      void safeClose(inspectionHandle);
      const mapped = mapIoError(error);
      return mapped.retry
        ? { outcome: "retryable", reason: mapped.reason }
        : { outcome: "terminal", reason: mapped.reason };
    }
    if (inspectionCloseFailed) {
      void safeClose(handle);
      return { outcome: "terminal", reason: "descriptor_close_failed" };
    }
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()) {
        void safeClose(handle);
        return { outcome: "terminal", reason: "ledger_not_regular_file" };
      }
      if ((before.mode & 0o777n) !== 0o600n) {
        void safeClose(handle);
        return { outcome: "terminal", reason: "ledger_wrong_mode" };
      }
      if (before.size > BigInt(PRODUCTION_MAX_CUT_BYTES)) {
        void safeClose(handle);
        return { outcome: "terminal", reason: "ledger_too_large" };
      }
      if (before.size !== BigInt(manifestFields.ledgerByteCount)) {
        return { outcome: "retryable", reason: "ledger_generation_mismatch", handle };
      }
      const exact = await positionalReadExact(handle, Number(before.size));
      if (exact.byteCount !== Number(before.size)) {
        return { outcome: "retryable", reason: "ledger_short_read", handle };
      }
      const after = await handle.stat({ bigint: true });
      if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino
        || after.size !== before.size || (after.mode & 0o777n) !== 0o600n) {
        return { outcome: "retryable", reason: "ledger_identity_changed", handle };
      }
      if (sha256Bytes(exact.bytes) !== manifestFields.ledgerByteDigest) {
        return { outcome: "retryable", reason: "ledger_generation_mismatch", handle };
      }
      return {
        outcome: "accepted",
        handle,
        bytes: exact.bytes,
        identity: Object.freeze({
          dev: before.dev.toString(10),
          ino: before.ino.toString(10),
          mode: "0600",
        }),
      };
    } catch (error) {
      void safeClose(handle);
      const mapped = mapIoError(error);
      return mapped.retry
        ? { outcome: "retryable", reason: mapped.reason }
        : { outcome: "terminal", reason: mapped.reason === "contextual_enoent" ? "ledger_disappeared" : mapped.reason };
    }
  }
}

// ---------------------------------------------------------------------------
// Writer publication lease (revisions 5-7). One fixed exclusive temp bounds
// crash accumulation to one orphan inode; conforming contenders poison it at
// offset 8192 through the procfd-bound inspected inode before their parent
// ledger mutation; no writer ever deletes, truncates, adopts, or replaces
// temp content (FIXED_TEMP, WRITER_CONTENTION, PINNED_TEMP_IDENTITY).
// ---------------------------------------------------------------------------

async function acquirePublicationLease(dataDir, pinned) {
  const tempPath = `${pinned.procPrefix}${TEMP_NAME}`;
  const inspectPrefix = pinned.procPrefix;
  for (let transition = 1; transition <= MAX_LEASE_TRANSITIONS; transition += 1) {
    let ownerHandle = null;
    try {
      ownerHandle = await fsOpen(
        tempPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW | fsConstants.O_RDWR,
        0o600,
      );
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return { outcome: "no_publication_authority" };
    }
    if (ownerHandle) {
      try {
        const stat = await ownerHandle.stat({ bigint: true });
        if (!trustedTempPredicate(stat) || stat.size !== 0n) {
          void safeClose(ownerHandle);
          return { outcome: "no_publication_authority" };
        }
        return {
          outcome: "owner",
          handle: ownerHandle,
          dev: stat.dev,
          ino: stat.ino,
        };
      } catch {
        void safeClose(ownerHandle);
        return { outcome: "no_publication_authority" };
      }
    }
    // Contender: non-writing O_PATH inspection first; no write-capable open
    // precedes successful trust (PINNED_TEMP_IDENTITY).
    let inspection = null;
    let writeHandle = null;
    let pathCheckHandle = null;
    try {
      inspection = await opathInspect(inspectPrefix, TEMP_NAME);
      const inspectionDev = inspection.stat.dev;
      const inspectionIno = inspection.stat.ino;
      if (!trustedTempPredicate(inspection.stat)) return finishUntrusted();

      writeHandle = await fsOpen(
        `/proc/self/fd/${inspection.handle.fd}`,
        fsConstants.O_WRONLY | fsConstants.O_NONBLOCK,
      );
      const writeStat = await writeHandle.stat({ bigint: true });
      if (!trustedTempPredicate(writeStat) || writeStat.dev !== inspectionDev
        || writeStat.ino !== inspectionIno) {
        return finishUntrusted();
      }

      const fresh = await opathInspect(inspectPrefix, TEMP_NAME);
      pathCheckHandle = fresh.handle;
      const freshTrusted = trustedTempPredicate(fresh.stat)
        && fresh.stat.dev === inspectionDev
        && fresh.stat.ino === inspectionIno;
      if (!freshTrusted) {
        const independentlyTrusted = trustedTempPredicate(fresh.stat);
        void safeClose(pathCheckHandle);
        pathCheckHandle = null;
        if (independentlyTrusted) continue; // trusted different inode: LEASE_TRANSITION
        return finishUntrusted(); // untrusted different inode: terminal
      }
      void safeClose(pathCheckHandle);
      pathCheckHandle = null;

      // Exactly one poison byte at zero-based offset 8192 through the bound
      // write descriptor, then fsync and full identity postchecks.
      const poison = Buffer.from([CONTENDER_POISON_BYTE]);
      const written = await writeHandle.write(poison, 0, 1, CONTENDER_POISON_OFFSET);
      if (Number(written?.bytesWritten ?? written) !== 1) return finishUntrustedAfterPoison();
      await writeHandle.sync();
      const postStat = await writeHandle.stat({ bigint: true });
      if (!trustedTempPredicate(postStat) || postStat.dev !== inspectionDev
        || postStat.ino !== inspectionIno || postStat.size !== 8193n) {
        return finishUntrustedAfterPoison();
      }
      const postPath = await opathInspect(inspectPrefix, TEMP_NAME);
      const postTrusted = trustedTempPredicate(postPath.stat)
        && postPath.stat.dev === inspectionDev
        && postPath.stat.ino === inspectionIno
        && postPath.stat.size === 8193n;
      void safeClose(postPath.handle);
      if (!postTrusted) return finishUntrustedAfterPoison();
      void safeClose(writeHandle);
      writeHandle = null;
      void safeClose(inspection.handle);
      inspection = null;
      return { outcome: "contender_poisoned" };
    } catch {
      void safeClose(writeHandle);
      void safeClose(pathCheckHandle);
      void safeClose(inspection === null ? null : inspection.handle);
      return { outcome: "temp_untrusted" };
    }

    function finishUntrusted() {
      void safeClose(writeHandle);
      void safeClose(pathCheckHandle);
      void safeClose(inspection === null ? null : inspection.handle);
      return { outcome: "temp_untrusted" };
    }

    function finishUntrustedAfterPoison() {
      void safeClose(writeHandle);
      void safeClose(pathCheckHandle);
      void safeClose(inspection === null ? null : inspection.handle);
      return { outcome: "temp_untrusted_after_poison" };
    }
  }
  return { outcome: "no_publication_authority" };
}

// Owner checkpoint helper: retained-descriptor plus fresh fixed-name O_PATH
// observations must agree on recorded dev/ino, the complete trusted
// predicate, and the expected size before any further action.
async function ownerCheckpoint(procPrefix, ownerHandle, expectedSize, dev, ino) {
  const retainedStat = await ownerHandle.stat({ bigint: true });
  if (!trustedTempPredicate(retainedStat) || retainedStat.dev !== dev
    || retainedStat.ino !== ino || retainedStat.size !== expectedSize) {
    return false;
  }
  let check;
  try {
    check = await opathInspect(procPrefix, TEMP_NAME);
  } catch {
    return false;
  }
  const ok = trustedTempPredicate(check.stat)
    && check.stat.dev === dev
    && check.stat.ino === ino
    && check.stat.size === expectedSize;
  void safeClose(check.handle);
  return ok;
}

async function completeWrite(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await handle.write(bytes, offset, bytes.length - offset, offset);
    const bytesWritten = Number(written?.bytesWritten ?? written);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) return false;
    offset += bytesWritten;
  }
  return true;
}

// Build the canonical complete manifest for a successfully published ledger
// generation (revision 4 section 6, revision 5 section 6 issue grammar).
function buildCanonicalManifest({
  state,
  namespaceIdValue,
  ledgerPresent,
  ledgerByteCount,
  ledgerByteDigest,
  lastError,
  completedAt,
  runIssuePairs,
}) {
  const generationNonce = randomBytes(16).toString("hex");
  const runPayload = [
    RUN_ID_SCHEMA,
    state,
    generationNonce,
    completedAt,
    namespaceIdValue,
    LEDGER_NAME,
    ledgerPresent,
    ledgerByteCount,
    ledgerByteDigest,
    lastError,
    runIssuePairs,
  ];
  const manifest = {
    schemaVersion: GENERATION_MANIFEST_SCHEMA,
    state,
    generationNonce,
    runGenerationId: runGenerationIdOf(runPayload),
    completedAt,
    namespaceId: namespaceIdValue,
    ledgerName: LEDGER_NAME,
    ledgerPresent,
    ledgerByteCount,
    ledgerByteDigest,
    lastError,
    lastIssueCounts: issueCountObject(runIssuePairs),
  };
  return {
    manifest,
    bytes: Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8"),
    runPayload,
  };
}

// Owner publication transaction (revision 7 section 5): prewrite checkpoint,
// positional complete write from offset zero, fsync, prerename checkpoint,
// pathname rename, postrename retained-descriptor plus fixed-manifest
// identity checks, directory fsync, exactly-once close, and only then the
// private cache update. Any observed pre-rename mismatch never renames; any
// rename fault or postrename mismatch performs no further write, no second
// rename, no rollback, no deletion, no repair, and no cache update.
async function publishGenerationManifest({
  procPrefix,
  lease,
  manifestBytes,
}) {
  const ownerHandle = lease.handle;
  try {
    // Prewrite checkpoint: retained descriptor plus fresh fixed-name O_PATH,
    // both at exact size zero.
    if (!(await ownerCheckpoint(procPrefix, ownerHandle, 0n, lease.dev, lease.ino))) {
      return { published: false, reason: "publication_temp_untrusted" };
    }
    if (!(await completeWrite(ownerHandle, manifestBytes))) {
      return { published: false, reason: "io_unknown" };
    }
    await ownerHandle.sync();
    const writtenStat = await ownerHandle.stat({ bigint: true });
    if (!trustedTempPredicate(writtenStat) || writtenStat.size !== BigInt(manifestBytes.length)) {
      return { published: false, reason: "publication_temp_untrusted" };
    }
    // Prerename checkpoint: retained descriptor plus fresh fixed-name O_PATH
    // at exact manifest size with no 8193-byte poison.
    if (!(await ownerCheckpoint(procPrefix, ownerHandle, BigInt(manifestBytes.length), lease.dev, lease.ino))) {
      return { published: false, reason: "publication_temp_untrusted" };
    }
    await fsOpenRename(procPrefix, TEMP_NAME, MANIFEST_NAME);
  } catch {
    return { published: false, reason: "io_unknown" };
  }
  // Postrename identity: retained owner descriptor then fixed manifest name.
  try {
    const retainedStat = await ownerHandle.stat({ bigint: true });
    if (!trustedTempPredicate(retainedStat) || retainedStat.dev !== lease.dev
      || retainedStat.ino !== lease.ino || retainedStat.size !== BigInt(manifestBytes.length)) {
      return { published: false, reason: "publication_temp_untrusted" };
    }
    const manifestCheck = await opathInspect(procPrefix, MANIFEST_NAME);
    const manifestTrusted = trustedTempPredicate(manifestCheck.stat)
      && manifestCheck.stat.dev === lease.dev
      && manifestCheck.stat.ino === lease.ino
      && manifestCheck.stat.size === BigInt(manifestBytes.length);
    void safeClose(manifestCheck.handle);
    if (!manifestTrusted) {
      return { published: false, reason: "publication_temp_untrusted" };
    }

  } catch {
    return { published: false, reason: "publication_temp_untrusted" };
  }
  return { published: true, reason: null };
}

async function fsOpenRename(procPrefix, fromName, toName) {
  // rename is issued through the pinned procfd namespace so the operation
  // cannot escape the pinned directory after an ancestor swap.
  const { rename } = await import("node:fs/promises");
  await rename(`${procPrefix}${fromName}`, `${procPrefix}${toName}`);
}

// Best-effort T4a publication after the parent operational transition. Its
// success or failure can never alter public output, lastRun, lastScan, ledger
// records, deduplication, or scheduling (OPERATIONAL_SPLIT).
// `ownedLease` is the exact owner lease acquired before parent operation; a
// null ownedLease means this writer never had publication authority and must
// not touch the fixed temp at all (no second lease, no poison of our own).
let publicationPinned = null;
let publicationLease = null;

async function publishSettlementGeneration() {
  try {
    if (!publicationPinned || !publicationLease) return { published: false };
    return await runPublication({});
  } catch {
    return { published: false };
  }
}

async function runPublication({ hadNewRecords, runFailed }) {
  const pinned = publicationPinned;
  const lease = publicationLease;
  try {
    const namespaceIdValue = namespaceIdentity(pinned.dev, pinned.ino);

    // Record the pre-run base: exact manifest bytes or literal absence.
    let baseManifestBytes = null;
    try {
      baseManifestBytes = await readFile(`${pinned.procPrefix}${MANIFEST_NAME}`);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") return { published: false };
      baseManifestBytes = null;
    }

    let ledgerBytes = Buffer.alloc(0);
    let ledgerPresent = false;
    try {
      ledgerBytes = await readFile(`${pinned.procPrefix}${LEDGER_NAME}`);
      ledgerPresent = true;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") return { published: false };
    }

    if (runFailed) {
      if (!lease) return { published: false };
      const built = buildCanonicalManifest({
        state: "failed",
        namespaceIdValue,
        ledgerPresent: null,
        ledgerByteCount: null,
        ledgerByteDigest: null,
        lastError: "reconciliation_failed",
        completedAt: canonicalMillisecondUtc(Date.now()),
        runIssuePairs: [],
      });
      const outcome = await publishGenerationManifest({ procPrefix: pinned.procPrefix, lease, manifestBytes: built.bytes });
      void safeClose(lease.handle);
      return { published: outcome.published };
    }

    // Fsync the ledger when present, then descriptor-read its exact stable
    // final bytes and require the expected count/digest.
    if (ledgerPresent) {
      const ledgerHandle = await fsOpen(
        `${pinned.procPrefix}${LEDGER_NAME}`,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      try {
        await ledgerHandle.sync();
        const stat = await ledgerHandle.stat({ bigint: true });
        if (!stat.isFile() || (stat.mode & 0o777n) !== 0o600n
          || stat.size !== BigInt(ledgerBytes.length)) {
          return { published: false };
        }
        const exact = await positionalReadExact(ledgerHandle, Number(stat.size));
        if (exact.byteCount !== ledgerBytes.length) return { published: false };
        ledgerBytes = exact.bytes;
      } finally {
        void safeClose(ledgerHandle);
      }
    } else if (hadNewRecords) {
      return { published: false };
    }

    // Require the current fixed manifest to equal the recorded pre-run base,
    // including absent-versus-present state.
    let currentManifestBytes = null;
    try {
      currentManifestBytes = await readFile(`${pinned.procPrefix}${MANIFEST_NAME}`);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") return { published: false };
    }
    const baseUnchanged = baseManifestBytes === null
      ? currentManifestBytes === null
      : (currentManifestBytes !== null && Buffer.compare(baseManifestBytes, currentManifestBytes) === 0);
    if (!baseUnchanged) return { published: false };

    // Require the owner temp to retain its exact dev/ino/mode and size zero.
    if (!(await ownerCheckpoint(pinned.procPrefix, lease.handle, 0n, lease.dev, lease.ino))) {
      return { published: false };
    }

    const built = buildCanonicalManifest({
      state: "complete",
      namespaceIdValue,
      ledgerPresent,
      ledgerByteCount: ledgerPresent ? ledgerBytes.length : null,
      ledgerByteDigest: ledgerPresent ? sha256Bytes(ledgerBytes) : null,
      lastError: null,
      completedAt: canonicalMillisecondUtc(Date.now()),
      runIssuePairs: [],
    });
    if (built.bytes.length > MAX_MANIFEST_BYTES) return { published: false };
    const outcome = await publishGenerationManifest({ procPrefix: pinned.procPrefix, lease, manifestBytes: built.bytes });
    if (!outcome.published) return { published: false };
    await pinned.handle.sync(); // directory fsync on the exact pinned descriptor
    void safeClose(lease.handle); // exactly-once owner descriptor close ends the transaction
    return { published: true, manifest: built.manifest };
  } catch {
    return { published: false };
  }
}

// ---------------------------------------------------------------------------
// Public operating-state factory. The original parent parser, accumulator,
// status fields, transitions, and values are unchanged (money authority);
// T4a preparation and publication add only latency and never change public
// output, ledger admission, deduplication, scheduling, or failure
// classification (OPERATIONAL_SPLIT, PINNED_PARENT_APPEND).
// ---------------------------------------------------------------------------

export function createCommerceSettlementReconciler({
  actorSecret = process.env.COMMERCE_ACTOR_SECRET || "",
  asset = BASE_USDC,
  client,
  dataDir = process.env.COMMERCE_DATA_DIR || path.join(process.cwd(), "data"),
  eventPaths,
  network = process.env.NETWORK || "eip155:8453",
  payerClasses = process.env.COMMERCE_PAYER_CLASSES || "",
  rpcUrls = (process.env.MORPHO_BASE_RPC_URLS || "https://mainnet.base.org,https://base-rpc.publicnode.com").split(",").map((url) => url.trim()).filter(Boolean),
  settlementEvidenceSince = process.env.COMMERCE_SETTLEMENT_EVIDENCE_SINCE || "",
  treasury = process.env.PAY_TO || "",
} = {}) {
  // An internally derived reconciler path is held to the same frozen grammar;
  // an invalid configured data dir withholds T4a authority as
  // ledger_path_invalid while the unchanged parent operational path continues.
  const ledgerPath = path.join(dataDir, LEDGER_NAME);
  const t4aLedgerPathValid = validateLedgerPathGrammar(ledgerPath);
  const paths = eventPaths || [
    path.join(dataDir, "commerce-events.1.ndjson"),
    path.join(dataDir, "commerce-events.ndjson"),
  ];
  const enabled = Boolean(
    actorSecret.length >= 16
    && Number.isFinite(Date.parse(settlementEvidenceSince))
    && /^0x[0-9a-fA-F]{40}$/.test(treasury)
    && network === "eip155:8453"
  );
  const publicClient = client || createPublicClient({
    chain: base,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 10_000 }))),
  });
  // In-memory run state is one frozen generation object, replaced wholesale
  // after each reconcile so a capture can bind to it atomically by reference.
  const instanceEntropy = randomBytes(16).toString("hex");
  let lastRun = null;
  let runSequence = 0;
  let reconcileInFlight = 0;
  let lastScan = {
    eligibleSettlementReferences: 0,
    alreadyReconciled: 0,
    reconciledThisRun: 0,
    issueCount: 0,
  };
  let running = Promise.resolve();
  let publishedGeneration = null;

  function capturePlane(options = {}) {
    return captureCommerceSettlementPlane({
      ledgerPath,
      enabled,
      baseline: settlementEvidenceSince,
      limits: options.limits,
      io: options.io,
      sleep: options.sleep,
      now: options.now,
    });
  }

  async function status({ pinnedPrefix = null } = {}) {
    const [ledger, eventParts] = await Promise.all([
      pinnedPrefix ? readExisting(`${pinnedPrefix}${LEDGER_NAME}`) : readExisting(ledgerPath),
      Promise.all(paths.map(readExisting)),
    ]);
    const paymentClassBySourceEventId = enabled
      ? currentPaymentClassBySourceEventId(eventParts.join("\n"), {
        actorSecret,
        payerClasses,
        settlementEvidenceSince,
      })
      : new Map();
    const run = lastRun || { lastRunAt: null, lastError: null, lastIssueCounts: {} };
    return {
      enabled,
      settlementEvidenceSince: Number.isFinite(Date.parse(settlementEvidenceSince))
        ? new Date(settlementEvidenceSince).toISOString()
        : null,
      lastRunAt: run.lastRunAt,
      lastError: run.lastError,
      issues: run.lastIssueCounts,
      lastScan,
      ledger: summarizeCommerceSettlementLedger(ledger, { paymentClassBySourceEventId }),
    };
  }

  async function reconcile() {
    if (!enabled) return status();
    let pinnedParent = null;
    let leaseForRun = null;
    reconcileInFlight += 1;
    running = running.then(async () => {
      try {
        // Establish the trusted pinned namespace before any parent ledger
        // append; every ledger operation below uses the pinned alias so the
        // write cannot be moved to another namespace by an ancestor swap
        // after the pin (PINNED_PARENT_APPEND).
        pinnedParent = null;
        try {
          pinnedParent = await pinnedOpenDirectory(dataDir);
          if (!pinnedParent.trusted) pinnedParent = null;
        } catch {
          pinnedParent = null;
        }

        // Pre-run publication lease and base recording for existing trusted
        // directories (WRITER_CONTENTION).
        if (pinnedParent && t4aLedgerPathValid) {
          const leaseOutcome = await acquirePublicationLease(dataDir, pinnedParent);
          if (leaseOutcome.outcome === "owner") leaseForRun = leaseOutcome;
        }

        // Record the pre-run base manifest state and expected final ledger
        // digest before any mutation.
        let baseManifestBytes = null;
        let preRunLedgerBytes = Buffer.alloc(0);
        let preRunLedgerPresent = false;
        if (pinnedParent) {
          try {
            baseManifestBytes = await readFile(`${pinnedParent.procPrefix}${MANIFEST_NAME}`);
          } catch (error) {
            if (errorCode(error) !== "ENOENT") baseManifestBytes = undefined;
          }
          try {
            preRunLedgerBytes = await readFile(`${pinnedParent.procPrefix}${LEDGER_NAME}`);
            preRunLedgerPresent = true;
          } catch (error) {
            if (errorCode(error) !== "ENOENT") {
              preRunLedgerBytes = undefined;
            }
          }
        }

        const [eventParts, ledger] = await Promise.all([
          Promise.all(paths.map(readExisting)),
          pinnedParent
            ? readExisting(`${pinnedParent.procPrefix}${LEDGER_NAME}`)
            : readExisting(ledgerPath),
        ]);
        const result = await reconcileCommerceSettlementEvents(eventParts.join("\n"), ledger, {
          actorSecret,
          asset,
          client: publicClient,
          network,
          payerClasses,
          settlementEvidenceSince,
          treasury,
        });
        if (result.newRecords.length) {
          await mkdir(dataDir, { recursive: true, mode: 0o700 });
          const appendBytes = Buffer.from(
            `${result.newRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
            "utf8",
          );
          if (pinnedParent) {
            // The exact append bytes go through the pinned descriptor
            // namespace with complete-short-write semantics; record bytes,
            // newline behavior, mode, return value, and error classification
            // remain identical to the parent's ordinary-path append.
            const appendHandle = await fsOpen(
              `${pinnedParent.procPrefix}${LEDGER_NAME}`,
              fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW,
              0o600,
            );
            try {
              const complete = await completeWrite(appendHandle, appendBytes);
              if (!complete) throw new Error("short ledger append through pinned namespace");
              await appendHandle.sync().catch(() => {});
            } finally {
              void safeClose(appendHandle);
            }
          } else {
            await appendFile(ledgerPath, appendBytes, {
              encoding: "utf8",
              mode: 0o600,
            });
          }
        }

        // Parent operational success transition happens at the same logical
        // point with identical fields and values as original parent behavior.
        const completedAt = new Date().toISOString();
        const issueCountsForRun = issueCounts(result.issues);
        lastScan = {
          eligibleSettlementReferences: result.eligibleSettlementReferences,
          alreadyReconciled: result.alreadyReconciled,
          reconciledThisRun: result.newRecords.length,
          issueCount: result.issues.length,
        };
        runSequence += 1;
        lastRun = Object.freeze({
          runGenerationId: `setlrun_${sha256(`${runSequence}|${completedAt}`).slice(0, 24)}`,
          lastRunAt: completedAt,
          lastError: null,
          lastIssueCounts: issueCountsForRun,
        });

        // Isolated best-effort evidence publication. Its success or failure
        // cannot alter public output, ledger records, scheduling, or the next
        // reconciliation, and it never enters the parent catch.
        try {
          if (t4aLedgerPathValid && leaseForRun) {
            publicationPinned = pinnedParent;
            publicationLease = leaseForRun;
            const publication = await publishSettlementGeneration({
              ownedLease: leaseForRun,
              hadNewRecords: result.newRecords.length > 0,
              runFailed: false,
            });
            if (publication.published && publication.manifest) {
              publishedGeneration = Object.freeze(publication.manifest);
              leaseForRun = null; // ownership transferred and closed inside
            }
          }
        } catch (publicationError) {
          // Private bounded diagnostic only.
          publishedGeneration = publishedGeneration;
          void publicationError;
        }
      } catch (error) {
        console.error(`commerce settlement reconciliation failed: ${String(error?.message || error).slice(0, 200)}`);
        runSequence += 1;
        const failedAt = new Date().toISOString();
        lastRun = Object.freeze({
          runGenerationId: `setlrun_${sha256(`error|${runSequence}|${failedAt}|${instanceEntropy}`).slice(0, 24)}`,
          lastRunAt: failedAt,
          lastError: "reconciliation_failed",
          // Counts from the previous completed scan persist as visible issue
          // evidence; lastError marks that this generation did not scan.
          lastIssueCounts: lastRun?.lastIssueCounts || {},
        });
        // An actual parent failure may best-effort publish the failed capture
        // generation; a failure of that publication still leaves parent
        // public state unchanged.
        try {
          if (t4aLedgerPathValid && leaseForRun && pinnedParent) {
            publicationPinned = pinnedParent;
            publicationLease = leaseForRun;
            await publishSettlementGeneration({
              ownedLease: leaseForRun,
              hadNewRecords: false,
              runFailed: true,
            });
            leaseForRun = null;
          }
        } catch {
          // private publication failure only
        }
      } finally {
        reconcileInFlight -= 1;
        if (leaseForRun) {
          void safeClose(leaseForRun.handle);
          leaseForRun = null;
        }
      }
    });
    await running;
    const resultStatus = pinnedParent
      ? await status({ pinnedPrefix: pinnedParent.procPrefix })
      : await status();
    if (pinnedParent) {
      void safeClose(pinnedParent.handle);
      pinnedParent = null;
    }
    return resultStatus;
  }

  function schedule(intervalMs = 60_000) {
    void reconcile();
    const timer = setInterval(() => void reconcile(), Math.max(15_000, Number(intervalMs) || 60_000));
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { capturePlane, enabled, ledgerPath, reconcile, schedule, status };
}

export { BASE_USDC, SCHEMA_VERSION };
