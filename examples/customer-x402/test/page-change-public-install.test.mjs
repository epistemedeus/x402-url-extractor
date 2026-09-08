import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('public example lockfile includes both documented command entrypoints', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  const normalize = bins => Object.fromEntries(Object.entries(bins).map(([name, value]) => [name, value.replace(/^\.\//, '')]));
  assert.deepEqual(normalize(lock.packages[''].bin), normalize(pkg.bin));
  assert.equal(pkg.private, true); // Supported distribution is the full public repository.
});
