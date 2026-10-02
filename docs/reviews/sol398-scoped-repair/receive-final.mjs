#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const root = path.resolve(import.meta.dirname, '../../..');
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--source', '--master', '--neo', '--neo-pin', '--out'].includes(process.argv[i]) || !process.argv[i + 1] || options.has(process.argv[i])) throw new Error('explicit_pins_and_output_required');
  options.set(process.argv[i], process.argv[i + 1]);
}
for (const name of ['--source', '--master', '--neo-pin']) if (!/^[0-9a-f]{40}$/.test(options.get(name) || '')) throw new Error('full_commit_pin_required');
if (!options.get('--neo') || !options.get('--out')) throw new Error('explicit_pins_and_output_required');
const source = options.get('--source'), master = options.get('--master');
const out = path.resolve(options.get('--out')); mkdirSync(out, { recursive: true });
const disposable = mkdtempSync(path.join(tmpdir(), 'sol398-final-'));
const shared = ['server.js', 'commerce-events.mjs', 'useful-result-reuse/store.mjs',
  'experiments/seller-repair-service-100266/src/classify.mjs',
  ...['pack-consumer.mjs', 'pack-consumer-030.mjs', 'pack-consumer-040.mjs', 'pack-consumer-041.mjs'].map(x => 'experiments/seller-repair-service-100266/bin/' + x),
  'public-acquisition/manifest.json', 'public-acquisition/cold-commands.json', 'public-acquisition/engine.test.mjs',
  'public-acquisition/bytes/scoped-repair-commerce-100348', 'public-acquisition/inventories/scoped-repair-commerce-100348-0.1.2.json'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function run(cmd, args, cwd = root, extra = {}) {
  const result = spawnSync(cmd, args, { cwd, env: { PATH: process.env.PATH || '' }, timeout: 120000,
    maxBuffer: 4194304, ...extra });
  if (result.status !== 0) throw new Error('receiving_command_failed: ' + cmd + ' ' + args.slice(0, 2).join(' '));
  return result.stdout;
}
function clone(repo, pin, name) {
  const dest = path.join(disposable, name);
  run('git', ['clone', '--quiet', '--local', '--no-hardlinks', repo, dest]);
  run('git', ['checkout', '--quiet', '--detach', pin], dest);
  return dest;
}
const neo = clone(path.resolve(options.get('--neo')), options.get('--neo-pin'), 'neo');
// Both dependency trees are read-only; only disposable test files are written.
symlinkSync(path.join(path.resolve(options.get('--neo')), 'node_modules'), path.join(neo, 'node_modules'), 'dir');
const env = { PATH: process.env.PATH || '', SCOPED_ROOT_MOUNT_PATCHED: '1', NEO_OWNER_ROOT: neo,
  SCOPED_SURFACE_AUTHORITY: path.join(neo, 'packages/accepted-derivative/src/index.mjs'), SKILLGUARD_ROOT: '/home/ubuntu/sol348-skillguard' };
const branch = clone(root, source, 'branch');
symlinkSync(path.join(root, 'node_modules'), path.join(branch, 'node_modules'), 'dir');
const patch = run('git', ['diff', '--binary', master, source, '--', ...shared]);
writeFileSync(path.join(out, 'CURRENT-MASTER-INTEGRATION.patch'), patch);
const current = clone(root, master, 'current-master');
// This QA checkout needs the completed 348/339 dependencies. Root must retain
// its independently received 395 source; the exported patch excludes both.
const archive = run('git', ['archive', source, 'task-linked-delivery/experiments/scoped-repair-commerce-100348',
  'task-linked-delivery/experiments/task-demand-100339', 'docs/reviews/sol398-scoped-repair']);
run('tar', ['-xf', '-'], current, { input: archive });
symlinkSync(path.join(root, 'node_modules'), path.join(current, 'node_modules'), 'dir');
run('git', ['apply', '--check', path.join(out, 'CURRENT-MASTER-INTEGRATION.patch')], current);
run('git', ['apply', path.join(out, 'CURRENT-MASTER-INTEGRATION.patch')], current);
run('git', ['add', '--', ...shared, 'task-linked-delivery/experiments/scoped-repair-commerce-100348',
  'task-linked-delivery/experiments/task-demand-100339', 'docs/reviews/sol398-scoped-repair'], current);
run('git', ['-c', 'user.name=Disposable receiving QA', '-c', 'user.email=qa@example.invalid', 'commit', '--quiet', '-m', 'Isolated current-master receiving with pinned dependency overlay'], current);
const currentPin = run('git', ['rev-parse', 'HEAD'], current).toString().trim();
const codeDiff = run('git', ['diff', '--name-only', source, currentPin, '--', '*.mjs', '*.js'], current).toString().trim();
if (codeDiff) throw new Error('current_master_runtime_differs');
const checks = [];
function suite(checkout, name, files) {
  const receiptPath = path.join(out, name + '-mounted.json');
  const started = performance.now();
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: checkout,
    env: { ...env, SOL398_MOUNT_RECEIPT: receiptPath }, timeout: 120000, maxBuffer: 4194304 });
  const bytes = Buffer.concat([result.stdout || Buffer.alloc(0), result.stderr || Buffer.alloc(0)]);
  writeFileSync(path.join(out, name + '.tap'), bytes);
  const text = bytes.toString(), count = key => Number(text.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))?.[1]);
  const item = { name, tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped'),
    wallMs: Math.round(performance.now() - started), logSha256: hash(bytes), exitCode: result.status };
  checks.push(item); process.stdout.write(JSON.stringify(item) + '\n');
  if (result.status !== 0 || item.fail !== 0 || item.skipped !== 0 || !item.tests) throw new Error('suite_failed: ' + name);
}
const pkg = 'task-linked-delivery/experiments/scoped-repair-commerce-100348';
suite(branch, 'final-package', [pkg + '/test/*.test.mjs']);
suite(branch, 'final-commerce-journal-source', ['experiments/seller-repair-service-100266/test/*.test.mjs',
  'task-linked-delivery/experiments/task-demand-100339/test/*.test.mjs', 'commerce-events.test.mjs', 'commerce-payment-evidence.test.mjs',
  'commerce-outcome-binding*.test.mjs', 'commerce-settlement-reconciler.test.mjs', 'commerce-settlement-source-delivery.test.mjs',
  'task-linked-delivery/receiving.test.mjs', 'useful-result-reuse.test.mjs']);
