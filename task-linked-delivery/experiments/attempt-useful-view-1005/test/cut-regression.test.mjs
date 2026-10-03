import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readBoundedCut, bundleForTask } from '../src/cut.mjs';

test('missing all six planes cannot be a completed journal cut', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cut-absent-'));
  try { assert.equal((await readBoundedCut(dir)).coverage, 'unknown'); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
test('an unobserved cut cannot invent a current or future covered window', () => {
  assert.throws(() => bundleForTask({ coverage: 'unknown' }, `t${'ab'.repeat(31)}`), /unobserved_interval/);
});
test('a named cohort cannot promote an unproved cut to a supported native export', () => {
  assert.throws(() => bundleForTask({ coverage: 'complete', attempts: [], task_refs: [], forward: [], retention: [], reads: [], settlements: [] }, `t${'ab'.repeat(31)}`), /unobserved_interval/);
});
