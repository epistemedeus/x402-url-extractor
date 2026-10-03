import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TOKEN } from '../../free-task-observation-100421/test/native-ports.mjs';

const root = new URL('../../../../', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function unusedPort() {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

test('actual current-master server entry mounts authenticated native cuts and preserves anonymous archives/current contracts', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'sol-entry-cut-'));
  const port = await unusedPort(), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env,
    PORT: String(port), PUBLIC_URL: "https://agents.samedaydesk.com", COMMERCE_DATA_DIR: dataDir, COMMERCE_INTERNAL_TOKEN: TOKEN,
    COMMERCE_ACTOR_SECRET: '', COMMERCE_RECONCILIATION_INTERVAL_MS: '86400000', MPP_SECRET_KEY: '',
    RAILWAY_DEPLOYMENT_ID: '', RAILWAY_GIT_COMMIT_SHA: '',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const ready = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('native entry did not listen: ' + log.slice(-1000))), 15000);
    function data(chunk) { log += chunk; if (log.includes(`x402-merchant listening on :${port}`)) { clearTimeout(deadline); resolve(); } }
    child.stdout.on('data', data); child.stderr.on('data', data);
    child.once('exit', code => { clearTimeout(deadline); reject(new Error('entry exited: ' + code + '\n' + log.slice(-2000))); });
  });
  try {
    await ready;
    const health = await fetch(base + '/healthz');
    assert.equal(health.status, 200);
    const current = await fetch(base + '/.well-known/useful-result-reuse/current.json');
    assert.equal(current.status, 200); assert.equal((await current.json()).schema, 'samedaydesk.useful-result-reuse.current.v1');
    const manifest = JSON.parse(await readFile(new URL('public-acquisition/manifest.json', root), 'utf8'));
    const archive = manifest.assets.find(a => a.id === 'seller-repair-external-consumer' && a.version === '0.4.1' && a.role === 'archive');
    assert.ok(archive);
    const anonymous = await fetch(base + '/.well-known/public-acquisition/assets/' + archive.relativePath);
    assert.equal(anonymous.status, 200);
    assert.equal(sha(Buffer.from(await anonymous.arrayBuffer())), archive.sha256);
    // The canonical receipt route retains its payment challenge. Observing
    // an attempt cannot bypass payment middleware or call a provider.
    const free = await fetch(base + '/chain/transaction-receipt');
    assert.equal(free.status, 402);
    const attempted = await fetch(base + '/chain/transaction-receipt', { headers: {
      'x-samedaydesk-internal': TOKEN, 'x-samedaydesk-outcome-operation': 'normalized-transaction-receipt',
      'x-samedaydesk-outcome-cohort': 'owner_qa', 'x-samedaydesk-outcome-task': 'native-entry-refusal', 'x-samedaydesk-observe-free-result': '1',
    } });
    assert.equal(attempted.status, 402);
    const taskRef = attempted.headers.get('x-samedaydesk-outcome-task-ref');
    assert.match(taskRef, /^t[a-f0-9]{62}$/);
    const response = await fetch(base + '/.well-known/useful-result-reuse/current.json', { headers: {
      'x-samedaydesk-internal': TOKEN, 'x-samedaydesk-outcome-task-ref': taskRef, 'x-samedaydesk-result-action': 'read-attempt-cut',
    } });
    const report = await response.json();
    assert.equal(response.status, 200, JSON.stringify(report));
    assert.equal(report.stages.attempt.disposition, 'producer-observed');
    assert.equal(report.stages.delivery.observed, 'unknown');
    assert.equal(report.stages.delivery.reason, 'execution_did_not_deliver');
    assert.equal(report.planeCoverage.attempts.coverage, 'complete');
    assert.equal(report.planeCoverage.settlements.coverage, 'unknown');
    assert.equal(report.capture.runtime.entrypoint, 'server.js');
    assert.equal(report.liveCoverage, 'unresolved'); assert.equal(report.paymentPermitted, false);
    const readback = JSON.parse(execFileSync(process.execPath, ['task-linked-delivery/experiments/attempt-useful-view-1005/bin/read-task-cut.mjs', taskRef, '--cut-id', report.cutId],
      { cwd: root, env: { ...process.env, COMMERCE_INTERNAL_TOKEN: TOKEN, COMMERCE_BASE_URL: base }, encoding: 'utf8' }));
    assert.equal(readback.httpStatus, 200); assert.deepEqual(readback.report.stages, report.stages);
    await writeFile(new URL('docs/reviews/sol-live-attempt-delivery-261003/evidence/server-entry-readback.json', root), JSON.stringify({ base, taskRef,
      persistedDataDir: process.env.SOL_ATTEMPT_PRESERVE_CAPTURE === '1' ? dataDir : null, version: report.capture.runtime.serviceVersion,
      archiveSha256: archive.sha256, report, release: 'isolated VM entry only', paymentInvoked: false }, null, 2) + '\n');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000).unref(); });
    if (process.env.SOL_ATTEMPT_PRESERVE_CAPTURE !== '1') await rm(dataDir, { recursive: true, force: true });
  }
});
