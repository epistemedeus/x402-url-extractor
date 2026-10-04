import { authenticateJournalCut } from "../../../../commerce-journal-cut-auth.mjs";
import { sanitizeSettlementSourceDeliveryAttribution } from '../../../../commerce-events.mjs';
import { constants, readFileSync } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { admitCommerceJournal, commerceRuntime, journalProducer, journalState } from '../../../../commerce-journal-admission.mjs';
import { LIMITS } from '../../free-task-observation-100421/vendor/bounds.mjs';
import { parseNdjson, exportSource, stripRecord, PLANES } from '../../free-task-observation-100421/src/export.mjs';
import { BUNDLE_SCHEMA } from '../../free-task-observation-100421/src/project.mjs';

export const SOURCE_FILE_BYTES = 5 * 1024 * 1024 + 8192;
export const SOURCE_TOTAL_BYTES = 40 * 1024 * 1024;
export const CUT_BYTES = LIMITS.totalBytes;
export const CUT_SCHEMA = 'samedaydesk.attempt-useful.journal-cut.v1';
export const FILES = Object.freeze({
  attempts: ['commerce-events.1.ndjson', 'commerce-events.ndjson'],
  task_refs: ['commerce-outcome-task-ref.1.ndjson', 'commerce-outcome-task-ref.ndjson'],
  forward: ['commerce-outcome-binding.1.ndjson', 'commerce-outcome-binding.ndjson'],
  retention: ['useful-result-customer.1.ndjson', 'useful-result-customer.ndjson'],
  reads: ['useful-result-metrics.1.ndjson', 'useful-result-metrics.ndjson'],
  settlements: ['commerce-settlements.ndjson'],
});
const OPERATION = 'normalized-transaction-receipt';
const ROUTE = '/chain/transaction-receipt';
const sourceDigest = createHash('sha256').update(['../../../../commerce-journal-admission.mjs', '../../../../commerce-journal-cut-auth.mjs', '../../../../commerce-events.mjs', '../../../../commerce-outcome-binding.mjs', '../../../../commerce-settlement-reconciler.mjs', '../../../../useful-result-reuse/store.mjs', '../../../../useful-result-reuse/customer-grant.mjs', '../../../../useful-result-reuse/delivery.mjs', './cut.mjs', './causal-stages.mjs', './view.mjs', './read.mjs', './enroll.mjs'].map(file => readFileSync(new URL(file, import.meta.url))).map(bytes => createHash('sha256').update(bytes).digest('hex')).join('')).digest('hex');
const proofs = new WeakMap();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mac = (body, token) => createHmac('sha256', token).update('attempt-useful-cut-v1\n').update(JSON.stringify(body)).digest('hex');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

const validToken = token => typeof token === 'string' && Buffer.byteLength(token) >= 32;
function empty(reason = 'capture_absent') {
  return { coverage: 'unknown', reason, window: null, capture: null, malformed: 0, torn: 0, rejected: 0,
    planes: Object.fromEntries(PLANES.map(p => [p, { coverage: 'unknown', reasons: [reason], files: [], bounds: [] }])),
    ...Object.fromEntries(PLANES.map(p => [p, []])) };
}

