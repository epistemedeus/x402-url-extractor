// Ordinary caller-owned offline filter/manifest recipe. No execution service.
import { constants, openSync, closeSync, fstatSync, readSync, realpathSync,
  existsSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
export const RECIPE = '32267493d29ff1339c5199185d8231012daf0acd';
export const BLOB = '18dfbe6e4b7721bc13bb8fb788df92de0e454f92';
export const CAPS = Object.freeze({ maxInputs: 3, maxSnapshotBytes: 65536,
  maxAggregateBytes: 196608, maxAggregateRequests: 6, maxAggregatePages: 6,
  maxAggregateElapsedMs: 45000 });
const ACCEPTED = new Set(['accepted_rows', 'accepted_empty']);
const COMPLETE = new Set(['empty_board', 'complete_for_declared_total', 'complete_for_returned_listed_set']);
const GRAPH_PINS = Object.freeze({
  'LICENSE': '34e784554d75f424552ad2198708c8d99c5b4b67',
  'careers-board-config.mjs': '3769421ef7a85f01c5141c1c4ed55566db28d249',
  'recipes/careers-board/boards.mjs': BLOB,
  'recipes/careers-board/boards.public.test.mjs': 'ddf3161a5efa5c00c456c7f81e55e8444fdb2b8c',
  'recipes/careers-board/boards.root.test.mjs': '1ffa9128933b3502192a40b6edff363d93738a95',
  'recipes/careers-board/check-boards.mjs': '4de74a99b83bf35f5ffb084ae0b0b8d77aa46f4e',
  'recipes/careers-board/PUBLIC-RECIPE.md': '9272895d0aef0e315f82ac64fdd5bf19be5e5bac',
});
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = value => sha256(canonical(value));
function fail(code) { throw new Error(code); }
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const ident = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(v);
const date = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v));
const integer = (v, cap) => Number.isSafeInteger(v) && v >= 0 && v <= cap;

export function boundedRead(path, cap) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > cap) fail('oversize_or_nonfile');
    const buf = Buffer.alloc(cap + 1);
    let size = 0, n;
    while (size <= cap && (n = readSync(fd, buf, size, cap + 1 - size, null))) size += n;
    if (size > cap) fail('oversize_or_nonfile');
    return buf.subarray(0, size);
  } finally { closeSync(fd); }
}
function json(bytes) { try { return JSON.parse(bytes.toString('utf8')); } catch { fail('malformed_json'); } }
function contained(root, name) {
  if (typeof name !== 'string' || isAbsolute(name) || name.split(/[\\/]/).includes('..')) fail('unsafe_snapshot_path');
  const path = resolve(root, name), rel = relative(realpathSync(root), realpathSync(path));
  if (rel.startsWith('..') || isAbsolute(rel)) fail('unsafe_snapshot_path');
  return path;
}
export function verifyGraph(root = here) {
  const graph = json(boundedRead(resolve(root, 'GRAPH.json'), 16384));
  if (graph.acceptedRecipeCommit !== RECIPE || graph.base !== '82a51274e7dc7a7600b90f1317a6be6b28442592' || !Array.isArray(graph.externalPackages) || graph.externalPackages.length !== 0 || graph.license !== 'MIT' || !Array.isArray(graph.files) || graph.files.length !== 7) fail('graph_mismatch');
  const seen = new Set();
  for (const entry of graph.files) {
    if (seen.has(entry.sourcePath) || entry.path !== `acquired/${entry.sourcePath}` || GRAPH_PINS[entry.sourcePath] !== entry.gitBlob || entry.commit !== graph.base) fail('graph_mismatch');
    seen.add(entry.sourcePath);
    const bytes = boundedRead(contained(root, entry.path), 131072);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) fail('acquired_graph_changed');
    const gitBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (gitBlob !== entry.gitBlob) fail('acquired_graph_changed');
  }
  return graph;
}

