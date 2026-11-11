import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const pins = [
  { pin: 'ac827993c8cecbeb48e8c85a3cc8a2330caf252d', equivalence: 'equivalence-baseline', resourceBlob: '50d279215ad780094d6444780c9baf6290db872c' },
  { pin: '986e06fa4fe761207044697c2e53b02b1ed4795e', equivalence: 'equivalence-fixed', resourceBlob: '8f3eecd7bea3aacbf36fb44c25b77ce93e18644a' },
];
const sourceNames = ['check.ts', 'resource-binding-check.ts'];
const observed = [];
for (const item of pins) {
  const dir = path.join(process.cwd(), item.pin);
  fs.mkdirSync(dir);
  const files = [];
  for (const name of sourceNames) {
    const url = `https://raw.githubusercontent.com/holistis/tokenizen/${item.pin}/packages/x402-lint/src/${name}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, `${item.pin}/${name}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 0 && bytes.length < 50000, 'bounded source');
    const blob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(blob, name === 'check.ts' ? 'e0c7d16bf36b5d89af31fd9faa76023fb0160995' : item.resourceBlob, 'exact upstream Git object');
    fs.writeFileSync(path.join(dir, name), bytes, { flag: 'wx' });
    files.push({ name, bytes: bytes.length, gitBlob: blob });
  }
  for (const mode of ['candidate', item.equivalence]) {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', path.join(import.meta.dirname, 'replay.mjs'), dir, mode], {
      encoding: 'utf8', timeout: 30000,
      env: { PATH: process.env.PATH, HOME: process.cwd() },
    });
    process.stdout.write(child.stdout ?? '');
    process.stderr.write(child.stderr ?? '');
    assert.equal(child.signal, null, `${mode} terminated`);
    assert.equal(child.status, 0, `${item.pin} ${mode}`);
    const rows = child.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    assert.equal(rows.length, mode === 'candidate' ? 7 : 3);
    observed.push({ pin: item.pin, mode, files, node: process.version, exit: child.status, cases: rows });
  }
}
console.log('RECEIVING_JSON_BEGIN');
console.log(JSON.stringify({ schema: 'pilot.resource-binding-receiving.v1', at: new Date().toISOString(), observed, paymentCalls: 0, liveSellerCalls: 0 }));
console.log('RECEIVING_JSON_END');
