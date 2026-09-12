import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { compilePortableEvidence, readRunDirectory, readBoundedJson, validateFeedback } from '../src/index.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SAMPLE = join(ROOT, 'fixtures/sample');
const CLI = join(ROOT, 'bin/cli.mjs');
const subprocess = args => spawnSync(process.execPath, [CLI, ...args], {encoding:'utf8', timeout:10000, maxBuffer:1_000_000,
  env:{...process.env, NODE_OPTIONS:'--max-old-space-size=768'}});
function temporary(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw18-boundaries-'));
  try { return fn(dir); } finally { rmSync(dir, {recursive:true,force:true}); }
}

test('library cannot compile hand-edited eligible records or arbitrary payload fields', () => {
  const record = readRunDirectory(SAMPLE);
  assert.throws(() => compilePortableEvidence([{ ...record, privateBody:'secret', eligibleEvidence:true }]), /immutable joined/);
  assert.throws(() => { record.serverContract.validated = false; }, TypeError);
  assert.throws(() => { record.buyerAttestation.authority = 'verified'; }, TypeError);
  assert.equal('key' in record.settlement, false);
  assert.equal('transactionKey' in record.settlement, false);
  assert.equal(compilePortableEvidence([record]).summary.eligible, 1);
});

test('file reader rejects symlinks including a directory component', () => temporary(dir => {
  writeFileSync(join(dir,'target.json'),'{}');
  symlinkSync(join(dir,'target.json'),join(dir,'link.json'));
  assert.throws(() => readBoundedJson(join(dir,'link.json')), error => error.code === 'ELOOP');
  symlinkSync(dir,join(dir,'directory'));
  assert.throws(() => readBoundedJson(join(dir,'directory','target.json')), error => error.code === 'unsafe_input');
}));

test('file reader rejects oversized bytes, invalid UTF8, malformed JSON, directories and FIFOs', () => temporary(dir => {
  writeFileSync(join(dir,'oversize.json'),' '.repeat(1_000_001));
  assert.throws(() => readBoundedJson(join(dir,'oversize.json')), error => error.code === 'oversized_input');
  writeFileSync(join(dir,'invalid.json'),Buffer.from([0x22,0xff,0x22]));
  assert.throws(() => readBoundedJson(join(dir,'invalid.json')), error => error.code === 'malformed_json');
  writeFileSync(join(dir,'syntax.json'),'{bad');
  assert.throws(() => readBoundedJson(join(dir,'syntax.json')), error => error.code === 'malformed_json');
  assert.throws(() => readBoundedJson(dir), error => error.code === 'unsafe_input');
  const fifo = join(dir,'pipe');
  assert.equal(spawnSync('mkfifo',[fifo]).status,0);
  assert.throws(() => readBoundedJson(fifo), error => error.code === 'unsafe_input');
}));

test('exclusive CLI exports have private permissions and refuse overwrite or symlink targets', () => temporary(dir => {
  const output = join(dir,'export.json');
  assert.equal(subprocess(['--run',SAMPLE,'--output',output]).status,0);
  assert.equal(statSync(output).mode & 0o777,0o600);
  assert.equal(subprocess(['--run',SAMPLE,'--output',output]).status,2);
  const link = join(dir,'link.json'); symlinkSync(output,link);
  assert.equal(subprocess(['--run',SAMPLE,'--output',link]).status,2);
}));

test('CLI rejects duplicate singleton options and excessive run count before reading files', () => {
  const result = subprocess(['--run',SAMPLE,'--output','SECRET_CW18','--output','other']);
  assert.equal(result.status,2);
  assert.equal(result.stderr.includes('SECRET_CW18'),false);
  const excessive = subprocess(Array.from({length:101},()=>['--run','/missing-SECRET_CW18']).flat());
  assert.equal(excessive.status,2);
  assert.equal(excessive.stderr.includes('SECRET_CW18'),false);
});

test('feedback calendar and schema validation cannot inject business claims', () => {
  const feedback = readBoundedJson(join(SAMPLE,'feedback.json'));
  assert.throws(() => validateFeedback({...feedback,recordedAt:'2026-02-30T00:00:00Z'}));
  assert.throws(() => validateFeedback({...feedback,revenue:123}));
  assert.throws(() => validateFeedback({...feedback,organicUse:true}));
  assert.throws(() => validateFeedback({...feedback,evidenceId:'unknown'}));
});
