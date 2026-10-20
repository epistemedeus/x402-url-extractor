import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createBoundary, initialServer } from './test-boundaries.mjs';

// Executable receiving entry point. All network/RPC/signing are sentinels;
// caller chooses disposable workspace. No live module/config loader exists.
export async function receiveOffline(directory, options = {}) {
  if (!path.isAbsolute(directory)) throw Error('Absolute disposable workspace required');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const serverDir = path.join(directory, 'fake-server');
  const journalDir = path.join(directory, 'delivery');
  fs.mkdirSync(serverDir, { recursive: true, mode: 0o700 });
  const serverFile = path.join(serverDir, 'server.json');
  try { fs.writeFileSync(serverFile, JSON.stringify(initialServer(options)), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const boundary = createBoundary(serverDir, journalDir);
  try { return await boundary.run(); } finally { boundary.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'acp-delivery-offline-'));
  const record = await receiveOffline(directory);
  process.stdout.write(`${JSON.stringify({ directory, state: record.state, artifactSha256: record.artifactSha256, binding: record.binding })}\n`);
}
