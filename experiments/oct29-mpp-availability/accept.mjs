// Deciding acceptance for the joined payment and availability candidate.
// The H64330 entry at ab5bf51b archived maintenance 2e197da and overlaid the
// availability diff, then required the candidate lock to equal a1dc09bb.
// That historical gate stays in git history and in its evidence directory.
// It does not decide this tree. This run installs HEAD, requires the lock to
// equal maintenance 3da72788, and records the original a1dc09bb lock separately.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const historicalEvidence = path.join(root, 'experiments/oct29-mpp-availability/evidence');
const work = process.env.ACCEPTANCE_DIR
  ? path.resolve(process.env.ACCEPTANCE_DIR)
  : mkdtempSync(path.join(tmpdir(), 'h64201-joined-accept-'));
if (work === historicalEvidence || work.startsWith(historicalEvidence + path.sep) || work === root) {
  throw new Error(`refusing to write acceptance output into ${work}`);
}
mkdirSync(work, { recursive: true });

const BASE = 'a1dc09bb076b823fb3492ea79fa10f8602ed01a5';
const MAINTENANCE = '3da72788305b3529704b8e99f2abbce06d15fb75';
const AVAILABILITY = 'ab5bf51b60c7fa6e2d3587fcac23b26f00872b65';
const AUDITOR = 'ef519956505b195454aa670230b0936258b451fb';
const PYTHON_SITE = process.env.H64201_PYTHONPATH || '/tmp/oct29-mcp-py-site';
const commands = [];
const sourceFiles = [
  'server.js', 'mcp-server.mjs', 'package.json', 'package-lock.json',
  'operation-identity.mjs', 'mpp-dual-stack.mjs', 'construction-surface.mjs',
  'a2a-storefront.mjs', 'machine-surface-parity.mjs', 'skill-contract.mjs',
  'solana-agent-registration.mjs', 'payment-availability.test.mjs',
  'experiments/oct29-mpp-availability/lab.mjs',
  'experiments/oct29-mpp-availability/accept.mjs',
  'experiments/oct29-merchant-compatibility/merchant-compatibility.test.mjs',
];

function run(cmd, args, { cwd = root, env = {}, input, log, allowFailure = false, timeout = 180000 } = {}) {
  const startedAt = new Date().toISOString();
  const fd = log ? openSync(path.join(work, log), 'w') : null;
  const r = spawnSync(cmd, args, {
    cwd,
    input,
    maxBuffer: 128 * 1024 * 1024,
    timeout,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME || '/home/ubuntu',
      TMPDIR: process.env.TMPDIR || '/tmp',
      GIT_TERMINAL_PROMPT: '0',
      ...env,
    },
    stdio: fd === null ? ['pipe', 'pipe', 'pipe'] : ['pipe', fd, fd],
  });
  if (fd !== null) closeSync(fd);
  commands.push({
    cmd, args, cwd, env, startedAt, endedAt: new Date().toISOString(),
    exit: r.status, signal: r.signal, log, timeout,
  });
  writeFileSync(path.join(work, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
  if (!allowFailure && r.status !== 0) {
    throw new Error(`${cmd} exited ${r.status}${r.signal ? ` signal ${r.signal}` : ''}: ${r.stderr?.toString() || log || ''}`);
  }
  return r.stdout;
}

function archive(ref, dest) {
  mkdirSync(dest, { recursive: true });
  run('tar', ['-x', '-C', dest], { input: run('git', ['archive', ref]) });
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
console.log(`Acceptance output: ${work}`);

const head = run('git', ['rev-parse', 'HEAD']).toString().trim();
const headTree = run('git', ['rev-parse', 'HEAD^{tree}']).toString().trim();
const candidateLock = readFileSync(path.join(root, 'package-lock.json'));
const maintenanceLock = run('git', ['show', `${MAINTENANCE}:package-lock.json`]);
const baseLock = run('git', ['show', `${BASE}:package-lock.json`]);
assert.equal(sha(candidateLock), sha(maintenanceLock), 'joined lock must equal the 3da727 maintenance lock');
assert.notEqual(sha(candidateLock), sha(baseLock), 'a1dc lock is a separate fact and does not include the axios pin');

const joined = path.join(work, 'joined');
const auditor = path.join(work, 'auditor');
archive('HEAD', joined);
for (const file of sourceFiles) {
  assert.equal(sha(readFileSync(path.join(joined, file))), sha(readFileSync(path.join(root, file))), file);
}
const serverSource = readFileSync(path.join(joined, 'server.js'), 'utf8');
const mcpSource = readFileSync(path.join(joined, 'mcp-server.mjs'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(joined, 'package.json'), 'utf8'));
assert.match(serverSource, /modernProtocol:\s*true/);
assert.match(mcpSource, /function withholdExplicitFalseSettlement/);
assert.equal(pkg.version, '1.23.55');
assert.equal(pkg.overrides.axios, '1.20.0');
assert.equal(pkg.overrides.qs, '6.16.0');
assert.equal(pkg.dependencies.zod, '3.25.76');
assert.equal(pkg.dependencies['@modelcontextprotocol/sdk'], '1.30.0');
assert.equal(pkg.devDependencies['@modelcontextprotocol/client'], '2.4.0');

run('git', ['clone', '--no-checkout', '--filter=blob:none', 'https://github.com/epistemedeus/agent-payment-integrity.git', auditor], {
  log: 'auditor-clone.log', timeout: 300000,
});
run('git', ['checkout', '--detach', AUDITOR], { cwd: auditor, log: 'auditor-checkout.log' });
run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: joined, log: 'joined-install.log', timeout: 600000,
});
run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev'], {
  cwd: auditor, log: 'auditor-install.log', timeout: 600000,
});
run('git', ['diff', '--exit-code', '--', 'integrity.mjs', 'package.json', 'package-lock.json'], { cwd: auditor });
assert.equal(sha(readFileSync(path.join(joined, 'package-lock.json'))), sha(maintenanceLock));

