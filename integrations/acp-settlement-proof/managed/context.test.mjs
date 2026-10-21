import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const exporter = path.join(root, 'integrations/acp-settlement-proof/managed/export-context.mjs');
function context(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'root1677-context-test-')); t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const dir = path.join(parent, 'source'); execFileSync(process.execPath, [exporter, dir]);
  return { parent, dir, entry: path.join(dir, 'integrations/acp-settlement-proof/managed/entry.mjs') };
}
test('allowlisted context contains production root modules and no credentials/tests/node_modules', t => {
  const { dir } = context(t); const identity = JSON.parse(fs.readFileSync(path.join(dir, 'source-identity.json')));
  assert.ok(identity.hashes['.npmrc']); assert.ok(identity.hashes['settlement-proof.mjs']); assert.ok(identity.hashes['experiments/scoped-surface-delivery-100312/src/lock.mjs']);
  for (const name of Object.keys(identity.hashes)) assert.doesNotMatch(name, /node_modules|\.test\.mjs|\.env|worker\.json|evidence\//);
  for (const name of ['railway.json', 'railway.toml', 'integrations/acp-settlement-proof/managed/railway.json']) {
    assert.equal(fs.existsSync(path.join(dir, name)), false, 'No retired platform config in deploy context');
    assert.equal(Object.hasOwn(identity.hashes, name), false);
  }
  assert.throws(() => execFileSync(process.execPath, [exporter, dir], { stdio: 'pipe' }));
});
test('cold context with only pruned reader and optional runtime resolves real production/native closure', t => {
  const { parent, dir, entry } = context(t);
  execFileSync(process.execPath, [path.join(root, 'integrations/acp-settlement-proof/managed/reader-closure.mjs'), dir], { cwd: root });
  // Copy only the optional exact-lock install as the Docker final stage does.
  fs.cpSync(path.join(root, 'integrations/acp-settlement-proof/runtime/node_modules'), path.join(dir, 'integrations/acp-settlement-proof/runtime/node_modules'), { recursive: true });
  const store = path.join(parent, 'volume'); fs.mkdirSync(store, { mode: 0o700 });
  const env = { ACP_REQUIRE_SOURCE_IDENTITY: '1', ACP_DATA_DIR: store, NODE_OPTIONS: '--max-old-space-size=768', PATH: process.env.PATH };
  const invoke = () => JSON.parse(execFileSync(process.execPath, [entry, 'receive'], { env, encoding: 'utf8', timeout: 10000 }));
  const a = invoke(); assert.equal(a.sourceFiles, Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'source-identity.json'))).hashes).length);
  assert.deepEqual(invoke(), a); assert.equal(a.effects, false); assert.match(a.sourceIdentitySha256, /^[a-f0-9]{64}$/);
  const cli = path.join(dir, 'integrations/acp-settlement-proof/runtime/node_modules/@virtuals-protocol/acp-cli/dist/bin/acp.js');
  assert.equal(execFileSync(process.execPath, [cli, '--version'], { env: { ...env, HOME: path.join(store, 'home'), ACP_CONFIG_DIR: path.join(store, 'profile') }, encoding: 'utf8' }).trim(), '1.0.30');
  fs.appendFileSync(path.join(dir, 'settlement-proof.mjs'), '\n// tampered\n');
  assert.throws(() => execFileSync(process.execPath, [entry, 'receive'], { env, stdio: 'pipe' }));
});
test('real worker entry receives SIGTERM and aborts an owned CLI/signer group preserving unknown records', async t => {
  const { parent, dir, entry } = context(t);
  // Explicit disposable native boundary only: unchanged entry/start/worker/journal
  // and actual native-process run around a local process-group sentinel.
  fs.unlinkSync(path.join(dir, 'source-identity.json'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const store = path.join(parent, 'volume'); fs.mkdirSync(store, { mode: 0o700 });
  const env = { ACP_DATA_DIR: store, NODE_OPTIONS: '--max-old-space-size=768', PATH: process.env.PATH };
  execFileSync(process.execPath, [entry, 'configure-worker', '--signer-id', 'DISPOSABLE_SIGNER', '--rpc-url', 'https://rpc.invalid'], { env });
  const marker = path.join(store, 'operations/8453-3.quote.json'); const unknown = '{"schema":"acp-settlement-proof-quote/v1","state":"sent_unknown"}'; fs.writeFileSync(marker, unknown, { mode: 0o600 });
  const childPidFile = path.join(store, 'enrollment/child.pid');
  const script = path.join(parent, 'cli.cjs');
  fs.writeFileSync(script, `const{spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);fs.writeFileSync(${JSON.stringify(childPidFile)},String(c.pid));process.on('SIGTERM',()=>{c.once('exit',()=>process.exit(0));c.kill('SIGTERM')});setInterval(()=>{},1000);`);
  fs.writeFileSync(path.join(dir, 'integrations/acp-settlement-proof/native-boundary.mjs'), `import{runNativeProcess}from'./native-process.mjs';export function createNativeBoundary({signal}){return{receivePolicy:()=>runNativeProcess(process.execPath,[${JSON.stringify(script)}],{signal,timeoutMs:45000}),disconnect(){},api:{},catalog:{},history:{}}}`);
  const child = spawn(process.execPath, [entry, 'serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; child.stdout.on('data', b => { stdout += b; }); child.stderr.resume();
  const done = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  for (let n = 0; !fs.existsSync(childPidFile) && n < 300; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(fs.existsSync(childPidFile)); const pid = Number(fs.readFileSync(childPidFile)); child.kill('SIGTERM');
  const result = await done; assert.equal(result.code, 0); assert.equal(result.signal, null);
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
  assert.equal(fs.readFileSync(marker, 'utf8'), unknown); assert.match(stdout, /stopped/);
});
