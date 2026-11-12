#!/usr/bin/env node
// Cross-source eligibility comparer. Source-agnostic: it reads only the shared decision record keys
// (PR #151 format) and contains no provider-specific code. Pure functions, zero dependencies.
//
//   node compare.mjs [--now ISO] <decisions.json> [<decisions.json> ...]
// Each file holds one decision record, an array of records, or an object with a `decisions` array
// (the --open output of either checker). Output is JSON.
// Exit codes: 0 at least one eligible now, 1 none eligible now, 65 a record was refused, 64 usage.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const COMPARER = 'opportunity-eligibility-compare/0.1';
export const REQUIRED = Object.freeze({
  '': ['consumer', 'jobId', 'decidedAt', 'provenance', 'decision', 'reasons', 'freshness'],
  provenance: ['source', 'url', 'httpStatus', 'observedAt', 'bodySha256'],
  freshness: ['evidenceAgeSeconds', 'maxAgeSeconds', 'expiresAt'],
});
const DECISIONS = new Set(['eligible', 'not-eligible', 'unknown']);

// Returns a list of problems; empty means the record has every shared key with a usable type.
export function validate(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['not-an-object'];
  const out = [];
  for (const [section, keys] of Object.entries(REQUIRED)) {
    const obj = section ? r[section] : r;
    if (section && (!obj || typeof obj !== 'object')) { out.push(`missing:${section}`); continue; }
    for (const k of keys) if (!(k in obj)) out.push(`missing:${section ? section + '.' : ''}${k}`);
  }
  if (out.length) return out;
  if (!DECISIONS.has(r.decision)) out.push(`bad-decision:${r.decision}`);
  if (!Array.isArray(r.reasons)) out.push('bad-reasons');
  if (typeof r.provenance.source !== 'string' || !r.provenance.source) out.push('bad-provenance.source');
  if (r.jobId === null || r.jobId === undefined || r.jobId === '') out.push('bad-jobId');
  return out;
}

const age = (observedAt, now) => { const t = Date.parse(observedAt); return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null; };

// combine(records, { now }) -> { comparer, comparedAt, eligible, notEligible, unknown, refused, superseded, counts }
export function combine(records, { now = Date.now() } = {}) {
  const refused = [];
  const latest = new Map();
  const superseded = [];
  records.forEach((r, index) => {
    const problems = validate(r);
    if (problems.length) { refused.push({ index, jobId: r?.jobId ?? null, source: r?.provenance?.source ?? null, problems }); return; }
    const key = `${r.provenance.source}\u0000${r.jobId}`;
    const prev = latest.get(key);
    if (!prev) { latest.set(key, { r, index }); return; }
    const newer = (Date.parse(r.provenance.observedAt) || -Infinity) > (Date.parse(prev.r.provenance.observedAt) || -Infinity);
    const [keep, drop] = newer ? [{ r, index }, prev] : [prev, { r, index }];
    latest.set(key, keep);
    superseded.push({ index: drop.index, source: drop.r.provenance.source, jobId: drop.r.jobId, observedAt: drop.r.provenance.observedAt, by: keep.r.provenance.observedAt });
  });

  const eligible = [], notEligible = [], unknown = [];
  const counts = {};
  for (const { r, index } of latest.values()) {
    // Every verdict lapses when its evidence is older than its maxAgeSeconds. An eligible verdict
    // also lapses at its own expiresAt (which may be capped by a deadline), whichever is earlier;
    // an eligible verdict without a usable expiresAt falls back to the evidence-age limit alone.
    // A passed deadline caps eligibility but does not make a not-eligible verdict stale.
    const observedMs = Date.parse(r.provenance.observedAt);
    const maxAgeMs = Number(r.freshness.maxAgeSeconds) * 1000;
    const ageLimitMs = Number.isFinite(observedMs) && Number.isFinite(maxAgeMs) ? observedMs + maxAgeMs : NaN;
    const ownMs = Date.parse(r.freshness.expiresAt);
    const expiresMs = r.decision === 'eligible'
      ? (Number.isFinite(ownMs) && Number.isFinite(ageLimitMs) ? Math.min(ownMs, ageLimitMs) : (Number.isFinite(ageLimitMs) ? ageLimitMs : ownMs))
      : ageLimitMs;
    const entry = {
      index,
      source: r.provenance.source,
      jobId: r.jobId,
      decision: r.decision,
      reasons: [...r.reasons],
      url: r.provenance.url,
      httpStatus: r.provenance.httpStatus,
      observedAt: r.provenance.observedAt,
      bodySha256: r.provenance.bodySha256,
      evidenceAgeSeconds: age(r.provenance.observedAt, now),
      expiresAt: Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : r.freshness.expiresAt,
      sourceUrl: r.record?.sourceUrl ?? null,
    };
    if (r.decision !== 'unknown' && (!Number.isFinite(expiresMs) || now >= expiresMs)) {
      entry.decision = 'unknown';
      entry.reasons = [Number.isFinite(expiresMs) ? 'evidence-expired-at-compare' : 'expiry-missing-at-compare'];
      entry.previousDecision = r.decision;
    }
    (entry.decision === 'eligible' ? eligible : entry.decision === 'not-eligible' ? notEligible : unknown).push(entry);
    counts[entry.source] ??= { eligible: 0, 'not-eligible': 0, unknown: 0 };
    counts[entry.source][entry.decision]++;
  }
  const order = (a, b) => (a.evidenceAgeSeconds ?? Infinity) - (b.evidenceAgeSeconds ?? Infinity)
    || (Date.parse(a.expiresAt) || Infinity) - (Date.parse(b.expiresAt) || Infinity)
    || String(a.source).localeCompare(String(b.source)) || String(a.jobId).localeCompare(String(b.jobId));
  eligible.sort(order); notEligible.sort(order); unknown.sort(order);
  return { comparer: COMPARER, comparedAt: new Date(now).toISOString(), order: 'freshest evidence first, then soonest expiry', eligible, notEligible, unknown, refused, superseded, counts };
}

export function recordsFrom(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.decisions)) return parsed.decisions;
  return [parsed];
}

export function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  const args = [...argv];
  let now = Date.now();
  const i = args.indexOf('--now');
  if (i >= 0) { now = Date.parse(args[i + 1]); args.splice(i, 2); if (!Number.isFinite(now)) { io.err('--now must be ISO time\n'); return 64; } }
  if (!args.length) { io.err('usage: compare.mjs [--now ISO] <decisions.json> ...\n'); return 64; }
  let records = [];
  try { for (const f of args) records = records.concat(recordsFrom(JSON.parse(readFileSync(f, 'utf8')))); }
  catch (err) { io.err(`cannot read input: ${err.message}\n`); return 64; }
  const out = combine(records, { now });
  io.out(JSON.stringify(out, null, 2) + '\n');
  if (out.refused.length) return 65;
  return out.eligible.length ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