const evidence = path.join(work, 'evidence');
mkdirSync(evidence);
const baselinePath = path.join(historicalEvidence, 'evidence/baseline.json.gz');
const baselineBytes = readFileSync(baselinePath);
cpSync(baselinePath, path.join(evidence, 'baseline.json.gz'));
assert.equal(sha(readFileSync(baselinePath)), sha(baselineBytes), 'historical baseline capture must stay unchanged');

const labEnv = {
  AUDITOR_ROOT: auditor,
  MERCHANT_ROOT: joined,
  LAB_OUT: evidence,
  LAB_MODERN: '1',
};
run(process.execPath, [path.join(joined, 'experiments/oct29-mpp-availability/lab.mjs')], {
  env: labEnv, log: 'joined-lab.log', timeout: 600000,
});
run(process.execPath, [path.join(joined, 'experiments/oct29-mpp-availability/regressions.mjs')], {
  env: { MERCHANT_ROOT: joined }, log: 'joined-regressions.tap', timeout: 600000,
});
run(process.execPath, ['--test', '--test-concurrency=1',
  'experiments/oct29-merchant-compatibility/axios-transport.test.mjs',
  'experiments/oct29-merchant-compatibility/schema-catalog.test.mjs',
  'experiments/oct29-merchant-compatibility/merchant-compatibility.test.mjs'], {
  cwd: joined,
  env: { H64201_PYTHONPATH: PYTHON_SITE },
  log: 'payment-clients.tap',
  timeout: 600000,
});

