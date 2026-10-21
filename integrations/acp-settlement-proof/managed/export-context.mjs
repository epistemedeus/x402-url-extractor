// Allowlists source from this checkout. Never copies credentials or node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.argv[2];
if (!output || !path.isAbsolute(output) || fs.existsSync(output)) throw Error('New absolute context directory required');
const files = ['LICENSE', '.npmrc', 'package.json', 'package-lock.json', 'settlement-proof.mjs', 'experiments/scoped-surface-delivery-100312/src/lock.mjs'];
for (const name of ['start', 'worker', 'operating', 'configured', 'fulfill', 'journal', 'native-boundary', 'native-process', 'native-network-preload']) files.push(`integrations/acp-settlement-proof/${name}.mjs`);
for (const name of ['package.json', 'package-lock.json', 'worker.example.json']) files.push(`integrations/acp-settlement-proof/runtime/${name}`);
for (const name of ['entry.mjs', 'store.mjs', 'identity.mjs', 'reader-closure.mjs', 'Dockerfile', 'Dockerfile.dockerignore', 'railway.json']) files.push(`integrations/acp-settlement-proof/managed/${name}`);
function collect(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (['node_modules', '.git', 'test'].includes(entry.name) || entry.name.startsWith('.env')) continue;
    const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) collect(name); else if (entry.isFile()) files.push(name); else throw Error('Unexpected vendor symlink');
  }
}
collect('vendor/task-discoverability');
fs.mkdirSync(output, { mode: 0o700 });
const hashes = {};
for (const relative of files.sort()) {
  const source = path.join(root, relative);
  if (!fs.lstatSync(source).isFile()) throw Error('Only regular source files admitted');
  const target = path.join(output, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target); hashes[relative] = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
}
fs.copyFileSync(path.join(root, 'integrations/acp-settlement-proof/managed/railway.json'), path.join(output, 'railway.json'));
hashes['railway.json'] = createHash('sha256').update(fs.readFileSync(path.join(output, 'railway.json'))).digest('hex');
fs.writeFileSync(path.join(output, 'source-identity.json'), JSON.stringify({ schema: 'acp-managed-source/v1', hashes }, null, 2));
console.log(JSON.stringify({ context: output, files: Object.keys(hashes).length, identitySha256: createHash('sha256').update(fs.readFileSync(path.join(output, 'source-identity.json'))).digest('hex') }));