// Pin the owned directory; reject symlink ancestors rather than following an
// alternate journal namespace. Descriptor-relative reads survive path swaps.
async function pin(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || dir.includes('://') || dir.includes('\0') || path.normalize(dir) !== dir) fail('unsafe_path');
  let prefix = path.parse(dir).root;
  for (const component of dir.slice(prefix.length).split('/').filter(Boolean)) {
    prefix = path.join(prefix, component);
    const stat = await lstat(prefix);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_path');
  }
  const handle = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const stat = await handle.stat();
  if (stat.uid !== process.getuid()) { await handle.close(); fail('unknown_owner'); }
  return { handle, namespace: `${stat.dev}:${stat.ino}`, prefix: `/proc/self/fd/${handle.fd}/` };
}
async function fileSnapshot(pinned, name) {
  let handle;
  try { handle = await open(pinned.prefix + name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (e) { return { name, present: false, reason: e.code === 'ENOENT' ? null : 'unreadable_or_unsafe_file', bytes: null }; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || stat.mode & 0o022) return { name, present: true, reason: 'unsafe_file_owner_or_type', bytes: null };
    if (stat.size > SOURCE_FILE_BYTES) return { name, present: true, reason: 'file_limit_exceeded', bytes: null };
    const bytes = Buffer.alloc(stat.size);
    let used = 0;
    while (used < bytes.length) {
      const read = await handle.read(bytes, used, bytes.length - used, used);
      if (!read.bytesRead) break;
      used += read.bytesRead;
    }
    const after = await handle.stat();
    if (used !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) return { name, present: true, reason: 'concurrent_file_change', bytes: null };
    return { name, present: true, reason: null, identity: `${stat.dev}:${stat.ino}`, size: bytes.length, sha256: sha(bytes), bytes };
  } finally { await handle.close(); }
}
async function snapshot(pinned) {
  const files = {};
  let total = 0;
  for (const names of Object.values(FILES)) for (const name of names) {
    files[name] = await fileSnapshot(pinned, name);
    total += files[name].size || 0;
    if (total > SOURCE_TOTAL_BYTES) fail('total_limit_exceeded');
  }
  return files;
}
const metadata = file => { const { bytes, ...rest } = file; return rest; };
function parseRanges(files, ranges) {
  const rows = [];
  let malformed = 0, torn = 0;
  for (const range of ranges) {
    const file = Object.values(files).find(f => f.identity === range.identity && f.bytes && f.size >= range.to && sha(f.bytes.subarray(0, range.to)) === range.prefixSha256);
    if (!file) return { rows: [], malformed, torn, reason: 'captured_prefix_lost_or_changed' };
    const bytes = file.bytes.subarray(range.from, range.to);
    if (bytes.length > LIMITS.fileBytes) return { rows: [], malformed, torn, reason: 'interval_byte_limit_exceeded' };
    if (sha(bytes) !== range.sha256) return { rows: [], malformed, torn, reason: 'capture_digest_mismatch' };
    const parsed = parseNdjson(bytes);
    rows.push(...parsed.rows); malformed += parsed.malformed; torn += parsed.torn;
    if (rows.length > LIMITS.rows || rows.some(r => Buffer.byteLength(JSON.stringify(r)) > 16_384)) return { rows: [], malformed, torn, reason: 'row_limit_exceeded' };
  }
  return { rows, malformed, torn, reason: malformed || torn ? 'malformed_or_torn' : null };
}
function dedup(rows, plane) {
  const seen = new Map(); let conflict = false;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { conflict = true; continue; }
    const id = plane === 'attempts' ? row.id : plane === 'retention' ? (row.action === 'retain' ? row.grantId : `${row.targetId}:${row.at}`) : plane === 'settlements' ? row.settlementReference : row.eventId;
    if (!id) { conflict = true; continue; }
    const digest = sha(JSON.stringify(row));
    if (seen.has(id) && seen.get(id).digest !== digest) conflict = true;
    else seen.set(id, { digest, row });
  }
  return { rows: [...seen.values()].map(v => v.row), conflict };
}
function markerRows(file) {
  if (!file.bytes) return [];
  // snapshot already limits the entire canonical generation to SOURCE_FILE_BYTES.
  // Search those retained bytes, not merely the newest interval-sized tail:
  // ordinary later traffic cannot erase a still-retained authenticated marker.
  const bytes = file.bytes;
  // Capture markers are canonical producer rows with schema first. Decode
  // only those rows; thousands of older events cannot exhaust marker intake.
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n');
  const markers = lines.slice(0, -1).filter(line => line.startsWith('{"schema":"' + CUT_SCHEMA + '",'));
  return parseNdjson(Buffer.from(markers.join('\n') + (markers.length ? '\n' : ''))).rows;
}
function observedRows(rows, plane) {
  if (plane === 'attempts') return rows.filter(r => r?.route === ROUTE && r.schema !== CUT_SCHEMA);
  if (plane === 'reads') return rows.filter(r => r?.kind === 'useful_later_read');
  return rows;
}
function finalize(body, files) {
  const out = empty();
  out.capture = body;
  out.window = { from: body.from, to: body.asOf, asOf: body.asOf };
  out.reason = null;
  for (const plane of PLANES) {
    const declared = body.planes[plane];
    const parsed = parseRanges(files, declared.bounds);
    const unique = dedup(observedRows(parsed.rows, plane), plane);
    const reasons = [...declared.reasons];
    for (const expected of declared.files) {
      if (expected.present && !expected.reason && expected.size === 0
        && !Object.values(files).some(f => f.identity === expected.identity && f.bytes)) reasons.push('empty_generation_lost');
    }
    if (parsed.reason) reasons.push(parsed.reason);
    if (unique.conflict) reasons.push('conflicting_identity');
    out[plane] = unique.rows;
    out.malformed += parsed.malformed; out.torn += parsed.torn;
    out.planes[plane] = { ...declared, reasons: [...new Set(reasons)], coverage: reasons.length ? (declared.coverage === 'unknown' ? 'unknown' : 'partial') : declared.coverage };
  }
  const coverages = PLANES.map(p => out.planes[p].coverage);
  out.coverage = coverages.every(c => c === 'complete') ? 'complete' : coverages.every(c => c === 'unknown') ? 'unknown' : 'partial';
  proofs.set(out, body);
  return out;
}

