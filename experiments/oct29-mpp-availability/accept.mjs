// Serial, source-bound, no-spend acceptance. All installs are owned by this run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const work = process.env.ACCEPTANCE_DIR ? path.resolve(process.env.ACCEPTANCE_DIR) : mkdtempSync(path.join(tmpdir(), 'h64330-accept-'));
mkdirSync(work, { recursive: true });
const BASE = 'a1dc09bb076b823fb3492ea79fa10f8602ed01a5';
const MAINTENANCE = '2e197da2a3e994417af818e8641fab5bd7079e01';
const AUDITOR = 'ef519956505b195454aa670230b0936258b451fb';
const commands = [];
const sourceFiles = ['server.js', 'operation-identity.mjs', 'mpp-dual-stack.mjs', 'construction-surface.mjs',
  'a2a-storefront.mjs', 'machine-surface-parity.mjs', 'skill-contract.mjs', 'solana-agent-registration.mjs',
  'payment-availability.test.mjs', 'machine-surface-parity.http.test.mjs', 'solana-agent-registration.test.mjs'];
function run(cmd, args, { cwd = root, env = {}, input, log, allowFailure = false } = {}) {
  const startedAt = new Date().toISOString();
  const fd = log ? openSync(path.join(work, log), 'w') : null;
  const r = spawnSync(cmd, args, { cwd, input, maxBuffer: 128 * 1024 * 1024, timeout: 180000,
    env: { PATH: process.env.PATH, ...env }, stdio: fd === null ? ['pipe', 'pipe', 'pipe'] : ['pipe', fd, fd] });
  if (fd !== null) closeSync(fd);
  commands.push({ cmd, args, cwd, env, startedAt, endedAt: new Date().toISOString(), exit: r.status, signal: r.signal, log });
  writeFileSync(path.join(work, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
  if (!allowFailure && r.status !== 0) throw Error(`${cmd} exited ${r.status}: ${r.stderr?.toString() || log}`);
  return r.stdout;
}
function archive(ref, dest) {
  mkdirSync(dest, { recursive: true });
  run('tar', ['-x', '-C', dest], { input: run('git', ['archive', ref]) });
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
console.log(`Acceptance output: ${work}`);
run('git', ['fetch', '--no-tags', 'origin', MAINTENANCE], { log: 'maintenance-fetch.log' });
const base = path.join(work, 'base'), combined = path.join(work, 'combined'), auditor = path.join(work, 'auditor');
archive(BASE, base); archive(MAINTENANCE, combined);
run('git', ['clone', '--no-checkout', '--filter=blob:none', 'https://github.com/epistemedeus/agent-payment-integrity.git', auditor], { log: 'auditor-clone.log' });
run('git', ['checkout', '--detach', AUDITOR], { cwd: auditor, log: 'auditor-checkout.log' });
const patch = run('git', ['diff', '--binary', BASE, '--', ...sourceFiles]);
run('git', ['apply', '-'], { cwd: combined, input: patch });
// This also handles an untracked test while developing the isolated patch.
cpSync(path.join(root, 'payment-availability.test.mjs'), path.join(combined, 'payment-availability.test.mjs'));
for (const [label, dir, extra] of [['auditor', auditor, ['--omit=dev']], ['base', base, []], ['candidate', root, []], ['combined', combined, []]]) {
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', ...extra], { cwd: dir, log: `${label}-install.log` });
}
const evidence = path.join(work, 'evidence'); mkdirSync(evidence);
const env = { AUDITOR_ROOT: auditor, LAB_OUT: evidence };
run(process.execPath, [path.join(root, 'experiments/oct29-mpp-availability/lab.mjs'), '--baseline'], {
  env: { ...env, MERCHANT_ROOT: base }, log: 'baseline.log' });
run(process.execPath, [path.join(root, 'experiments/oct29-mpp-availability/lab.mjs')], { env, log: 'candidate.log' });
const combinedEvidence = path.join(work, 'combined-evidence'); mkdirSync(combinedEvidence);
cpSync(path.join(evidence, 'baseline.json.gz'), path.join(combinedEvidence, 'baseline.json.gz'));
run(process.execPath, [path.join(root, 'experiments/oct29-mpp-availability/lab.mjs')], {
  env: { AUDITOR_ROOT: auditor, MERCHANT_ROOT: combined, LAB_OUT: combinedEvidence, LAB_MODERN: '1' }, log: 'combined.log' });
run(process.execPath, [path.join(root, 'experiments/oct29-mpp-availability/regressions.mjs')], { log: 'candidate-regressions.tap' });
run(process.execPath, [path.join(root, 'experiments/oct29-mpp-availability/regressions.mjs')], {
  env: { MERCHANT_ROOT: combined }, log: 'combined-regressions.tap' });
run(process.execPath, ['--test', '--test-concurrency=1', '--test-name-pattern=production mount|legacy, automatic|legacy default|unsupported era|explicit stdio',
  'experiments/oct29-merchant-compatibility/merchant-compatibility.test.mjs'], { cwd: combined, log: 'maintenance-consumer.tap' });
run('git', ['diff', '--exit-code', '--', 'integrity.mjs', 'package.json', 'package-lock.json'], { cwd: auditor });
assert.equal(sha(readFileSync(path.join(root, 'package-lock.json'))), sha(readFileSync(path.join(base, 'package-lock.json'))));
const inventory = { base: BASE, baseTree: run('git', ['rev-parse', `${BASE}^{tree}`]).toString().trim(),
  maintenance: MAINTENANCE, maintenanceTree: run('git', ['rev-parse', `${MAINTENANCE}^{tree}`]).toString().trim(),
  auditor: AUDITOR, auditorTree: run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: auditor }).toString().trim(),
  sourceFiles: sourceFiles.map(file => ({ file, sha256: sha(readFileSync(path.join(root, file))), combinedSha256: sha(readFileSync(path.join(combined, file))) })),
  locks: Object.fromEntries([['base', base], ['candidate', root], ['combined', combined], ['auditor', auditor]].map(([label, dir]) => [label, sha(readFileSync(path.join(dir, 'package-lock.json')))])),
  node: process.version, serial: true, borrowedDependencyTree: false,
};
writeFileSync(path.join(work, 'source-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
// Complete tracked trees cover every local import, optional mount and test input.
for (const [label, ref, cwd] of [['base', BASE, root], ['maintenance', MAINTENANCE, root], ['auditor', AUDITOR, auditor]]) {
  writeFileSync(path.join(work, `${label}-tree.txt.gz`), gzipSync(run('git', ['ls-tree', '-rl', ref], { cwd })));
}
writeFileSync(path.join(work, 'availability.patch'), patch);
console.log('Acceptance passed. No production access, payment verification, settlement, merge or deployment.');
