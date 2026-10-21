// Complete synthetic native-adapter receiving. Not a live loader or funding path.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initialize, serverStore, fund } from './operating-test-boundary.mjs';
const root = process.argv[2];
if (!root || !path.isAbsolute(root) || !root.startsWith('/tmp/root1652-') || fs.realpathSync(root) !== path.resolve(root) || (fs.statSync(root).mode & 0o077) || fs.statSync(root).uid !== process.getuid()) throw Error('Explicit owned private /tmp/root1652-* synthetic directory required');
if (!fs.existsSync(path.join(root, 'server'))) {
  if (fs.readdirSync(root).length) throw Error('Empty synthetic directory required on first use');
  initialize(root);
}
const exec = promisify(execFile);
const run = async () => JSON.parse((await exec(process.execPath, [fileURLToPath(new URL('./operating-process.mjs', import.meta.url)), root, 'native'], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=768' }, timeout: 30000, maxBuffer: 1048576 })).stdout);
await run();
if (serverStore(root)(data => data.job.jobStatus === 'OPEN')) fund(root);
const delivery = await run();
const reopened = await run();
if (delivery.state !== 'received' || JSON.stringify(delivery) !== JSON.stringify(reopened)) throw Error('Synthetic receiving/reopen failed');
const calls = serverStore(root)(data => data.calls);
if (calls.quotes !== 1 || calls.submits !== 1 || calls.receipt !== 1) throw Error('Synthetic dispatch count mismatch');
process.stdout.write(JSON.stringify({ mode: 'offline-synthetic-native-cli-adapter', boundary: 'no real auth, key, signature, network, job or funding', ...reopened, quoteCalls: calls.quotes, submitCalls: calls.submits, receiptCalls: calls.receipt }) + '\n');
