import { createHash, createHmac } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  open as fsOpen,
  readFile,
  stat as fsStat,
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
// Settlement-plane stable cut (T4a settlement-only lane).
//
// Offline candidate: one coherent capture of the settlement ledger plane. A
// capture binds, in a single generation: the ledger's regular-file identity
// (dev/ino/mode), an exact byte cut taken through one file descriptor between
// two fstat calls, its sha256 digest, enabled state, integrity evidence,
// baseline, the in-memory run generation (lastRunAt / lastError / last issue
// counts) captured atomically by reference, and the summary derived only from
// those exact bytes plus its digest. Lifecycle is exactly
// never_run | running | ok | restart_pending | unstable | corrupt.
//
// Guarantees: no mixing of bytes/totals/lifecycle across generations; bounded
// retry on torn cuts then an explicit `unstable` with null byte facts and no
// summary (never fabricated health or zero); unrecognized and false-economic
// rows are visible issue evidence and never revenue; money stays canonical
// atomic-unit strings with bounded BigInt conversion — no float coercion.

export const SETTLEMENT_PLANE_CAPTURE_SCHEMA = "samedaydesk.commerce-settlement-plane-capture.v1";
const SETTLEMENT_SUMMARY_SCHEMA = "samedaydesk.commerce-settlement-summary.v1";
const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CANONICAL_ATOMIC_AMOUNT = /^[1-9][0-9]{0,77}$/u;
const DIGIT_AMOUNT = /^\d+$/u;

export const SETTLEMENT_PLANE_LIFECYCLE_STATES = Object.freeze(new Set([
  "never_run",
  "running",
  "ok",
  "restart_pending",
  "unstable",
  "corrupt",
]));

// Fixed capture bounds; injectable through `limits` for tests only.
export const DEFAULT_CUT_LIMITS = Object.freeze({
  maxCutBytes: 8 * 1024 * 1024,
  attempts: 3,
  retryDelayMs: 25,
});