function qualification(input) {
  return { callerId: input.callerId, taskId: input.taskId, inputId: input.inputId,
    source: input.source, predicate: input.predicate };
}
function validateInput(i) {
  if (!plain(i) || ![i.callerId, i.taskId, i.inputId].every(ident)) fail('invalid_identity');
  if (i.source?.recipeCommit !== RECIPE || i.source?.recipeBlob !== BLOB || !['acxiom', 'liverampAshby'].includes(i.source?.reader)) fail('source_requires_requalification');
  const p = i.predicate;
  if (!plain(p) || p.version !== 1 || typeof p.titleStartsWith !== 'string' || !p.titleStartsWith || p.titleStartsWith.length > 100 || typeof p.locationEquals !== 'string' || !p.locationEquals || p.locationEquals.length > 100 || canonical(p.requiredFields) !== canonical(['title', 'location', 'url', 'source', 'fetchedAt'])) fail('unsupported_predicate');
  const s = i.snapshot;
  if (!plain(s) || !Number.isSafeInteger(s.bytes) || s.bytes < 0 || !/^[a-f0-9]{64}$/.test(s.sha256) || !date(s.acquiredAt)) fail('invalid_snapshot_manifest');
  const a = s.acquisition;
  if (!plain(a) || !integer(a.requests, 6) || a.requests < 1 || !integer(a.pages, 4) || a.pages < 1 || !integer(a.elapsedMs, 15000) || a.network !== false || a.redirect !== 'manual' || a.maxResponseBytes !== 1000000 || a.timeoutMs !== 15000 || a.maxPages !== 4 || a.maxRequests !== 6) fail('acquisition_limits');
  if (i.freshnessNeed != null && (!ident(i.freshnessNeed.id) || !date(i.freshnessNeed.notBefore) || typeof i.freshnessNeed.reason !== 'string' || !i.freshnessNeed.reason.trim())) fail('invalid_need');
}
export function validateQueue(q) {
  if (!plain(q) || q.schemaVersion !== 1 || q.synthetic !== true || !ident(q.queueId) || !Array.isArray(q.inputs) || q.inputs.length > 6) fail('invalid_queue');
  if (q.support?.maxCorrectionRounds !== 1 || typeof q.support?.end !== 'string' || !q.support.end.trim()) fail('finite_support_required');
  for (const [key, cap] of Object.entries(CAPS)) if (!integer(q.limits?.[key], cap)) fail('queue_limits');
  const unique = new Map();
  for (const input of q.inputs) {
    validateInput(input);
    if (unique.has(input.inputId) && canonical(unique.get(input.inputId)) !== canonical(input)) fail('conflicting_input_identity');
    unique.set(input.inputId, input);
  }
  if (unique.size > q.limits.maxInputs) fail('input_limit');
  return [...unique.values()];
}

// Caller-held prior receipts are evidence to recheck, never action authority.
export function needDecision(input, previous) {
  if (!input.freshnessNeed) return 'unknown';
  if (Date.parse(input.snapshot.acquiredAt) < Date.parse(input.freshnessNeed.notBefore)) return 'unknown';
  if (previous && ACCEPTED.has(previous.status) && previous.accepted === true
      && previous.qualificationDigest === digest(qualification(input))) {
    const previousNeed = previous.lineage?.freshnessNeed;
    if (previousNeed?.id === input.freshnessNeed.id) {
      if (canonical(previousNeed) !== canonical(input.freshnessNeed)) fail('conflicting_freshness_need_identity');
      return 'not_yet_due';
    }
  }
  return 'due';
}
export function proposedPaidAction(proposal) {
  return { decision: proposal?.declined === true ? 'declined' : proposal?.acceptedTermsDigest !== proposal?.currentTermsDigest ? 'revalidate_terms' : 'outside_fixture_scope', paymentExecuted: false, renewed: false };
}
function checkSnapshot(s, input) {
  if (!plain(s) || s.synthetic !== true || s.acquiredAt !== input.snapshot.acquiredAt || canonical(s.acquisition) !== canonical(input.snapshot.acquisition)) fail('snapshot_lineage_mismatch');
  if (input.source.reader === 'acxiom') {
    if (!Array.isArray(s.data?.pages) || s.data.pages.length > 4 || s.data.pages.length < 1 || s.data.pages.length + (s.data.probe ? 1 : 0) !== s.acquisition.requests || s.data.pages.length !== s.acquisition.pages) fail('snapshot_request_coverage');
    for (const page of [...s.data.pages, ...(s.data.probe ? [s.data.probe] : [])]) if (Buffer.byteLength(JSON.stringify(page.body)) > 1000000) fail('response_byte_limit');
  } else if (s.acquisition.requests !== 1 || s.acquisition.pages !== 1 || !plain(s.data)) fail('snapshot_request_coverage');
}
function resultBase(input) {
  return { callerId: input.callerId, taskId: input.taskId, inputId: input.inputId,
    inputDigest: digest(input), qualificationDigest: digest(qualification(input)),
    lineage: { source: input.source, predicate: input.predicate,
      freshnessNeed: input.freshnessNeed ?? null, snapshot: input.snapshot },
    acquired: null, due: 'unknown', status: 'unavailable', accepted: false,
    rows: [], unknownRows: [], coverage: null, unresolvedReason: null,
    support: 'returned_to_caller', paymentExecuted: false, renewed: false };
}

