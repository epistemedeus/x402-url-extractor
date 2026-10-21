import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeStore, privateFile } from './store.mjs';
import { command, enrollmentArgs } from './entry.mjs';
const entry = fileURLToPath(new URL('./entry.mjs', import.meta.url));
function scratch(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-managed-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function launch(dir, args, extra = {}) {
  const child = spawn(process.execPath, [...(extra.nodeArgs ?? []), entry, ...args], { env: { PATH: process.env.PATH, ACP_DATA_DIR: dir, NODE_OPTIONS: '--max-old-space-size=768', ...extra.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const done = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, done };
}
test('first boot/reopen preserves private identity and unknown operations', t => {
  const dir = scratch(t); const a = initializeStore(dir);
  fs.writeFileSync(path.join(a.operations, '8453-1.quote.json'), '{"state":"sent_unknown"}', { mode: 0o600 });
  fs.writeFileSync(path.join(a.profile, 'config.json'), '{"synthetic":true}', { mode: 0o600 });
  assert.deepEqual(initializeStore(dir), a);
  assert.equal(fs.readFileSync(path.join(a.operations, '8453-1.quote.json'), 'utf8'), '{"state":"sent_unknown"}');
  for (const name of ['home', 'profile', 'empty', 'operations']) assert.equal(fs.statSync(a[name]).mode & 0o777, 0o700);
});
test('refuses unknown nonempty volume before initialization', t => { const dir = scratch(t); fs.writeFileSync(path.join(dir, 'foreign'), 'keep'); assert.throws(() => initializeStore(dir)); assert.equal(fs.readFileSync(path.join(dir, 'foreign'), 'utf8'), 'keep'); });
test('refuses volume and store symlinks', t => {
  const parent = scratch(t); const dir = path.join(parent, 'real'); fs.mkdirSync(dir, { mode: 0o700 }); fs.symlinkSync(dir, path.join(parent, 'link')); assert.throws(() => initializeStore(path.join(parent, 'link')));
  const s = initializeStore(dir); fs.rmdirSync(s.profile); fs.symlinkSync(s.home, s.profile); assert.throws(() => initializeStore(dir));
});
test('refuses wrong ownership or public permissions without changing contents', t => { const dir = scratch(t); assert.throws(() => initializeStore(dir, { uid: process.getuid() + 1 })); fs.chmodSync(dir, 0o755); assert.throws(() => initializeStore(dir)); assert.equal(fs.statSync(dir).mode & 0o777, 0o755); });
test('refuses marker identity drift and nonempty native cwd', t => { const dir = scratch(t); const s = initializeStore(dir); assert.throws(() => initializeStore(dir, { gid: process.getgid() + 1 })); fs.writeFileSync(path.join(s.empty, 'unexpected'), 'keep'); assert.throws(() => initializeStore(dir)); });
test('safe default and strict finite/authority parsing', () => {
  assert.deepEqual(command([]), { mode: 'receive' });
  for (const args of [['serve', '--once'], ['enrollment-hold', '901'], ['enrollment-hold', '0'], ['observe', 'extra'], ['cli', 'wallet', 'create']]) assert.throws(() => command(args));
  assert.equal(command(['enrollment-hold', '1']).seconds, 1);
  assert.throws(() => enrollmentArgs(['agent', 'add-signer', '--agent-id', 'other', '--policy', 'unrestricted', '--no-wait']));
});
test('actual credential-free entry imports production closure and reopens stable store', async t => {
  const dir = scratch(t);
  const a = await launch(dir, []).done; assert.equal(a.code, 0, a.stderr);
  const b = await launch(dir, ['receive'], { env: { HOME: '/wrong', ACP_CONFIG_DIR: '/wrong' } }).done; assert.equal(b.code, 0, b.stderr);
  assert.deepEqual(JSON.parse(a.stdout), JSON.parse(b.stdout)); assert.equal(JSON.parse(b.stdout).effects, false);
  assert.equal(JSON.parse(b.stdout).home, path.join(dir, 'home'));
});
test('actual observe and serve refuse missing auth before network/effects', async t => {
  const dir = scratch(t); initializeStore(dir);
  const template = JSON.parse(fs.readFileSync(new URL('../runtime/worker.example.json', import.meta.url)));
  Object.assign(template, { configDirectory: path.join(dir, 'profile'), workingDirectory: path.join(dir, 'empty'), journalDirectory: path.join(dir, 'operations'), signerId: 'synthetic-only' });
  fs.writeFileSync(path.join(dir, 'worker.json'), JSON.stringify(template), { mode: 0o600 });
  for (const mode of ['observe', 'serve']) { const r = await launch(dir, [mode]).done; assert.equal(r.code, 1); assert.match(r.stdout, /worker_refused_or_interrupted/); }
  assert.deepEqual(fs.readdirSync(path.join(dir, 'operations')), []);
});
test('actual enrollment hold expires and SIGTERM exits promptly', async t => {
  const dir = scratch(t); const began = Date.now(); const a = await launch(dir, ['enrollment-hold', '1']).done;
  assert.equal(a.code, 0); assert.ok(Date.now() - began < 3000);
  const run = launch(dir, ['enrollment-hold', '900']);
  await new Promise(resolve => run.child.stdout.once('data', resolve)); run.child.kill('SIGTERM');
  const b = await run.done; assert.equal(b.code, 0); assert.equal(b.signal, null);
});
test('private config rejects symlink and broad file permissions', t => { const dir = scratch(t); const file = path.join(dir, 'config'); fs.writeFileSync(file, '{}', { mode: 0o644 }); fs.chmodSync(file, 0o644); assert.throws(() => privateFile(file, process.getuid())); fs.chmodSync(file, 0o600); fs.symlinkSync(file, path.join(dir, 'link')); assert.throws(() => privateFile(path.join(dir, 'link'), process.getuid())); });