export const DEFAULT_LEDGER_IO = Object.freeze({
  stat: fsStat,
  open: fsOpen,
  fstat: (handle) => handle.stat(),
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

function identityOf(stat) {
  if (!stat || typeof stat !== "object") return null;
  return Object.freeze({ dev: stat.dev, ino: stat.ino, mode: stat.mode });
}

function sameFileGeneration(left, right) {
  return Boolean(
    left
    && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size,
  );
}

function normalizeCutLimits(limits) {
  return {
    maxCutBytes: Number.isSafeInteger(limits?.maxCutBytes) && limits.maxCutBytes > 0
      ? limits.maxCutBytes
      : DEFAULT_CUT_LIMITS.maxCutBytes,
    attempts: Number.isSafeInteger(limits?.attempts) && limits.attempts > 0
      ? limits.attempts
      : DEFAULT_CUT_LIMITS.attempts,
    retryDelayMs: Number.isSafeInteger(limits?.retryDelayMs) && limits.retryDelayMs >= 0
      ? limits.retryDelayMs
      : DEFAULT_CUT_LIMITS.retryDelayMs,
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

function canonicalAtomicAmountString(value) {
  if (typeof value !== "string" || !CANONICAL_ATOMIC_AMOUNT.test(value)) return null;
  return value;
}

function shortLabel(value, fallback, maxLen) {
  if (typeof value !== "string") return fallback;
  if (value.length === 0) return fallback;
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function addBucket(bucket, key, amount) {
  addAmount(bucket, key, amount);
}

function bytesFromCut(cut) {
  if (Buffer.isBuffer(cut?.bytes)) return cut.bytes;
  if (typeof cut?.bytes === "string") return Buffer.from(cut.bytes, "utf8");
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

// Cut one stable snapshot of the ledger file: stat -> open -> fstat ->
// sized pread -> fstat -> close. The cut only counts as coherent when the
// path stat, the pre-read fd stat, and the post-read fd stat agree on
// identity (dev/ino/mode) and size, and the number of bytes actually read
// equals that size. Otherwise the attempt is torn; after `limits.attempts`
// tries the cut is explicitly `unstable`. ENOENT is a plain absent ledger,
// not instability, and does not fabricate a zero-byte digest.
export async function captureStableLedgerCut(ledgerPath, {
  limits = DEFAULT_CUT_LIMITS,
  io = DEFAULT_LEDGER_IO,
  sleep = defaultSleep,
} = {}) {
  const bounds = normalizeCutLimits(limits);
  if (typeof ledgerPath !== "string" || ledgerPath.length === 0) {
    return { present: false, unstable: true, reason: "ledger_path_invalid", attemptsUsed: 0 };
  }

  let lastReason = "torn_cut";
  for (let attempt = 1; attempt <= bounds.attempts; attempt += 1) {
    let beforeStat;
    try {
      beforeStat = await io.stat(ledgerPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { present: false, unstable: false, attemptsUsed: attempt };
      }
      return { present: true, unstable: true, reason: "ledger_unreadable", attemptsUsed: attempt };
    }
    if (typeof beforeStat?.isFile !== "function" || !beforeStat.isFile()) {
      return {
        present: true,
        unstable: true,
        irregular: true,
        reason: "ledger_not_regular_file",
        identity: identityOf(beforeStat),
        attemptsUsed: attempt,
      };
    }
    if (!Number.isSafeInteger(beforeStat.size) || beforeStat.size < 0) {
      return {
        present: true,
        unstable: true,
        reason: "ledger_size_unsafe",
        identity: identityOf(beforeStat),
        attemptsUsed: attempt,
      };
    }
    if (beforeStat.size > bounds.maxCutBytes) {
      return {
        present: true,
        unstable: true,
        reason: "ledger_too_large",
        identity: identityOf(beforeStat),
        attemptsUsed: attempt,
      };
    }

    let handle = null;
    let torn = false;
    let reason = "torn_cut";
    let before = null;
    let after = null;
    let bytes = null;
    let byteCount = 0;
    try {
      handle = await io.open(ledgerPath, "r");
      before = await io.fstat(handle);
      if (!sameFileGeneration(beforeStat, before)) {
        torn = true;
      } else if (before.size === 0) {
        bytes = Buffer.alloc(0);
        byteCount = 0;
        after = await io.fstat(handle);
        if (!sameFileGeneration(before, after) || after.size !== 0) torn = true;
      } else {
        const exact = await readExactBytes(io, handle, before.size);
        bytes = exact.bytes;
        byteCount = exact.byteCount;
        if (byteCount !== before.size) {
          torn = true;
          reason = "byte_count_mismatch";
        } else {
          after = await io.fstat(handle);
          if (!sameFileGeneration(before, after) || after.size !== byteCount) torn = true;
        }
      }
    } catch {
      torn = true;
      reason = "ledger_read_error";
    } finally {
      if (handle) await io.close(handle).catch(() => {});
    }

    if (!torn && bytes) {
      return {
        present: true,
        unstable: false,
        attemptsUsed: attempt,
        identity: identityOf(after || before),
        bytes,
        byteCount,
        byteDigest: sha256Hex(bytes),
      };
    }
    lastReason = reason;
    if (attempt < bounds.attempts) await sleep(bounds.retryDelayMs);
  }
  return { present: true, unstable: true, reason: lastReason, attemptsUsed: bounds.attempts };
}

function normalizeRunState(runState) {
  if (runState === null || runState === undefined) return null;
  if (typeof runState !== "object" || Array.isArray(runState)) return null;
  const lastIssueCounts = Object.create(null);
  try {
    if (runState.lastIssueCounts && typeof runState.lastIssueCounts === "object") {
      for (const [code, count] of Object.entries(runState.lastIssueCounts)) {
        if (typeof code === "string" && Number.isSafeInteger(count) && count >= 0) lastIssueCounts[code] = count;
      }
    }
  } catch {
    // Issue evidence that cannot be read safely is dropped, never guessed.
  }
  let impossibleLastRunAt = false;
  let lastRunAt = null;
  try {
    if (runState.lastRunAt != null) {
      if (canonicalIsoTimestampMs(runState.lastRunAt) === null) impossibleLastRunAt = true;
      else lastRunAt = runState.lastRunAt;
    }
  } catch {
    impossibleLastRunAt = true;
    lastRunAt = null;
  }
  let lastError = null;
  try {
    lastError = typeof runState.lastError === "string" ? runState.lastError : null;
  } catch {
    lastError = null;
  }
  let runGenerationId = null;
  try {
    runGenerationId = typeof runState.runGenerationId === "string" ? runState.runGenerationId : null;
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
    const route = own(record, "route");
    if (route !== undefined && typeof route !== "string") return "unrecognized_ledger_record";
    const paymentClass = own(record, "paymentClass");
    if (paymentClass !== undefined && typeof paymentClass !== "string") return "unrecognized_ledger_record";
    for (const field of ["reconciledAt", "sourceEventTimestamp", "blockTimestamp"]) {
      const value = own(record, field);
      if (value !== undefined && canonicalIsoTimestampMs(value) === null) {
        return "impossible_ledger_timestamp";
      }
    }
    const amountAtomic = own(record, "amountAtomic");
    if (canonicalAtomicAmountString(amountAtomic) === null) {
      if (typeof amountAtomic === "string" && DIGIT_AMOUNT.test(amountAtomic)) {
        return "false_economic_ledger_record";
      }
      return "unsafe_amount_atomic";
    }
    return "revenue";
  } catch {
    return "hostile_ledger_record";
  }
}

function resolveLifecycle({ cut, running, runState, corruptLines, withheld }) {
  if (withheld || cut?.unstable) return "unstable";
  if (running) return "running";
  if (corruptLines > 0) return "corrupt";
  if (runState?.lastError) return "restart_pending";
  if (!runState) return "never_run";
  if (!cut?.present) return "restart_pending";
  return "ok";
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
  const normalizedRun = normalizeRunState(runState);
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

  let baselineIso = null;
  try {
    if (canonicalIsoTimestampMs(baseline) !== null) baselineIso = baseline;
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
  const unstableCut = Boolean(cut?.unstable);

  if (unstableCut) {
    withheld = true;
    withholdReason = String(cut?.reason || "torn_cut");
  } else if (cut?.present === true) {
    const bytes = bytesFromCut(cut);
    if (bytes === null) {
      withheld = true;
      withholdReason = "ledger_bytes_missing";
    } else {
      const actualDigest = sha256Hex(bytes);
      if (
        (cut.byteCount != null && cut.byteCount !== bytes.length)
        || (typeof cut.byteDigest === "string" && cut.byteDigest !== actualDigest)
      ) {
        withheld = true;
        withholdReason = "byte_digest_mismatch";
      } else {
        byteCount = bytes.length;
        byteDigest = actualDigest;
        const text = bytes.toString("utf8");
        const revenueRows = [];
        for (const line of text.split("\n")) {
          if (line.trim().length === 0) continue;
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            corruptLines += 1;
            continue;
          }
          const classification = classifyLedgerRecord(parsed);
          if (classification === "revenue") {
            revenueRows.push(parsed);
            continue;
          }
          if (classification === "corrupt_line") {
            corruptLines += 1;
            continue;
          }
          issues[classification] = (issues[classification] || 0) + 1;
        }

        // Totals come only from this exact cut's canonical rows. Duplicate
        // references keep their first occurrence; repeats are issue evidence.
        summary = {
          schemaVersion: SETTLEMENT_SUMMARY_SCHEMA,
          reconciledSettlements: 0,
          distinctSettlementReferences: 0,
          amountAtomic: "0",
          byClass: Object.create(null),
          byRoute: Object.create(null),
        };
        const seenReferences = new Set();
        for (const record of revenueRows) {
          const reference = String(own(record, "settlementReference")).toLowerCase();
          if (seenReferences.has(reference)) {
            issues.duplicate_ledger_reference = (issues.duplicate_ledger_reference || 0) + 1;
            continue;
          }
          seenReferences.add(reference);
          const amountText = canonicalAtomicAmountString(own(record, "amountAtomic"));
          let amount;
          try {
            amount = BigInt(amountText);
          } catch {
            issues.unsafe_amount_atomic = (issues.unsafe_amount_atomic || 0) + 1;
            continue;
          }
          summary.reconciledSettlements += 1;
          summary.amountAtomic = (BigInt(summary.amountAtomic) + amount).toString();
          addBucket(summary.byClass, shortLabel(own(record, "paymentClass"), "unclassified", 64), amount);
          addBucket(summary.byRoute, shortLabel(own(record, "route"), "/:unknown", 128), amount);
        }
        summary.distinctSettlementReferences = seenReferences.size;
        summaryDigest = sha256Hex(JSON.stringify(summary));
      }
    }
  }

  const lifecycle = resolveLifecycle({
    cut,
    running: Boolean(running),
    runState: normalizedRun,
    corruptLines,
    withheld,
  });
  const generationSeed = JSON.stringify([
    SETTLEMENT_PLANE_CAPTURE_SCHEMA,
    capturedAtDate,
    lifecycle,
    withheld ? null : byteDigest,
    summaryDigest,
    normalizedRun ?? null,
    Boolean(enabled),
    baselineIso,
  ]);
  const generationId = `setlcut_${sha256Hex(generationSeed).slice(0, 32)}`;

  return Object.freeze({
    schemaVersion: SETTLEMENT_PLANE_CAPTURE_SCHEMA,
    capturedAt: capturedAtDate,
    generationId,
    lifecycle,
    enabled: Boolean(enabled),
    baseline: baselineIso,
    attemptsUsed: cut?.attemptsUsed ?? 0,
    ledger: Object.freeze({
      present: cut?.present === true,
      regularFile: cut?.present === true && cut?.irregular !== true,
      identity: cut?.identity
        ? Object.freeze({ dev: cut.identity.dev, ino: cut.identity.ino, mode: cut.identity.mode })
        : null,
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
}

// One coherent settlement-plane capture: stable cut + atomic run-state
// reference, bound into a single generation. `io`, `sleep` and `limits` are
// injectable so hostile tests can race appends/truncates/replaces between
// stat/read/stat deterministically.
export async function captureCommerceSettlementPlane({
  ledgerPath,
  enabled = true,
  baseline = "",
  runState = null,
  running = false,
  limits = DEFAULT_CUT_LIMITS,
  io = DEFAULT_LEDGER_IO,
  sleep = defaultSleep,
  now = () => new Date(),
} = {}) {
  const cut = await captureStableLedgerCut(ledgerPath, { limits, io, sleep });
  return buildCommerceSettlementPlaneSnapshot({ cut, enabled, baseline, runState, running, now });
}

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
  const ledgerPath = path.join(dataDir, "commerce-settlements.ndjson");
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
  // after each reconcile so a capture can bind to it atomically by reference
  // and never observe a torn mix of old and new run fields.
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

  function capturePlane(options = {}) {
    const runRef = lastRun;
    const wasInFlight = reconcileInFlight > 0;
    return captureCommerceSettlementPlane({
      ledgerPath,
      enabled,
      baseline: settlementEvidenceSince,
      runState: runRef,
      running: wasInFlight,
      limits: options.limits,
      io: options.io,
      sleep: options.sleep,
      now: options.now,
    });
  }

  async function status() {
    const [ledger, eventParts] = await Promise.all([
      readExisting(ledgerPath),
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
    reconcileInFlight += 1;
    running = running.then(async () => {
      try {
        const [eventParts, ledger] = await Promise.all([
          Promise.all(paths.map(readExisting)),
          readExisting(ledgerPath),
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
          await appendFile(ledgerPath, `${result.newRecords.map((record) => JSON.stringify(record)).join("\n")}\n`, {
            encoding: "utf8",
            mode: 0o600,
          });
          await chmod(ledgerPath, 0o600).catch(() => {});
        }
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
      } catch (error) {
        console.error(`commerce settlement reconciliation failed: ${String(error?.message || error).slice(0, 200)}`);
        runSequence += 1;
        lastRun = Object.freeze({
          runGenerationId: `setlrun_${sha256(`error|${runSequence}`).slice(0, 24)}`,
          lastRunAt: new Date().toISOString(),
          lastError: "reconciliation_failed",
          // Counts from the previous completed scan persist as visible issue
          // evidence; lastError marks that this generation did not scan.
          lastIssueCounts: lastRun?.lastIssueCounts || {},
        });
      } finally {
        reconcileInFlight -= 1;
      }
    });
    await running;
    return status();
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
