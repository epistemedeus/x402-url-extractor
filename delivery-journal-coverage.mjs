// Finite prospective continuity of the existing producers' append population.
// The process-local admission gate cannot certify store-wide exclusivity.
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { admitCommerceJournal, commerceRuntime, journalProducer, journalState } from './commerce-journal-admission.mjs';
import { DELIVERY_CUT_SCHEMA, DELIVERY_CUT_MAX_BYTES, authenticateDeliveryCut, signDeliveryCut } from './commerce-delivery-cut-auth.mjs';
import { deliveryRecords, journalDigest as sha, pinDeliveryDirectory, snapshotDeliveryFile } from './commerce-journal-snapshot.mjs';
import { attemptSegmentName, COMMERCE_PROSPECTIVE_SEGMENT_LIMIT } from './commerce-prospective-retention.mjs';

export const DELIVERY_COVERAGE_SCHEMA = 'samedaydesk.delivery-journal-coverage.v1';
export const DELIVERY_PLANES = Object.freeze({
  attempts: Array.from({ length: COMMERCE_PROSPECTIVE_SEGMENT_LIMIT }, (_, n) => attemptSegmentName(COMMERCE_PROSPECTIVE_SEGMENT_LIMIT - n - 1)),
  settlements: ['commerce-settlements.ndjson'],
  paid_success: ['commerce-paid-success-evidence.ndjson'],
  http_validation: ['http-response-validation.v1.ndjson'],
  mcp_delivery: ['mcp-tool-delivery.v1.ndjson'],
  forward: ['commerce-outcome-binding.1.ndjson', 'commerce-outcome-binding.ndjson'],
  task_refs: ['commerce-outcome-task-ref.1.ndjson', 'commerce-outcome-task-ref.ndjson'],
  feedback: ['caller-result-feedback.1.ndjson', 'caller-result-feedback.ndjson'],
});
// Content identity, never a caller-supplied Git SHA. Bootstrap labels are separate.
const SOURCE_FILES = [
  'delivery-journal-coverage.mjs',
  'delivery-journal-coverage-http.mjs',
  'commerce-journal-snapshot.mjs',
  'commerce-delivery-cut-auth.mjs',
  'commerce-journal-admission.mjs',
  'commerce-prospective-retention.mjs',
  'http-delivery-evidence/observation.mjs',
  'http-delivery-evidence/historical.mjs',
  'http-delivery-evidence/mcp-delivery.mjs',
  'commerce-events.mjs',
  'commerce-journal-cut-auth.mjs',
  'commerce-settlement-reconciler.mjs',
  'commerce-outcome-binding.mjs',
  'caller-result-feedback.mjs',
  'http-delivery-evidence/store.mjs',
  'ordinary-delivery-join.mjs',
  'ordinary-delivery-join-cli.mjs',
  'server.js',
];
export function deliverySourceDigest() {
  return sha(SOURCE_FILES.map(name => name + ':' + sha(readFileSync(new URL(name, import.meta.url)))).join('\n'));
}
const verified = new WeakSet();
export function isReceivedDeliveryCoverage(value, { windowStart, windowEnd } = {}) {
  if (!value || !verified.has(value)) return false;
  if (!value.window || windowStart === undefined) return true;
  return Date.parse(windowStart) >= Date.parse(value.window.from) && Date.parse(windowEnd) <= Date.parse(value.window.asOf);
}
function seal(value) {
  const freeze = item => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
    return item;
  };
  verified.add(value);
  return freeze(value);
}
function baseUnknown(reason) {
  const value = { schema: DELIVERY_COVERAGE_SCHEMA, population: 'registered_process_journal_appends', coverage: 'unknown_for_full_window', exhaustive: false,
    crossProcessExclusivity: 'unproven', reasons: [reason], window: null, planes: Object.fromEntries(Object.keys(DELIVERY_PLANES).map(plane => [plane, { coverage: 'unknown', reasons: [reason], writes: null }])),
    customerCount: null, usefulness: 'unknown', historicalBackfill: false };
  return value;
}
function unknown(reason) { return seal(baseUnknown(reason)); }
async function snapshot(pinned) {
  const files = {};
  let total = 0;
  for (const name of Object.values(DELIVERY_PLANES).flat()) {
    files[name] = await snapshotDeliveryFile(pinned, name);
    total += files[name].size || 0;
    if (total > 128 * 1024 * 1024) throw Error('total_file_limit_exceeded');
  }
  return files;
}
const metadata = file => { const { bytes, ...rest } = file; return rest; };
function observedRange(files, range) {
  if (!range || !Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 0 || range.to < range.from) return { rows: [], reason: 'invalid_range' };
  const file = Object.values(files).find(file => file.identity === range.identity && file.bytes && file.size >= range.to && sha(file.bytes.subarray(0, range.to)) === range.prefixDigest);
  if (!file) return { rows: [], reason: 'captured_generation_lost_or_changed' };
  const bytes = file.bytes.subarray(range.from, range.to);
  if (sha(bytes) !== range.digest) return { rows: [], reason: 'captured_range_changed' };
  return deliveryRecords(bytes);
}
function assessPlane(plane, initial, files, state) {
  const names = DELIVERY_PLANES[plane], start = initial.files[names.at(-1)], reasons = [], ranges = [];
  const writes = (state.writes[plane] || 0) - (initial.writes[plane] || 0);
  if (!initial.owners.has(plane)) reasons.push('producer_not_registered_at_start');
  if ((state.faults[plane] || 0) !== (initial.faults[plane] || 0)) reasons.push('producer_write_outcome_unknown');
  if (start.reason) reasons.push(start.reason);
  if (start.size > 0 && !start.recordAligned) reasons.push('start_not_record_aligned');
  const candidates = names.map(name => files[name]);
  if (start.present && !candidates.some(file => file.identity === start.identity && file.bytes)) reasons.push('start_generation_lost');
  const initialIds = new Set(names.map(name => initial.files[name].identity).filter(Boolean));
  for (const file of candidates) {
    if (file.reason) reasons.push(file.reason);
    if (!file.bytes) continue;
    if (initialIds.has(file.identity) && file.identity !== start.identity) {
      const old = names.map(name => initial.files[name]).find(old => old.identity === file.identity);
      if (old.digest !== file.digest) reasons.push('historical_generation_changed');
      continue;
    }
    const offset = file.identity === start.identity ? start.size : 0;
    if (offset > file.size || file.identity === start.identity && sha(file.bytes.subarray(0, offset)) !== start.digest) { reasons.push('start_prefix_changed'); continue; }
    ranges.push({ identity: file.identity, from: offset, to: file.size, digest: sha(file.bytes.subarray(offset)), prefixDigest: file.digest });
  }
  const parsed = ranges.map(range => observedRange(files, range));
  for (const item of parsed) if (item.reason) reasons.push(item.reason);
  const rows = parsed.flatMap(item => item.rows);
  const admitted = (state.hashes[plane] || []).filter(item => item.sequence > (initial.writes[plane] || 0));
  const producerDigest = sha(admitted.map(item => item.digest).join(''));
  if (rows.length !== writes || admitted.length !== writes || sha(rows.map(row => sha(JSON.stringify(row))).join('')) !== producerDigest) reasons.push('unregistered_write_or_loss');
  return { coverage: reasons.length ? (initial.owners.has(plane) ? 'partial' : 'unknown') : 'complete', reasons: [...new Set(reasons)], writes,
    rotations: (state.rotations[plane] || 0) - (initial.rotations[plane] || 0), producerDigest, ranges,
    files: candidates.map(metadata) };
}
function receive(record, files, namespace, { internalToken, windowStart, windowEnd }) {
  if (!authenticateDeliveryCut(record, internalToken)) return unknown('capture_authentication_refused');
  if (record.namespace !== namespace) return unknown('store_namespace_changed');
  if (record.sourceDigest !== deliverySourceDigest()) return unknown('source_changed');
  const start = Date.parse(windowStart), end = Date.parse(windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return unknown("invalid_window");
  if (start < Date.parse(record.from) || end > Date.parse(record.asOf)) return unknown('requested_window_not_observed');
  const value = baseUnknown('cross_process_exclusivity_unproven');
  value.coverage = 'partial';
  value.window = { from: record.from, asOf: record.asOf };
  value.sourceDigest = record.sourceDigest;
  value.cutId = record.cutId;
  value.process = record.process;
  value.runtime = record.runtime;
  value.durability = record.durability;
  value.reasons.push('event_time_is_not_append_time');
  for (const plane of Object.keys(DELIVERY_PLANES)) {
    const declared = record.planes[plane];
    if (!declared || !Array.isArray(declared.ranges) || !Array.isArray(declared.reasons) || !Array.isArray(declared.files)
      || !['complete', 'partial', 'unknown'].includes(declared.coverage) || !Number.isSafeInteger(declared.writes) || declared.writes < 0) return unknown('capture_planes_invalid');
    const reasons = [...declared.reasons];
    for (const expected of declared.files) {
      if (expected.present && expected.size === 0 && !Object.values(files).some(file => file.identity === expected.identity && file.bytes)) reasons.push('empty_generation_lost');
    }
    const parsed = declared.ranges.map(range => observedRange(files, range));
    for (const item of parsed) if (item.reason) reasons.push(item.reason);
    const rows = parsed.flatMap(item => item.rows);
    if (rows.length !== declared.writes || sha(rows.map(row => sha(JSON.stringify(row))).join('')) !== declared.producerDigest) reasons.push('producer_digest_mismatch');
    value.planes[plane] = { coverage: reasons.length ? (declared.coverage === 'unknown' ? 'unknown' : 'partial') : declared.coverage,
      reasons: [...new Set(reasons)], writes: declared.writes, retainedRecords: rows.length, rotations: declared.rotations };
  }
  return seal(value);
}
export function createDeliveryJournalCoverage({ app, telemetry, settlement = null, feedback = null, dataDir, internalToken = '' }) {
  let initial;
  const sourceDigest = deliverySourceDigest(), sessionId = randomUUID();
  const runtime = commerceRuntime(app);
  const producer = journalProducer(telemetry);
  const pathKey = path.resolve(dataDir);
  async function begin() {
    if (deliverySourceDigest() !== sourceDigest) throw Error("source_changed");
    if (!producer || producer.dir !== pathKey || typeof telemetry.persistJournalCut !== 'function') throw Error('telemetry_producer_unavailable');
    if (Buffer.byteLength(internalToken) < 32) throw Error('existing_token_unavailable');
    await telemetry.flush();
    return telemetry.withJournalCapture(async () => {
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const pinned = await pinDeliveryDirectory(pathKey);
      try {
        const files = await snapshot(pinned), state = journalState(pathKey), owners = new Set(producer.planes);
        for (const candidate of [settlement, feedback]) {
          const registered = journalProducer(candidate);
          if (registered?.dir === pathKey) for (const plane of registered.planes) owners.add(plane);
        }
        // Keep only identity/digests and alignment; initial journal bytes need
        // not stay resident for the process lifetime.
        const initialFiles = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, {
          ...metadata(file), recordAligned: file.bytes ? file.bytes.length === 0 || file.bytes.at(-1) === 10 : false,
        }]));
        initial = { files: initialFiles, namespace: pinned.namespace, from: new Date().toISOString(), writes: { ...state.writes }, faults: { ...state.faults }, rotations: { ...state.rotations }, owners };
        return { from: initial.from };
      } finally { await pinned.handle.close(); }
    });
  }
  const ready = begin();
  void ready.catch(() => undefined);
  return Object.freeze({ ready, begin, async capture() {
    if (!initial) await ready;
    try { await telemetry.flush(); } catch { throw Error("producer_flush_failed"); }
    if (Date.now() <= Date.parse(initial.from)) await new Promise(resolve => setTimeout(resolve, 2));
    return telemetry.withJournalCapture(async () => {
      if (deliverySourceDigest() !== sourceDigest) throw Error('source_changed');
      const pinned = await pinDeliveryDirectory(pathKey);
      try {
        if (pinned.namespace !== initial.namespace) throw Error('store_namespace_changed');
        const files = await snapshot(pinned), state = journalState(pathKey);
        const asOf = new Date(Math.max(Date.now(), Date.parse(initial.from) + 1)).toISOString();
        if (Date.parse(asOf) > Date.now()) throw Error('interval_not_elapsed');
        const planes = Object.fromEntries(Object.keys(DELIVERY_PLANES).map(plane => [plane, assessPlane(plane, initial, files, state)]));
        const body = { schema: DELIVERY_CUT_SCHEMA, kind: 'delivery_journal_capture', cutId: randomUUID(), sessionId, namespace: pinned.namespace,
          sourceDigest, process: { pid: process.pid, sessionId }, runtime, population: 'registered_process_journal_appends', crossProcessExclusivity: 'unproven',
          durability: 'existing_producer_flush_and_closed_files_no_power_loss_guarantee', from: initial.from, asOf, planes };
        const record = { ...body, authentication: signDeliveryCut(body, internalToken) };
        if (Buffer.byteLength(JSON.stringify(record)) > DELIVERY_CUT_MAX_BYTES) throw Error('cut_limit_exceeded');
        try { await telemetry.persistJournalCut(record); } catch { throw Error("capture_persist_failed"); }
        const afterPin = await pinDeliveryDirectory(pathKey);
        try { if (afterPin.namespace !== pinned.namespace) throw Error('store_namespace_changed'); }
        finally { await afterPin.handle.close(); }
        const after = await snapshot(pinned);
        const received = findCuts(after).find(item => item.cutId === record.cutId && item.authentication === record.authentication);
        if (!received) throw Error('cut_write_outcome_unknown');
        return { from: body.from, asOf, coverage: receive(received, after, pinned.namespace, { internalToken, windowStart: body.from, windowEnd: asOf }) };
      } finally { await pinned.handle.close(); }
    });
  } });
}
function findCuts(files) {
  const cuts = [];
  cuts.malformed = false;
  cuts.truncated = false;
  for (const name of DELIVERY_PLANES.attempts) {
    const bytes = files[name]?.bytes;
    if (!bytes) continue;
    // Only terminated records count; a torn tail never becomes a certificate.
    const lines = bytes.toString('utf8').split('\n');
    if (lines.at(-1).startsWith('{"schema":"' + DELIVERY_CUT_SCHEMA + '",')) cuts.truncated = true;
    for (const line of lines.slice(0, -1)) {
      if (!line.startsWith('{"schema":"' + DELIVERY_CUT_SCHEMA + '",')) continue;
      if (Buffer.byteLength(line) > DELIVERY_CUT_MAX_BYTES) continue;
      try { cuts.push(JSON.parse(line)); } catch { cuts.malformed = true; }
    }
  }
  return cuts.sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf));
}
export async function readDeliveryJournalCoverage({ dataDir, internalToken = process.env.COMMERCE_INTERNAL_TOKEN || '', windowStart, windowEnd }) {
  return admitCommerceJournal(dataDir, async () => {
    let pinned;
    try {
      pinned = await pinDeliveryDirectory(path.resolve(dataDir));
      const files = await snapshot(pinned), cuts = findCuts(files);
      if (!cuts.length) return unknown(Object.values(files).find(file => file.reason)?.reason || (cuts.truncated ? 'delivery_capture_truncated' : cuts.malformed ? 'delivery_capture_malformed' : 'delivery_capture_absent'));
      const matching = cuts.filter(cut => Date.parse(cut.from) <= Date.parse(windowStart) && Date.parse(cut.asOf) >= Date.parse(windowEnd));
      return receive(matching.at(-1) || cuts.at(-1), files, pinned.namespace, { internalToken, windowStart, windowEnd });
    } catch (error) { return unknown(error.code || error.message || 'capture_read_failed'); }
    finally { if (pinned) await pinned.handle.close(); }
  });
}