const acceptance = JSON.parse(readFileSync(path.join(evidence, 'acceptance.json'), 'utf8'));
const historicalAcceptance = JSON.parse(readFileSync(path.join(historicalEvidence, 'evidence/acceptance.json'), 'utf8'));
assert.equal(acceptance.cases.length, 3);
assert.equal(acceptance.verify, 0);
assert.equal(acceptance.settle, 0);
assert.deepEqual(acceptance.oldResultReplay, ['x402', 'mpp']);
for (const label of ['disabled', 'enabled', 'disabled-again']) {
  const current = acceptance.cases.find((entry) => entry.label === label);
  const prior = historicalAcceptance.cases.find((entry) => entry.label === label);
  assert.equal(current.ok, true, label);
  assert.equal(Object.keys(current.human).length, 10, label);
  assert.deepEqual(current.human, prior.human, label);
}
assert.deepEqual(acceptance.cases.find((entry) => entry.label === 'disabled').protocols, ['x402']);
assert.deepEqual(acceptance.cases.find((entry) => entry.label === 'enabled').protocols, ['mpp', 'x402']);
assert.deepEqual(acceptance.cases.find((entry) => entry.label === 'disabled-again').protocols, ['x402']);
const facilitator = JSON.parse(readFileSync(path.join(evidence, 'facilitator.json'), 'utf8'));
assert.equal(facilitator.verify, 0);
assert.equal(facilitator.settle, 0);
assert.ok(facilitator.calls.length > 0);
assert.ok(facilitator.calls.every((call) => call === 'GET /supported'));
const refusal = readFileSync(path.join(evidence, 'startup-refusal.txt'), 'utf8');
assert.match(refusal, /at least 32 bytes/);
assert.doesNotMatch(refusal, /listening on/);
const actionRefusal = JSON.parse(readFileSync(path.join(evidence, 'action-local-refusal.json'), 'utf8'));
assert.equal(actionRefusal.exit, 1);
assert.match(actionRefusal.stderr, /not public/);
const paymentLog = readFileSync(path.join(work, 'payment-clients.tap'), 'utf8');
assert.match(paymentLog, /# fail 0/);
assert.doesNotMatch(paymentLog, /# fail [1-9]/);
const regressionLog = readFileSync(path.join(work, 'joined-regressions.tap'), 'utf8');
assert.match(regressionLog, /# fail 0/);
assert.match(regressionLog, /"verify":0,"settle":0/);

const merge = run('git', ['log', '--merges', '-1', '--format=%H']).toString().trim();
const inventory = {
  schema: 'h64201.joined-acceptance.v1',
  head,
  headTree,
  merge,
  mergeParents: run('git', ['rev-parse', `${merge}^1`, `${merge}^2`]).toString().trim().split('\n'),
  base: BASE,
  baseTree: run('git', ['rev-parse', `${BASE}^{tree}`]).toString().trim(),
  maintenance: MAINTENANCE,
  maintenanceTree: run('git', ['rev-parse', `${MAINTENANCE}^{tree}`]).toString().trim(),
  availability: AVAILABILITY,
  availabilityTree: run('git', ['rev-parse', `${AVAILABILITY}^{tree}`]).toString().trim(),
  auditor: AUDITOR,
  auditorTree: run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: auditor }).toString().trim(),
  locks: {
    base: sha(baseLock),
    maintenance: sha(maintenanceLock),
    joined: sha(candidateLock),
    joinedInstall: sha(readFileSync(path.join(joined, 'package-lock.json'))),
    auditor: sha(readFileSync(path.join(auditor, 'package-lock.json'))),
  },
  lockDecision: 'joined lock equals maintenance 3da727; a1dc lock is recorded and is not the pass condition',
  historicalOverlayDecidesThisCandidate: false,
  baselineCaptureSha256: sha(baselineBytes),
  baselineCapture: 'experiments/oct29-mpp-availability/evidence/evidence/baseline.json.gz',
  transport: 'loopback HTTP with canonical Host and x-forwarded-proto https; not a lab TLS session',
  sourceFiles: sourceFiles.map((file) => ({ file, sha256: sha(readFileSync(path.join(joined, file))) })),
  installed: {
    node: process.version,
    axios: JSON.parse(readFileSync(path.join(joined, 'node_modules/axios/package.json'), 'utf8')).version,
    sdk: JSON.parse(readFileSync(path.join(joined, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8')).version,
    server: JSON.parse(readFileSync(path.join(joined, 'node_modules/@modelcontextprotocol/server/package.json'), 'utf8')).version,
    client: JSON.parse(readFileSync(path.join(joined, 'node_modules/@modelcontextprotocol/client/package.json'), 'utf8')).version,
    pythonSite: PYTHON_SITE,
  },
  originalFailures: {
    paidBodyReleasedAt: '2e197da2a3e994417af818e8641fab5bd7079e01',
    falseSettlementFix: 'bdea3f75dfbea51fe10e1f617a2dc758ed124030',
    h64202Pilot: 'dbe233339e155a857d624a12c117f4d59a8bbcf9',
    h64202CandidateJoinBlob: 'ea2d06360932c430ea32b22391cf291fced1618a',
    h64330HistoricalAccept: AVAILABILITY,
    immutable: true,
  },
  node: process.version,
  serial: true,
  borrowedDependencyTree: false,
  humanPages: 10,
};
writeFileSync(path.join(work, 'source-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
for (const [label, ref, cwd] of [['base', BASE, root], ['maintenance', MAINTENANCE, root], ['joined', 'HEAD', root], ['auditor', AUDITOR, auditor]]) {
  writeFileSync(path.join(work, `${label}-tree.txt.gz`), gzipSync(run('git', ['ls-tree', '-rl', ref], { cwd })));
}
console.log('Joined acceptance passed. No production access, payment verification, settlement, merge or deployment.');
