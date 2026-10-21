// Offline process entry; does not expose native/live receiving.
import { createTestBoundary } from './operating-test-boundary.mjs';
import fs from 'node:fs';
import path from 'node:path';
const boundary = createTestBoundary(process.argv[2], { realCli: process.argv[3] === 'native' });
const [fault, phase, point, state] = (process.argv[4] ?? '').split(':');
const sync = fs.fsyncSync;
fs.fsyncSync = function(fd) {
  const stat = fs.fstatSync(fd);
  const filename = fs.readlinkSync(`/proc/self/fd/${fd}`);
  if (fault === 'fail' && point === 'file' && stat.isFile() && filename.includes('.delivery-') && JSON.parse(fs.readFileSync(filename)).schema === `acp-settlement-proof-${phase}/v1` && JSON.parse(fs.readFileSync(filename)).state === state) throw Error('Synthetic fsync refusal');
  const result = sync(fd);
  if (stat.isDirectory() && filename === path.join(process.argv[2], 'operations')) {
    const record = path.join(filename, `8453-123${phase === 'quote' ? '.quote' : ''}.json`);
    if (fs.existsSync(record) && JSON.parse(fs.readFileSync(record)).state === state) {
      if (fault === 'crash') process.exit(86);
      if (fault === 'fail' && point === 'directory') throw Error('Synthetic directory fsync refusal after rename');
    }
  }
  return result;
};
try { const record = await boundary.receiver.run('123'); process.stdout.write(JSON.stringify({ state: record.state, artifactSha256: record.artifactSha256 }) + '\n'); }
finally { fs.fsyncSync = sync; boundary.close(); }
