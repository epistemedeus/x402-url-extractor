import fs from 'node:fs';
import path from 'node:path';
import { createBoundary, KEY } from './test-boundaries.mjs';

const [directory, fault] = process.argv.slice(2);
const h = createBoundary(path.join(directory, 'fake-server'), path.join(directory, 'delivery'));
const sync = fs.fsyncSync;
fs.fsyncSync = function(fd) {
  const entry = fs.fstatSync(fd);
  if (fault === 'fail-marker' && entry.isFile()) {
    const name = fs.readlinkSync(`/proc/self/fd/${fd}`);
    if (name.includes('.delivery-') && JSON.parse(fs.readFileSync(name)).state === 'sent_unknown') throw Error('injected marker fsync failure');
  }
  const result = sync(fd);
  if (fault === 'crash-after-marker' && entry.isDirectory()) {
    // This is after BOTH the file sync and atomic rename + directory sync.
    const file = path.join(directory, 'delivery', '8453-123.json');
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file)).state === 'sent_unknown') process.exit(86);
  }
  return result;
};
try {
  const record = await h.run();
  process.stdout.write(JSON.stringify({ state: record.state, artifactSha256: record.artifactSha256, key: KEY }));
} finally { fs.fsyncSync = sync; h.close(); }
