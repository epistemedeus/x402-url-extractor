import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { withDirectoryLock } from '../../experiments/scoped-surface-delivery-100312/src/lock.mjs';

// Explicit operation retention, not an ACP account, entitlement or money ledger.
// Reuse the existing Linux directory-inode flock. Atomic replace plus file AND
// directory fsync extends the experiment's rename-only crash contract here.
export function openDeliveryJournal(directory, { phase = 'delivery' } = {}) {
  if (!['delivery', 'quote'].includes(phase)) throw Error('Unsupported operation phase');
  const schema = `acp-settlement-proof-${phase}/v1`;
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw Error('Absolute declared journal directory required');
  // Parent storage is explicitly provisioned by the owner. Sync its directory
  // entry even when another opener created this directory, before any dispatch.
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (fs.realpathSync(directory) !== path.resolve(directory) || !fs.lstatSync(directory).isDirectory()) throw Error('Journal must be a real directory');
  const owner = fs.statSync(directory);
  if (owner.uid !== process.getuid() || (owner.mode & 0o077) !== 0) throw Error('Journal directory must be private and process-owned');
  const dir = fs.realpathSync(directory);
  const parent = fs.openSync(path.dirname(dir), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  function fileFor(key) {
    const match = /^acp:8453:([1-9][0-9]*)$/.exec(key);
    if (!match || match[1].length > 78) throw Error('Invalid operation key');
    return path.join(dir, `8453-${match[1]}${phase === 'quote' ? '.quote' : ''}.json`);
  }
  function read(file) {
    let fd;
    try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('Invalid retained operation file');
      const data = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (!data || data.schema !== schema) throw Error('Invalid retained operation');
      return data;
    } finally { fs.closeSync(fd); }
  }
  function write(file, record) {
    const bytes = JSON.stringify(record);
    if (Buffer.byteLength(bytes) > 1024 * 1024) throw Error('Operation exceeds journal bound');
    const temporary = path.join(dir, `.delivery-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, file);
      const parent = fs.openSync(dir, 'r');
      try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return Object.freeze({
    read(key) { return withDirectoryLock(dir, () => read(fileFor(key))); },
    compareAndSet(key, expected, next) {
      return withDirectoryLock(dir, () => {
        const file = fileFor(key);
        const current = read(file);
        if (!isDeepStrictEqual(current, expected)) return false;
        if (next?.schema !== schema) throw Error('Invalid operation schema');
        if (current === null) {
          if (next.state !== 'prepared' || next.binding?.jobId !== key.split(':')[2]) throw Error('Invalid operation preparation');
        } else {
          const { state: oldState, ...oldBody } = current;
          const { state: nextState, ...nextBody } = next;
          if (!isDeepStrictEqual(oldBody, nextBody) || !((oldState === 'prepared' && nextState === 'sent_unknown') || (oldState === 'sent_unknown' && nextState === 'received'))) throw Error('Invalid operation transition');
        }
        write(file, next);
        return true;
      });
    },
  });
}
