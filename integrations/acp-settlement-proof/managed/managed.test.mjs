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

test('fixed worker configuration is explicit, durable and never overwrites a changed configuration', async t => {
  const dir = scratch(t);
  const args = ['configure-worker', '--signer-id', 'DISPOSABLE_TEST_ID', '--rpc-url', 'https://rpc.invalid'];
  assert.throws(() => command(['configure-worker', '--signer-id', 'x', '--rpc-url', 'https://user:secret@rpc.invalid']));
  assert.equal((await launch(dir, args).done).code, 0);
  const file = path.join(dir, 'worker.json'); const bytes = fs.readFileSync(file, 'utf8');
  assert.equal((await launch(dir, args).done).code, 0);
  assert.equal((await launch(dir, ['configure-worker', '--signer-id', 'OTHER_ID', '--rpc-url', 'https://rpc.invalid']).done).code, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const config = JSON.parse(bytes); assert.equal(config.journalDirectory, path.join(dir, 'operations')); assert.equal(config.runForSeconds, 900);
});

function copyEntry(parent) {
  const owning = path.join(parent, 'integration'); const managed = path.join(owning, 'managed'); fs.mkdirSync(managed, { recursive: true });
  for (const name of ['entry.mjs', 'store.mjs', 'identity.mjs']) fs.copyFileSync(new URL(name, import.meta.url), path.join(managed, name));
  fs.copyFileSync(new URL('../native-process.mjs', import.meta.url), path.join(owning, 'native-process.mjs'));
  return { owning, entry: path.join(managed, 'entry.mjs') };
}
function copiedLaunch(file, dir, args) {
  const child = spawn(process.execPath, [file, ...args], { env: { ACP_DATA_DIR: dir, PATH: process.env.PATH, NODE_OPTIONS: '--max-old-space-size=768' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  return { child, done: new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))) };
}
test('entry dispatch passes observe/serve to worker with stable sanitized HOME and argv', async t => {
  const parent = scratch(t); const dir = path.join(parent, 'store'); fs.mkdirSync(dir, { mode: 0o700 });
  const copy = copyEntry(parent); const store = initializeStore(dir);
  fs.writeFileSync(path.join(dir, 'worker.json'), JSON.stringify({ configDirectory: store.profile, workingDirectory: store.empty, journalDirectory: store.operations }), { mode: 0o600 });
  // Explicit worker sentinel verifies dispatch. Production closure is exercised separately.
  fs.writeFileSync(path.join(copy.owning, 'start.mjs'), "console.log(JSON.stringify({args:process.argv.slice(2),home:process.env.HOME,cwd:process.cwd(),uid:process.getuid(),heap:process.env.NODE_OPTIONS}))");
  for (const mode of ['observe', 'serve']) {
    const args = [mode, ...(mode === 'observe' ? ['--once'] : [])]; const r = await copiedLaunch(copy.entry, dir, args).done; assert.equal(r.code, 0, r.stderr);
    const observed = JSON.parse(r.stdout); assert.deepEqual(observed.args, [mode, path.join(dir, 'worker.json'), ...args.slice(1)]);
    assert.equal(observed.home, store.home); assert.equal(observed.cwd, store.empty); assert.equal(observed.uid, 1000); assert.equal(observed.heap, '--max-old-space-size=768');
  }
});
test('native entry keeps sensitive output off logs and contains CLI plus descendant on SIGTERM', async t => {
  const parent = scratch(t); const dir = path.join(parent, 'store'); fs.mkdirSync(dir, { mode: 0o700 }); const copy = copyEntry(parent);
  const cliDir = path.join(copy.owning, 'runtime/node_modules/@virtuals-protocol/acp-cli/dist/bin'); fs.mkdirSync(cliDir, { recursive: true });
  const cli = path.join(cliDir, 'acp.js');
  fs.writeFileSync(cli, "console.log(JSON.stringify({url:'https://private.invalid/SECRET',token:'DISPOSABLE_SECRET'}))");
  const a = await copiedLaunch(copy.entry, dir, ['cli', 'configure', 'start']).done; assert.equal(a.code, 0, a.stderr); assert.doesNotMatch(a.stdout + a.stderr, /DISPOSABLE_SECRET|private.invalid/);
  const resultFile = path.join(dir, 'enrollment/last-result.json'); assert.equal(JSON.parse(privateFile(resultFile, process.getuid())).token, 'DISPOSABLE_SECRET');
  fs.writeFileSync(cli, `const{spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);fs.writeFileSync(${JSON.stringify(path.join(dir, 'enrollment/child.pid'))},String(child.pid));process.on('SIGTERM',()=>{child.once('exit',()=>process.exit(0));child.kill('SIGTERM')});setInterval(()=>{},1000);`);
  const run = copiedLaunch(copy.entry, dir, ['cli', 'configure', 'start']);
  const pidFile = path.join(dir, 'enrollment/child.pid');
  for (let n = 0; !fs.existsSync(pidFile) && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(fs.existsSync(pidFile)); const childPid = Number(fs.readFileSync(pidFile)); run.child.kill('SIGTERM');
  const b = await run.done; assert.equal(b.code, 1); assert.throws(() => process.kill(childPid, 0), error => error.code === 'ESRCH');
  assert.equal(JSON.parse(privateFile(resultFile, process.getuid())).token, 'DISPOSABLE_SECRET');
});

test('synthetic disposable native signer reopens using managed HOME/XDG in a second process', async t => {
  const { storeEnvironment } = await import('./store.mjs'); const { runNativeProcess } = await import('../native-process.mjs');
  const dir = scratch(t); const store = initializeStore(dir);
  const binary = fileURLToPath(new URL('../runtime/node_modules/@virtuals-protocol/acp-cli/bin/acp-cli-signer-linux', import.meta.url));
  const options = { cwd: store.empty, env: storeEnvironment(store), timeoutMs: 5000, maxBytes: 65536 };
  const generated = JSON.parse((await runNativeProcess(binary, ['generate'], options)).stdout);
  assert.equal(generated.backend, 'encrypted-file'); assert.equal(typeof generated.publicKey, 'string');
  const reopened = initializeStore(dir); assert.deepEqual(reopened, store);
  const signed = JSON.parse((await runNativeProcess(binary, ['sign', '--public-key', generated.publicKey, '--payload', '726f6f74313637372d646973706f7361626c652d74657374'], options)).stdout);
  assert.equal(typeof signed.signature, 'string'); assert.ok(signed.signature.length > 0);
  assert.deepEqual(fs.readdirSync(store.operations), []); assert.deepEqual(fs.readdirSync(store.profile), []);
  // Independent P256 verification is already Root1671's received capability;
  // this test exercises only this package's stable private paths/reopen.
});

test('actual empty root-volume bootstrap drops to UID/GID1000 and reopens without chowning retained data', async t => {
  const { execFileSync } = await import('node:child_process');
  const parent = scratch(t); const dir = path.join(parent, 'volume');
  execFileSync('sudo', ['-n', 'install', '-d', '-m', '0755', '-o', '0', '-g', '0', dir]);
  assert.equal(fs.statSync(dir).uid, 0);
  const invoke = () => JSON.parse(execFileSync('sudo', ['-n', 'env', `ACP_DATA_DIR=${dir}`, 'NODE_OPTIONS=--max-old-space-size=768', process.execPath, entry, 'receive'], { encoding: 'utf8', timeout: 10000 }));
  const a = invoke(); assert.equal(a.uid, 1000); assert.equal(a.gid, 1000);
  fs.writeFileSync(path.join(dir, 'operations/8453-7.json'), '{"state":"sent_unknown"}', { mode: 0o600 });
  const b = invoke(); assert.deepEqual(b, a); assert.equal(fs.statSync(dir).uid, 1000);
  assert.equal(fs.readFileSync(path.join(dir, 'operations/8453-7.json'), 'utf8'), '{"state":"sent_unknown"}');
});

test('nested credential symlink and conflicting owner refuse without repair or deletion', async t => {
  const { execFileSync } = await import('node:child_process'); const dir = scratch(t); const s = initializeStore(dir);
  const target = path.join(s.home, '.local', 'external'); fs.symlinkSync('/tmp', target); assert.throws(() => initializeStore(dir)); assert.equal(fs.readlinkSync(target), '/tmp'); fs.unlinkSync(target);
  const foreign = path.join(s.profile, 'foreign'); fs.writeFileSync(foreign, 'preserve', { mode: 0o600 }); execFileSync('sudo', ['-n', 'chown', '0:0', foreign]);
  assert.throws(() => initializeStore(dir)); assert.equal(fs.statSync(foreign).uid, 0); execFileSync('sudo', ['-n', 'chown', '1000:1000', foreign]); assert.equal(fs.readFileSync(foreign, 'utf8'), 'preserve');
});
test('private output refuses existing or dangling symlink', async t => {
  const { writePrivate } = await import('./store.mjs'); const dir = scratch(t); const file = path.join(dir, 'result'); fs.symlinkSync(path.join(dir, 'missing'), file);
  assert.throws(() => writePrivate(file, 'no')); assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
});
test('credential-free reopen refuses a worker-configuration symlink', t => {
  const dir = scratch(t); initializeStore(dir); const target = path.join(dir, 'worker.json'); fs.symlinkSync('/tmp/missing-private-worker-config', target);
  assert.throws(() => initializeStore(dir)); assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
});
test('image source policy refuses a missing source receipt before store mutation', async t => {
  const dir = scratch(t); const result = await launch(dir, ['receive'], { env: { ACP_REQUIRE_SOURCE_IDENTITY: '1' } }).done;
  assert.equal(result.code, 1); assert.deepEqual(fs.readdirSync(dir), []);
});
