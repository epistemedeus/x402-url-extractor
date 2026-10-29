// Finite installed consumer. Only explicit files and this profile's dependencies travel.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Verify the actual installed profile and materialized core before copying it.
const sourceManifest = JSON.parse(fs.readFileSync(path.join(here, 'upstream/reader-SOURCES.json')));
for (const entry of sourceManifest.files) {
  const url = new URL(entry.url);
  const relative = url.pathname.split('/' + sourceManifest.commit + '/')[1];
  const bytes = fs.readFileSync(path.join(here, '.runtime/reader-core', relative));
  if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error('materialized source mismatch: ' + relative);
}
const lock = JSON.parse(fs.readFileSync(path.join(here, 'package-lock.json')));
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location) continue;
  const installed = JSON.parse(fs.readFileSync(path.join(here, location, 'package.json')));
  if (installed.version !== entry.version) throw Error('installed version mismatch: ' + location);
}
const sdkReceipt = JSON.parse(fs.readFileSync(path.join(here, 'evidence/sdk-installed.json')));
for (const entry of sdkReceipt.files) {
  const bytes = fs.readFileSync(path.join(here, 'node_modules/@openserv-labs/sdk', entry.path));
  if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error('installed SDK archive mismatch: ' + entry.path);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'root55500-installed-'));
const files = ['adapter.mjs', 'store.mjs', 'reader-child.mjs', 'reader-process.mjs', 'fixtures.mjs',
  'fixture-preload.mjs', 'network-guard.mjs', 'consumer.test.mjs', 'safety.test.mjs', 'package.json', 'package-lock.json'];
const home = path.join(temp, 'home'); fs.mkdirSync(home);
for (const file of files) fs.copyFileSync(path.join(here, file), path.join(temp, file));
fs.cpSync(path.join(here, '.runtime'), path.join(temp, '.runtime'), { recursive: true });
fs.cpSync(path.join(here, 'node_modules'), path.join(temp, 'node_modules'), { recursive: true });
function snapshot(dir, prefix = '') {
  const result = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + item.name; const full = path.join(dir, item.name);
    if (item.isDirectory()) result.push(...snapshot(full, name + '/'));
    else if (item.isSymbolicLink()) result.push({ path: name, link: fs.readlinkSync(full) });
    else { const bytes = fs.readFileSync(full); result.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
  }
  return result;
}
const before = [...snapshot(path.join(temp, 'node_modules'), 'node_modules/'), ...snapshot(path.join(temp, '.runtime'), '.runtime/')];
const log = fs.openSync(path.join(here, 'evidence/final.tap'), 'w');
fs.rmSync(path.join(here, 'evidence/proof.json'), { force: true });
const startedAt = new Date().toISOString();
const child = spawn(process.execPath, ['--import', './network-guard.mjs', '--test', '--test-concurrency=1', 'consumer.test.mjs', 'safety.test.mjs'],
  { cwd: temp, detached: true, env: { HOME: home, TMPDIR: home, NODE_ENV: 'production', LOG_LEVEL: 'silent' }, stdio: ['ignore', 'pipe', 'pipe'] });
let running = true; let interrupted = false;
const stop = () => { interrupted = true; if (running) { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { fs.writeSync(log, b); process.stdout.write(b); });
const code = await new Promise(resolve => child.once('close', resolve)); running = false;
process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); fs.closeSync(log);
const after = [...snapshot(path.join(temp, 'node_modules'), 'node_modules/'), ...snapshot(path.join(temp, '.runtime'), '.runtime/')];
const unchanged = JSON.stringify(before) === JSON.stringify(after);
fs.writeFileSync(path.join(here, 'evidence/installed-files.json'), JSON.stringify(before, null, 2) + '\n');
fs.writeFileSync(path.join(here, 'evidence/installed-consumer.json'), JSON.stringify({ startedAt, endedAt: new Date().toISOString(),
  runtime: process.version, platform: process.platform, arch: process.arch, cwdIsolatedFromCheckout: true,
  homeAndEnvIsolated: true, borrowedRootDependencies: false, dependencyAndCoreFiles: before.length,
  installedUnchanged: unchanged, packageVersionsVerified: Object.keys(lock.packages).length - 1,
  readerModulesRawVerified: 7, sdkArchiveFilesRawVerified: sdkReceipt.files.length,
  exitCode: code, command: 'node --import ./network-guard.mjs --test --test-concurrency=1 consumer.test.mjs safety.test.mjs' }, null, 2) + '\n');
if (fs.existsSync(path.join(temp, 'proof.json'))) fs.copyFileSync(path.join(temp, 'proof.json'), path.join(here, 'evidence/proof.json'));
fs.rmSync(temp, { recursive: true, force: true });
if (!unchanged || code !== 0) process.exitCode = interrupted ? 130 : 1;
