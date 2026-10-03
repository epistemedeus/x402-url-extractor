#!/usr/bin/env node
// Operator readback only: existing enrolled authority, bounded reply, no retries.
import { REPORT_SCHEMA } from '../src/constants.mjs';
const taskRef = process.argv[2];
const start = taskRef === '--start';
const token = process.env.COMMERCE_INTERNAL_TOKEN;
const base = new URL(process.env.COMMERCE_BASE_URL || 'https://agents.samedaydesk.com');
if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || !(base.protocol === 'https:'
  || base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('service_origin_rejected');
if (typeof token !== 'string' || Buffer.byteLength(token) < 32) throw new Error('existing_enrolled_authority_required');
if (!start && !/^t[a-f0-9]{62}$/.test(taskRef || '')) throw new Error('task_ref_required');
const url = new URL('/.well-known/useful-result-reuse/current.json', base);
const cutIndex = process.argv.indexOf('--cut-id');
if (cutIndex !== -1) {
  const cutId = process.argv[cutIndex + 1];
  if (!/^[a-f0-9-]{36}$/.test(cutId || '') || start) throw new Error('cut_id_rejected');
  url.searchParams.set('cutId', cutId);
}
const headers = { 'x-samedaydesk-internal': token, 'x-samedaydesk-result-action': start ? 'start-attempt-capture' : 'read-attempt-cut' };
if (!start) headers['x-samedaydesk-outcome-task-ref'] = taskRef;
const eventIndex = process.argv.indexOf('--event');
if (eventIndex !== -1) {
  const id = process.argv[eventIndex + 1];
  if (!/^[a-f0-9-]{36}$/.test(id || '') || start) throw new Error('event_id_rejected');
  headers['x-samedaydesk-causal-attempt'] = id;
}
const response = await fetch(url, { method: start ? 'POST' : 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
const reader = response.body.getReader(), chunks = [];
let size = 0;
while (true) {
  const part = await reader.read(); if (part.done) break;
  size += part.value.length;
  if (size > 1_048_576) { await reader.cancel(); throw new Error('readback_limit_exceeded'); }
  chunks.push(Buffer.from(part.value));
}
const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
if (response.ok && (start ? report.captureStarted !== true || !report.cutId
  : report.schema !== REPORT_SCHEMA || report.taskRef !== taskRef)) throw new Error('native_readback_contract_absent');
process.stdout.write(JSON.stringify({ httpStatus: response.status, report }, null, 2) + '\n');
if (!response.ok) process.exitCode = 2;