// The capability is issued by the actual canonical telemetry constructor.
// Registering a capture proves only this process's observed interval. Restart
// begins a new interval; old completed cuts can be replayed, never extended.
export function createJournalCapture({ app, telemetry, dataDir, internalToken, settlement = null }) {
  const producer = journalProducer(telemetry);
  if (!producer || producer.dir !== path.resolve(dataDir) || !validToken(internalToken) || typeof telemetry.persistJournalCut !== 'function') fail('producer_not_registered');
  let sessionId = randomUUID();
  const runtime = commerceRuntime(app);
  let initial;
  async function begin() {
    await telemetry.flush();
    return telemetry.withJournalCapture(async () => {
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const pinned = await pin(dataDir);
      try {
        const files = await snapshot(pinned);
        const state = journalState(dataDir);
        sessionId = randomUUID();
        initial = { namespace: pinned.namespace, files, from: new Date().toISOString(), rotations: { ...state.rotations }, writes: { ...state.writes }, faults: { ...state.faults }, owners: new Set(state.owners) };
      } finally { await pinned.handle.close(); }
    });
  }
  const ready = begin();
  // Keep optional initialization failures observable at the authenticated
  // reader without raising an unhandled rejection in the public service.
  void ready.catch(() => undefined);
  return Object.freeze({ ready, begin,
    async capture() {
      await ready;
      await telemetry.flush();
      await new Promise(resolve => setTimeout(resolve, 2));
      return telemetry.withJournalCapture(async () => {
        const asOf = new Date().toISOString();
        const pinned = await pin(dataDir);
        try {
          if (pinned.namespace !== initial.namespace) fail('namespace_changed');
          const files = await snapshot(pinned), state = journalState(dataDir), planes = {};
          let intervalBytes = 0;
          for (const plane of PLANES) {
            const names = FILES[plane], reasons = [], ranges = [];
            const activeStart = initial.files[names.at(-1)];
            const rotationCount = (state.rotations[plane] || 0) - (initial.rotations[plane] || 0);
            const wrote = (state.writes[plane] || 0) - (initial.writes[plane] || 0);
            if (!initial.owners.has(plane) || plane === 'settlements' && (!journalProducer(settlement)?.planes.includes('settlements') || !settlement.enabled)) reasons.push('producer_not_observed');
            if ((state.faults[plane] || 0) !== (initial.faults[plane] || 0)) reasons.push('producer_write_outcome_unknown');
            if (activeStart.reason) reasons.push(activeStart.reason);
            if (activeStart.bytes?.length && activeStart.bytes.at(-1) !== 10) reasons.push('start_not_record_aligned');
            if (rotationCount > 1) reasons.push('interval_rotated_out');
            let candidates = names.map(name => files[name]);
            for (const file of candidates) if (file.reason) reasons.push(file.reason);
            if (activeStart.present && !candidates.some(f => f.identity === activeStart.identity)) reasons.push('start_generation_lost');
            if (!candidates.some(f => f.present) && wrote) reasons.push('written_plane_missing');
            // Without rotation the older generation predates enrollment.
            if (rotationCount === 0) candidates = [files[names.at(-1)]];
            for (const file of candidates) {
              if (!file.bytes) continue;
              const offset = file.identity === activeStart.identity ? activeStart.size : 0;
              if (offset > file.size || file.identity === activeStart.identity && sha(file.bytes.subarray(0, offset)) !== activeStart.sha256) { reasons.push('start_prefix_changed'); continue; }
              ranges.push({ name: file.name, identity: file.identity, from: offset, to: file.size, sha256: sha(file.bytes.subarray(offset)), prefixSha256: file.sha256 });
            }
            intervalBytes += ranges.reduce((sum, r) => sum + r.to - r.from, 0);
            if (intervalBytes > CUT_BYTES) reasons.push('total_interval_limit_exceeded');
            const parsed = parseRanges(files, ranges);
            if (parsed.reason) reasons.push(parsed.reason);
            if (parsed.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) reasons.push('invalid_journal_record');
            if (parsed.rows.some(row => { const time = Date.parse(row?.ts || row?.at || row?.createdAt || row?.reconciledAt); return Number.isFinite(time) && (time < Date.parse(initial.from) || time >= Date.parse(asOf)); })) reasons.push('record_outside_interval');
            const admitted = (state.hashes[plane] || []).filter(h => h.sequence > (initial.writes[plane] || 0));
            const observedDigest = sha(parsed.rows.map(row => sha(JSON.stringify(row))).join(''));
            const admittedDigest = sha(admitted.map(h => h.digest).join(''));
            if (parsed.rows.length !== wrote || admitted.length !== wrote || admittedDigest !== observedDigest) reasons.push('unregistered_write_or_loss');
            planes[plane] = { coverage: reasons.length ? (reasons.includes('producer_not_observed') ? 'unknown' : 'partial') : 'complete', reasons, files: names.map(n => metadata(files[n])), bounds: ranges,
              producerDigest: admittedDigest, producer: initial.owners.has(plane) ? 'canonical_single_process_owner' : null, rotations: rotationCount, writes: wrote };
          }
          // Existing settlement capture reports its own reconciliation state.
          // Journal coverage and completed reconciliation are separate facts.
          if (journalProducer(settlement)?.dir === path.resolve(dataDir) && settlement.enabled && typeof settlement.capturePlane === 'function') {
            const proof = await settlement.capturePlane();
            const p = planes.settlements;
            p.settlementCapture = proof;
            // This independent settlement generation is retained as evidence,
            // not used to relabel an unobserved journal interval. The registered
            // reconciler owns its bounded writes under the same admission gate.

          }
          const body = { schema: CUT_SCHEMA, kind: 'attempt_useful_capture', cutId: randomUUID(), sessionId, namespace: pinned.namespace,
            producer: 'canonical_commerce_and_useful_result_journals', sourceDigest, durability: 'existing_flush_and_closed_files_no_fsync_guarantee', callerReceipt: 'unknown', writerProcesses: 1, runtime, from: initial.from, asOf, planes };
          const record = { ...body, authentication: mac(body, internalToken) };
          if (Buffer.byteLength(JSON.stringify(record)) > LIMITS.rowBytes) fail('cut_record_limit_exceeded');
          const beforePublication = await pin(dataDir);
          try { if (beforePublication.namespace !== pinned.namespace) fail('namespace_changed'); }
          finally { await beforePublication.handle.close(); }
          await telemetry.persistJournalCut(record);
          const afterPublication = await pin(dataDir);
          try { if (afterPublication.namespace !== pinned.namespace) fail('namespace_changed'); }
          finally { await afterPublication.handle.close(); }
          const persistedFiles = await snapshot(pinned);
          const marker = Object.values(persistedFiles).filter(f => f.bytes && FILES.attempts.includes(f.name)).flatMap(markerRows)
            .find(r => r.cutId === body.cutId && r.authentication === record.authentication);
          if (!marker) fail('cut_write_outcome_unknown');
          const out = finalize(body, persistedFiles);
          // Persist returned read receipts against the same exact pre-marker cut.
          out.cutId = body.cutId;
          return out;
        } finally { await pinned.handle.close(); }
      });
    },
  });
}

