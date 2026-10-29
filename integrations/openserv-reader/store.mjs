// Local fixture continuity, deliberately separate from the unchanged reader record.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const fields = ['account', 'agentId', 'executionId', 'taskId', 'workspaceId'];
export function canonicalScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)
    || Object.keys(scope).sort().join() !== fields.join()
    || typeof scope.account !== 'string' || !scope.account
    || fields.slice(1).some(key => !Number.isSafeInteger(scope[key]) || scope[key] <= 0)) throw Error('invalid fixture scope');
  return Object.fromEntries(fields.map(key => [key, scope[key]]));
}
export const sameScope = (a, b) => JSON.stringify(canonicalScope(a)) === JSON.stringify(canonicalScope(b));
export class FixtureStore {
  constructor(directory, scope) {
    this.scope = Object.freeze(canonicalScope(scope));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const existing = [];
    // Preserve original filenames/bytes, including pre-canonical journals.
    for (const name of fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const file = path.join(directory, name);
      if (!fs.lstatSync(file).isFile()) throw Error('non-regular fixture journal');
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (sameScope(record.scope, this.scope)) existing.push(file);
    }
    if (existing.length > 1) throw Error('ambiguous original fixture scope');
    this.file = existing[0] || path.join(directory, createHash('sha256').update(JSON.stringify(this.scope)).digest('hex') + '.json');
  }
  read() { return fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : null; }
  write(record) {
    const tmp = this.file + '.tmp';
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
    const dir = fs.openSync(path.dirname(this.file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    return record;
  }
}
