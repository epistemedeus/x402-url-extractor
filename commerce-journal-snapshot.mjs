// Bounded, descriptor-pinned observations of existing journals. No new store.
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const journalDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const JOURNAL_FILE_LIMIT = 16 * 1024 * 1024;
export async function pinDeliveryDirectory(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || path.normalize(dir) !== dir || dir.includes('\0')) throw Error('unsafe_directory');
  let prefix = path.parse(dir).root;
  for (const part of dir.slice(prefix.length).split('/').filter(Boolean)) {
    prefix = path.join(prefix, part);
    const entry = await lstat(prefix);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw Error('unsafe_directory');
  }
  const handle = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const info = await handle.stat();
  if (info.uid !== process.getuid()) { await handle.close(); throw Error('unowned_directory'); }
  return { handle, namespace: `${info.dev}:${info.ino}`, prefix: `/proc/self/fd/${handle.fd}/` };
}
export async function snapshotDeliveryFile(pinned, name) {
  let handle;
  try { handle = await open(pinned.prefix + name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { return { name, present: false, reason: error.code === 'ENOENT' ? null : 'unreadable_or_unsafe_file', bytes: null }; }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== process.getuid() || before.nlink !== 1 || (before.mode & 0o022)) return { name, present: true, reason: 'unsafe_file', bytes: null };
    if (before.size > JOURNAL_FILE_LIMIT) return { name, present: true, reason: 'file_limit_exceeded', bytes: null };
    const bytes = Buffer.alloc(before.size);
    let used = 0;
    while (used < bytes.length) {
      const read = await handle.read(bytes, used, bytes.length - used, used);
      if (!read.bytesRead) break;
      used += read.bytesRead;
    }
    const after = await handle.stat();
    if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) return { name, present: true, reason: 'concurrent_file_change', bytes: null };
    return { name, present: true, reason: null, identity: `${before.dev}:${before.ino}`, size: bytes.length, digest: journalDigest(bytes), bytes };
  } finally { await handle.close(); }
}
export function deliveryRecords(bytes) {
  if (!bytes.length) return { rows: [], reason: null };
  if (bytes.at(-1) !== 10) return { rows: [], reason: 'truncated_record' };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const rows = text.slice(0, -1).split('\n').map(line => JSON.parse(line));
    if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error();
    return { rows, reason: null };
  } catch { return { rows: [], reason: 'malformed_record' }; }
}