export async function readBoundedCut(dataDir, { internalToken = '', cutId = null } = {}) {
  return admitCommerceJournal(typeof dataDir === 'string' ? dataDir : '/', async () => {
    let pinned;
    try {
      pinned = await pin(dataDir);
      const files = await snapshot(pinned);
      const candidates = FILES.attempts.flatMap(name => markerRows(files[name])).filter(r => r.schema === CUT_SCHEMA && (!cutId || r.cutId === cutId));
      const record = candidates.at(-1);
      if (!record) { const out = empty(); for (const plane of PLANES) out.planes[plane].files = FILES[plane].map(n => metadata(files[n])); return out; }
      const { authentication, ...body } = record;
      if (!authenticateJournalCut(record, internalToken)) return empty('capture_authentication_refused');
      if (body.namespace !== pinned.namespace || body.writerProcesses !== 1 || body.producer !== 'canonical_commerce_and_useful_result_journals'
        || !body.planes || !PLANES.every(p => body.planes[p]?.bounds && Array.isArray(body.planes[p].reasons))
        || !Number.isFinite(Date.parse(body.from)) || Date.parse(body.from) >= Date.parse(body.asOf) || Date.parse(body.asOf) > Date.now()) return empty('capture_provenance_refused');
      const out = finalize(body, files); out.cutId = body.cutId; return out;
    } catch (error) { const out = empty(error.code || 'cut_read_unknown'); out.rejected = 1; return out; }
    finally { if (pinned) await pinned.handle.close(); }
  });
}

