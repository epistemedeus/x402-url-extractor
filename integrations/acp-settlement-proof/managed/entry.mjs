#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeStore, privateFile, storeEnvironment, writePrivate } from './store.mjs';
import { receiveSource } from './identity.mjs';
import { runNativeProcess } from '../native-process.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export function command(args) {
  const [mode = 'receive', ...rest] = args;
  if (mode === 'receive' && !rest.length) return { mode };
  if (mode === 'enrollment-hold' && rest.length === 1 && /^[1-9][0-9]*$/.test(rest[0]) && +rest[0] <= 900) return { mode, seconds: +rest[0] };
  if (['observe', 'serve'].includes(mode) && (!rest.length || (mode === 'observe' && rest.length === 1 && rest[0] === '--once'))) return { mode, once: rest[0] };
  if (mode === 'configure-worker' && rest.length === 4 && rest[0] === '--signer-id' && /^[A-Za-z0-9_-]{1,128}$/.test(rest[1]) && !rest[1].startsWith('ROOT_') && rest[2] === '--rpc-url') {
    const rpc = new URL(rest[3]);
    if (rpc.protocol !== 'https:' || rpc.username || rpc.password || rpc.search || rpc.hash) throw Error('Explicit HTTPS RPC without inline credentials required');
    return { mode, signerId: rest[1], rpcUrl: rpc.href };
  }
  if (mode === 'cli' && rest.length) return { mode, args: enrollmentArgs(rest) };
  throw Error('Use receive | enrollment-hold 1..900 | cli <supported enrollment/read command> | configure-worker --signer-id ID --rpc-url HTTPS_URL | observe [--once] | serve');
}
export function enrollmentArgs(args) {
  // Root-only device authority entry. Never forwarded from worker/customer input.
  const agent = '019fef7a-3b3e-7a67-b825-6abfd8ba0e17';
  const patterns = [
    ['configure', 'start'],
    ['configure', 'complete', '--request-id', null, '--wait', '--timeout', '120'],
    ['agent', 'use', '--agent-id', agent],
    ['agent', 'add-signer', '--agent-id', agent, '--policy', 'restricted', '--no-wait'],
    ['agent', 'signer-status', '--agent-id', agent, '--request-id', null, '--public-key', null, '--wait', '--timeout', '120'],
    ['agent', 'signer-policy', '--agent-id', agent],
    ['job', 'list'], ['job', 'history', '--chain-id', '8453', '--job-id', null],
  ];
  if (!patterns.some(p => p.length === args.length && p.every((v, i) => v === null ? typeof args[i] === 'string' && /^[A-Za-z0-9+/=_:.-]{1,2048}$/.test(args[i]) : args[i] === v))) throw Error('Unsupported managed native command');
  return [...args, '--json'];
}
export async function main(args = process.argv.slice(2)) {
  const selected = command(args);
  const source = receiveSource({ required: process.env.ACP_REQUIRE_SOURCE_IDENTITY === '1' });
  process.umask(0o077);
  const directory = process.env.ACP_DATA_DIR;
  if (!directory) throw Error('ACP_DATA_DIR is required');
  const root = process.getuid() === 0;
  if (!root && (process.getuid() !== 1000 || process.getgid() !== 1000)) throw Error('Official image node UID/GID1000 required');
  const store = initializeStore(directory, { uid: root ? 1000 : process.getuid(), gid: root ? 1000 : process.getgid(), bootstrap: root });
  if (root) { process.setgroups([]); process.setgid(1000); process.setuid(1000); }
  const env = storeEnvironment(store);
  // Discard platform/account/loader environment; all native commands use this HOME.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env, { ACP_DATA_DIR: directory });
  process.chdir(store.empty);
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  if (selected.mode === 'configure-worker') {
    const template = JSON.parse(fs.readFileSync(path.join(here, '../runtime/worker.example.json'), 'utf8'));
    Object.assign(template, { configDirectory: store.profile, workingDirectory: store.empty, journalDirectory: store.operations, signerId: selected.signerId, receiptRpcUrl: selected.rpcUrl });
    const bytes = JSON.stringify(template, null, 2) + '\n';
    const file = path.join(directory, 'worker.json');
    try {
      if (privateFile(file, process.getuid()) !== bytes) throw Error('Existing worker configuration differs; preserve for Root review');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const parent = fs.openSync(directory, 'r'); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    }
    console.log(JSON.stringify({ mode: selected.mode, configured: true, effects: false }));
    return;
  }
  if (selected.mode === 'receive') {
    // Imports the actual production closure, but never opens an account or signer.
    await import('../native-boundary.mjs');
    const { withDirectoryLock } = await import('../../../experiments/scoped-surface-delivery-100312/src/lock.mjs');
    withDirectoryLock(store.operations, () => { const fd = fs.openSync(store.operations, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } });
    console.log(JSON.stringify({ mode: 'receive', ...source, uid: process.getuid(), gid: process.getgid(), home: store.home, profile: store.profile, operations: store.operations, node: process.version, authenticationAttempted: false, effects: false }));
    return;
  }
  if (selected.mode === 'enrollment-hold' || selected.mode === 'cli') {
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    try {
      if (selected.mode === 'enrollment-hold') {
        console.log(JSON.stringify({ mode: selected.mode, seconds: selected.seconds, uid: process.getuid(), effects: false }));
        await delay(selected.seconds * 1000, undefined, { signal: stop.signal }).catch(() => {});
      } else {
        const cli = path.join(here, '../runtime/node_modules/@virtuals-protocol/acp-cli/dist/bin/acp.js');
        const { stdout } = await runNativeProcess(process.execPath, [cli, ...selected.args], { env, cwd: store.empty, signal: stop.signal, timeoutMs: 150000, maxBytes: 256 * 1024 });
        // URLs/tokens/profiles must never enter platform logs. Root reads privately.
        writePrivate(path.join(store.enrollment, 'last-result.json'), stdout);
        console.log(JSON.stringify({ mode: 'cli', result: path.join(store.enrollment, 'last-result.json') }));
      }
    } finally { process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown); }
    return;
  }
  const configFile = path.join(directory, 'worker.json');
  const config = JSON.parse(privateFile(configFile, process.getuid()));
  for (const [key, value] of Object.entries({ configDirectory: store.profile, workingDirectory: store.empty, journalDirectory: store.operations })) if (config[key] !== value) throw Error('Worker storage paths must match managed volume');
  // The existing real worker owns signals, native child groups, policy and bounds.
  process.argv = [process.execPath, path.join(here, '../start.mjs'), selected.mode, configFile, ...(selected.once ? [selected.once] : [])];
  await import('../start.mjs');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('{"stage":"managed_entry_refused_or_interrupted"}'); process.exitCode = 1; });
}
