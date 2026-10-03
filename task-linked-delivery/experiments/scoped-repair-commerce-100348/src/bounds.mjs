import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createOperationBudget } from '../../../../experiments/scoped-surface-delivery-100312/src/budget.mjs';
import { parseJson } from '../../task-demand-100339/src/bounds.mjs';

export const HARD = Object.freeze({ deadlineMs: 5000, maxInputBytes: 524288, maxReadBytes: 2097152, maxOutputBytes: 16384, maxChildren: 8 });
export function fail(code) { throw Object.assign(new Error(code), { code }); }
export function allowance(limits = HARD) {
  const started = performance.now();
  const kernel = createOperationBudget({ deadlineMs: HARD.deadlineMs, maxOutputBytes: HARD.maxOutputBytes });
  const caps = { ...HARD }; let reads = 0, input = 0;
  const self = {
    restrict(next = {}) {
      for (const k of Object.keys(HARD)) {
        if (next[k] === undefined) continue;
        if (!Number.isInteger(next[k]) || next[k] < (k === 'maxChildren' ? 1 : k === 'deadlineMs' ? 20 : 1024) || next[k] > HARD[k]) fail('limits_invalid');
        caps[k] = Math.min(caps[k], next[k]);
      }
      self.check();
    },
    remainingMs: () => Math.max(0, Math.min(kernel.remainingMs(), caps.deadlineMs - (performance.now() - started))),
    remainingOutput: () => Math.max(0, Math.min(kernel.remainingOutput(), caps.maxOutputBytes - kernel.snapshot().outputUsed)),
    check() { if (self.remainingMs() <= 0) fail('deadline_exceeded'); if (reads > caps.maxReadBytes || input > caps.maxInputBytes) fail('input_bytes_exceeded'); },
    read(bytes, caller = false) { reads += bytes; if (caller) input += bytes; self.check(); },
    chargeOutput(bytes) { if (bytes > self.remainingOutput()) fail('output_bytes_exceeded'); kernel.chargeOutput(bytes); self.check(); },
    noteSpawn() { if (kernel.snapshot().spawns >= caps.maxChildren) fail('child_limit_exceeded'); kernel.noteSpawn(); self.check(); },
    async wait(promise, cancel = () => {}) {
      self.check(); let timer;
      try {
        const result = await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { cancel(); reject(Object.assign(new Error('deadline_exceeded'), { code: 'deadline_exceeded' })); }, Math.max(1, self.remainingMs())); })]);
        self.check(); return result;
      } finally { clearTimeout(timer); }
    },
    snapshot: () => ({ ...kernel.snapshot(), caps: { ...caps }, readBytes: reads, inputBytes: input, elapsedMs: Math.round((performance.now() - started) * 1000) / 1000 }),
  };
  self.restrict(limits); return self;
}

export async function streamJson(stream, budget, caller = true) {
  const chunks = [];
  await budget.wait(new Promise((resolve, reject) => {
    const clean = () => { stream.off('data', data); stream.off('end', end); stream.off('error', error); stream.off('aborted', aborted); };
    const error = e => { clean(); reject(e); };
    const aborted = () => error(Object.assign(new Error('input_aborted'), { code: 'input_aborted' }));
    const data = bytes => { try { budget.read(bytes.length, caller); chunks.push(bytes); } catch (e) { error(e); stream.pause(); } };
    const end = () => { clean(); resolve(); };
    stream.on('data', data); stream.once('end', end); stream.once('error', error); stream.once('aborted', aborted);
  }), () => stream.destroy());
  return parseJson(Buffer.concat(chunks), () => budget.check());
}

export async function fileJson(file, budget) {
  if (file === '-') return streamJson(process.stdin, budget);
  const handle = await budget.wait(open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW));
  try {
    const stat = await budget.wait(handle.stat());
    if (!stat.isFile()) fail('regular_file_required');
    if (stat.size > HARD.maxInputBytes) fail('input_bytes_exceeded');
    const chunks = []; let offset = 0;
    while (true) {
      const bytes = Buffer.alloc(16384);
      const { bytesRead } = await budget.wait(handle.read(bytes, 0, bytes.length, offset));
      if (!bytesRead) break;
      offset += bytesRead; budget.read(bytesRead, true); chunks.push(bytes.subarray(0, bytesRead));
    }
    return parseJson(Buffer.concat(chunks), () => budget.check());
  } finally { await handle.close(); }
}

export function encode(value, budget) { const bytes = Buffer.from(JSON.stringify(value) + '\n'); budget.chargeOutput(bytes.length); return bytes; }
export async function writeJson(value, stream, budget) {
  const bytes = encode(value, budget);
  await budget.wait(new Promise((resolve, reject) => { stream.write(bytes, error => error ? reject(error) : resolve()); }), () => stream.destroy());
}
