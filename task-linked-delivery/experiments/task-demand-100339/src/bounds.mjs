import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const LIMITS = Object.freeze({ totalBytes: 2_097_152, fileBytes: 1_048_576,
  outputBytes: 1_048_576, rowBytes: 8192, rows: 4000, sources: 12,
  depth: 24, nodes: 60000, stringBytes: 8192, deadlineMs: 5000 });
export function fail(code) { const e = new Error(code); e.code = code; throw e; }
export function budget(ms = LIMITS.deadlineMs) {
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > 30000) fail('deadline_rejected');
  const end = performance.now() + ms;
  return () => { if (performance.now() >= end) fail('deadline_exceeded'); };
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function bytesDigest(value) { return createHash('sha256').update(value).digest('hex'); }

// Scan nesting before JSON.parse, so pathological depth never reaches the parser.
export function parseJson(bytes, tick = () => {}) {
  if (bytes.length > LIMITS.fileBytes) fail('input_bytes_exceeded');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    if ((i & 4095) === 0) tick();
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') { if (++depth > LIMITS.depth) fail('parse_depth_exceeded'); }
    else if (c === '}' || c === ']') depth--;
  }
  let value;
  try { value = JSON.parse(text); } catch { fail('invalid_json'); }
  checkTree(value, tick);
  return value;
}
export function checkTree(value, tick = () => {}) {
  const stack = [[value, 0, false]], active = new Set();
  let nodes = 0;
  while (stack.length) {
    tick();
    const [v, depth, leaving] = stack.pop();
    if (leaving) { active.delete(v); continue; }
    if (++nodes > LIMITS.nodes) fail('parse_nodes_exceeded');
    if (depth > LIMITS.depth) fail('parse_depth_exceeded');
    if (typeof v === 'string' && Buffer.byteLength(v) > LIMITS.stringBytes) fail('string_bytes_exceeded');
    if (v && typeof v === 'object') {
      if (active.has(v)) fail('cyclic_input');
      active.add(v); stack.push([v,depth,true]);
      for (const [k, child] of Object.entries(v)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') fail('unsafe_key');
        stack.push([child, depth + 1]);
      }
    }
  }
}
export async function readBounded(file, tick) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail('regular_file_required');
    if (before.size > LIMITS.fileBytes) fail('input_bytes_exceeded');
    const chunks = []; let total = 0;
    for (;;) {
      tick();
      const b = Buffer.alloc(16384);
      const { bytesRead } = await handle.read(b, 0, b.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > LIMITS.fileBytes) fail('input_bytes_exceeded');
      chunks.push(b.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('source_changed_during_read');
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}
export function outputJson(value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > LIMITS.outputBytes) fail('output_bytes_exceeded');
  return bytes;
}
