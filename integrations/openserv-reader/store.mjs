// Local fixture continuity, deliberately separate from the unchanged reader record.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export class FixtureStore {
  constructor(directory, scope) {
    this.scope = Object.freeze({ ...scope });
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, createHash('sha256').update(JSON.stringify(scope)).digest('hex') + '.json');
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