export function verifiedCaptureFor(value) { return proofs.get(value) || null; }
export function bundleForTask(cut, taskRef, commerceEventId = null) {
  if (!/^t[a-f0-9]{62}$/.test(taskRef || '')) fail('task_rejected');
  const proof = proofs.get(cut);
  if (!proof || !cut.window) fail('unobserved_interval');
  const refs = cut.task_refs.filter(r => r.taskRef === taskRef && (!commerceEventId || r.commerceEventId === commerceEventId));
  if (commerceEventId && !refs.length) fail("counterfeit_link");
  const events = new Set(refs.map(r => r.commerceEventId));
  const cohorts = [...new Set(refs.map(r => r.cohort).filter(Boolean))];
  const scopeCohorts = cohorts.length ? cohorts : ['owner_qa', 'controlled_test', 'external_unknown', 'sponsored_trial'];
  const selected = {
    attempts: cut.attempts.filter(r => events.has(r.id)), task_refs: refs,
    forward: cut.forward.filter(r => events.has(r.commerceEventId)),
    // Include all owners of a selected record; filtering only by task hides an
    // ambiguous grant owner from the canonical projector.
    retention: cut.retention.filter(r => r.taskRef === taskRef || events.has(r.commerceEventId)),
    reads: [], settlements: cut.settlements.filter(r => events.has(r.sourceEventId)),
  };
  const recordIds = new Set(selected.retention.map(r => r.recordId));
  const grantIds = new Set(selected.retention.map(r => r.grantId));
  selected.retention = cut.retention.filter(r => selected.retention.includes(r) || recordIds.has(r.recordId) || grantIds.has(r.targetId));
  selected.reads = cut.reads.filter(r => r.taskRef === taskRef || recordIds.has(r.recordId));
  // Source kind is recorded capture provenance, never guessed from content or
  // a caller cohort. Observation classification remains in the causal rows.
  const kind = proof.runtime.entrypoint === 'server.js' ? 'supported_read_only_export' : 'synthetic_fixture';
  const populationId = 'attempt-useful-' + proof.sessionId.replaceAll('-', '');
  const sources = PLANES.map(plane => exportSource({ metadata: { id: 'cut-' + plane.replaceAll('_', '-'), plane, kind, populationId,
    scope: { operationIds: [OPERATION], cohorts: scopeCohorts, taskRefs: [taskRef] }, ...cut.window, coverage: cut.planes[plane].coverage },
    records: selected[plane], malformed: cut.planes[plane].reasons.includes('malformed_or_torn') ? 1 : 0 }));
  const bundle = { schema: BUNDLE_SCHEMA, question: { id: 'one-attempt', text: 'Which causal stages are established for this persisted task?', populationId,
    ...cut.window, operationIds: [OPERATION], cohorts: scopeCohorts, taskRefs: [taskRef] }, sources };
  // Preserve the paid consumer's sealed event owner alongside the existing
  // sanitized export. The frozen historical converter omits that field;
  // labels, digests and task refs alone cannot restore it.
  const paidRetention = selected.retention.flatMap(row => {
    const stripped = stripRecord(row, 'retention');
    return stripped?.schema === 'samedaydesk.task-demand.retention-export.v1' && row.action === 'retain'
      && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.commerceEventId || '')
      ? [{ ...stripped, commerceEventId: row.commerceEventId }] : [];
  });
  const sourceDeliveryAttribution = Object.fromEntries(selected.attempts.map(row => [row.id, sanitizeSettlementSourceDeliveryAttribution(row)]));
  proofs.set(bundle, { ...proof, planes: cut.planes, coverage: cut.coverage, paidRetention, sourceDeliveryAttribution });
  return bundle;
}
