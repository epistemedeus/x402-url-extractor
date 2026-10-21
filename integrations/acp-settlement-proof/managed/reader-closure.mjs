// Copy only production reader dependencies from the exact root-lock installation.
import fs from 'node:fs';
import path from 'node:path';
const lock = JSON.parse(fs.readFileSync('package-lock.json')).packages;
const destination = process.argv[2];
const seen = new Set();
function visit(name, from = '') {
  let scope = from; let key;
  while (true) {
    key = `${scope ? scope + '/' : ''}node_modules/${name}`;
    if (lock[key]) break;
    if (!scope) throw Error('Missing received dependency');
    scope = scope.includes('/node_modules/') ? scope.slice(0, scope.lastIndexOf('/node_modules/')) : '';
  }
  if (seen.has(key)) return; seen.add(key);
  fs.cpSync(key, path.join(destination, key), { recursive: true, dereference: false });
  for (const dependency of Object.keys(lock[key].dependencies ?? {})) visit(dependency, key);
}
visit('viem'); visit('zod');
console.log(JSON.stringify({ readerPackages: seen.size }));
