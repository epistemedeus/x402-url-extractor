// Materialize the already licensed, byte-identical public reader. No fork.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../olas-reader/reader-core');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'SOURCES.json')));
const files = ['extract.mjs', 'extract-capture.mjs', 'extract-excerpt-budget.mjs',
  'extract-batch-config.mjs', 'markdown-table.mjs', 'extract-batch-c1/url-guard.mjs',
  'extract-batch-c1/public-fetch.mjs', 'LICENSE'];
const received = [];
for (const name of files) {
  const entry = manifest.files.find(f => new URL(f.url).pathname.endsWith('/' + name));
  const bytes = fs.readFileSync(path.join(source, name));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (!entry || bytes.length !== entry.bytes || sha256 !== entry.sha256) throw Error('Reader source mismatch: ' + name);
  const dest = path.join(here, '.runtime/reader-core', name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  received.push({ path: name, ...entry });
}
const oldLock = JSON.parse(fs.readFileSync(path.join(source, 'package-lock.json')));
const lock = JSON.parse(fs.readFileSync(path.join(here, 'package-lock.json')));
for (const [key, value] of Object.entries(oldLock.packages)) {
  if (!key) continue;
  if (lock.packages[key]?.version !== value.version || lock.packages[key]?.integrity !== value.integrity) {
    throw Error('Reader dependency pin drift: ' + key);
  }
}
fs.writeFileSync(path.join(here, '.runtime/reader-core/SOURCES.json'), JSON.stringify({ ...manifest, files: received }, null, 2) + '\n');
console.log(JSON.stringify({ materializedModules: 7, source: manifest.commit, readerDependencyPinsVerified: 8 }));