export async function buildHandback(queuePath, { prior = null } = {}) {
  verifyGraph();
  const queueBytes = boundedRead(queuePath, 16384), q = json(queueBytes);
  const inputs = validateQueue(q), root = dirname(resolve(queuePath));
  const { BOARDS, normalizeAshby, normalizeWorkday } = await import('./acquired/recipes/careers-board/boards.mjs');
  const priorMap = new Map();
  if (prior) {
    if (!Array.isArray(prior.results) || prior.results.length > 3) fail('invalid_prior');
    for (const r of prior.results) {
      if (priorMap.has(r.inputId)) fail('duplicate_prior_result');
      const { receiptDigest, ...payload } = r;
      if (receiptDigest !== digest(payload)) fail('altered_prior_result');
      priorMap.set(r.inputId, r);
    }
  }
  const work = { bytes: 0, requests: 0, pages: 0, elapsedMs: 0, snapshotReads: 0 };
  const results = [];
  for (const input of inputs) {
    const r = resultBase(input), s = input.snapshot, a = s.acquisition;
    const exceeds = work.bytes + s.bytes > q.limits.maxAggregateBytes || s.bytes > q.limits.maxSnapshotBytes || work.requests + a.requests > q.limits.maxAggregateRequests || work.pages + a.pages > q.limits.maxAggregatePages || work.elapsedMs + a.elapsedMs > q.limits.maxAggregateElapsedMs;
    if (s.bytes > q.limits.maxSnapshotBytes) { r.unresolvedReason = 'snapshot_limit_exceeded'; }
    else if (exceeds) { r.unresolvedReason = 'aggregate_limit_exhausted'; }
    else {
      // Reserve finite work for every attempted acquisition, including failure.
      work.bytes += s.bytes; work.requests += a.requests; work.pages += a.pages; work.elapsedMs += a.elapsedMs; work.snapshotReads++;
      try {
        const bytes = boundedRead(contained(root, s.path), q.limits.maxSnapshotBytes);
        r.acquired = { bytes: bytes.length, sha256: sha256(bytes), verified: false };
        if (bytes.length !== s.bytes || sha256(bytes) !== s.sha256) fail('altered_snapshot_bytes');
        const snap = json(bytes); checkSnapshot(snap, input); r.acquired.verified = true;
        const board = BOARDS[input.source.reader];
        const ctx = { boardUrl: board.boardUrl, source: board.endpoint, fetchedAt: snap.acquiredAt };
        const normalized = input.source.reader === 'acxiom' ? normalizeWorkday(snap.data, ctx) : normalizeAshby(snap.data, ctx);
        r.coverage = normalized.coverage;
        for (const row of normalized.rows) {
          if (row.title.startsWith(input.predicate.titleStartsWith)) {
            if (row.location === null) r.unknownRows.push(row);
            else if (row.location === input.predicate.locationEquals) r.rows.push(row);
          }
        }
        r.due = needDecision(input, priorMap.get(input.inputId));
        if (r.due === 'unknown') { r.status = 'unknown'; r.unresolvedReason = !input.freshnessNeed ? 'missing_freshness_need' : 'freshness_floor_not_covered'; }
        else if (!COMPLETE.has(r.coverage.status) || r.unknownRows.length || r.coverage.missing?.length) {
          r.status = ['source_failure', 'wrong_schema'].includes(r.coverage.status) ? 'unavailable' : 'partial';
          r.unresolvedReason = r.status === 'unavailable' ? 'source_unavailable_or_wrong_schema' : 'incomplete_coverage_or_predicate_fields';
        } else { r.status = r.rows.length ? 'accepted_rows' : 'accepted_empty'; r.accepted = true; r.support = 'finite_answer_delivered'; }
      } catch (error) { r.unresolvedReason = error.code === 'ENOENT' ? 'snapshot_missing' : error.message; }
    }
    r.receiptDigest = digest(r); results.push(r);
  }
  return { schemaVersion: 1, synthetic: true, queueId: q.queueId,
    queueSha256: sha256(queueBytes), recipeCommit: RECIPE, results,
    summary: { uniqueInputs: inputs.length, duplicateQueueEntries: q.inputs.length - inputs.length,
      accepted: results.filter(r => r.accepted).length, unresolved: results.filter(r => !r.accepted).length,
      selectedRows: results.reduce((n, r) => n + r.rows.length, 0) },
    work, support: q.support, exit: 'finite_handback_complete', paymentExecuted: false, renewed: false };
}

export function writeHandback(path, handback, { interrupt = null, afterPrepare, afterCommit } = {}) {
  const bytes = `${JSON.stringify(handback, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > 262144) fail('oversize_handback');
  if (existsSync(path)) {
    const existing = boundedRead(path, 262144).toString('utf8');
    if (existing !== bytes) fail('conflicting_existing_handback');
    return 'existing_identical';
  }
  const temp = `${path}.pending-${process.pid}`;
  try {
    writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    const fd = openSync(temp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    afterPrepare?.();
    if (interrupt === 'before_rename') fail('synthetic_interruption_before_rename');
    // One caller-owned writer. No job ledger, append protocol or shared store.
    renameSync(temp, path);
    const dir = openSync(dirname(resolve(path)), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
    afterCommit?.();
    if (interrupt === 'after_rename') fail('synthetic_lost_response_after_rename');
    return 'written';
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [queue, output, ...extra] = process.argv.slice(2);
    if (!queue || !output || extra.length) fail('usage: node direct-handback.mjs QUEUE OUTPUT');
    const handback = await buildHandback(queue);
    const write = writeHandback(output, handback);
    console.log(JSON.stringify({ write, ...handback.summary, work: handback.work, exit: handback.exit }));
  } catch (error) { console.error(JSON.stringify({ error: error.message, paymentExecuted: false, renewed: false })); process.exitCode = 2; }
}