suite(branch, 'final-surface', ['experiments/scoped-surface-delivery-100312/test/*.test.mjs']);
suite(branch, 'final-acquisition', ['public-acquisition/*.test.mjs']);
suite(branch, 'final-mounted', ['docs/reviews/sol398-scoped-repair/mounted-receiving.test.mjs']);
suite(current, 'master-package', [pkg + '/test/*.test.mjs']);
suite(current, 'master-acquisition', ['public-acquisition/*.test.mjs']);
suite(current, 'master-mounted', ['docs/reviews/sol398-scoped-repair/mounted-receiving.test.mjs']);
for (const [name, dir] of [['branch', branch], ['master', current]]) {
  cpSync(path.join(dir, 'public-acquisition/loopback-profile.json'), path.join(out, name + '-loopback-profile.json'));
  // Restore only this known generated QA file inside the disposable checkout.
  run('git', ['restore', '--source=HEAD', '--', 'public-acquisition/loopback-profile.json'], dir);
  if (run('git', ['status', '--porcelain', '--untracked-files=no'], dir).toString().trim()) throw new Error('tests_changed_committed_source');
}
const receipt = { schema: 'sol398.final-receiving.v1', sourceCommit: source, currentMaster: master, masterReceivingCommit: currentPin,
  neoDependencyCommit: options.get('--neo-pin'), patchSha256: hash(patch), checks, disposableDirectory: disposable,
  runtimeCodeDiff: [], taskDemandProjectionChangedInExport: false, sourceAcceptedInIsolatedBranch: true,
  proofClass: 'loopback', productionHosted: false, hostedAcquisitionVerified: false, outsideUse: 'unknown', settlement: 'unknown',
  paidProviderCalls: 0, recognizedRevenueAtomic: '0' };
writeFileSync(path.join(out, 'final-receiving.json'), JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify({ complete: true, source, checks: checks.length, out }) + '\n');
