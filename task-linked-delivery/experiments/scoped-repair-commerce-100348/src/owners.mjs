import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runScan } from '../../../../experiments/scoped-surface-delivery-100312/src/adapter.mjs';
import { rerun } from '../../../../experiments/scoped-surface-delivery-100312/src/retest.mjs';
import { validateInventory } from '../../../../experiments/scoped-surface-delivery-100312/src/intake.mjs';
import { validateCallerRequest } from '../../../../experiments/seller-repair-service-100266/commercial/caller-request.mjs';
import { normalizeIntake } from '../../../../experiments/seller-repair-service-100266/src/intake.mjs';
import { exactPaidRequest } from '../../../../experiments/seller-repair-service-100266/src/handoff.mjs';
import { containsSecret } from '../../../../experiments/scoped-surface-delivery-100312/src/redact.mjs';
import { exportObserverSource, projectObserverEvidence } from '../../task-demand-100339/src/observer-integration.mjs';
import { fail } from './bounds.mjs';

export { exportObserverSource, projectObserverEvidence };
const WORKER = fileURLToPath(new URL('./seller-worker.mjs', import.meta.url));

export function ownerInput(request) {
  if ([request.task.statement,request.terms.scope,request.implementation?.scope,request.input.expect?.value].some(value => typeof value === 'string' && containsSecret(value))) fail('secret_in_task_metadata');
  if (request.kind === 'surface') {
    const result = validateInventory(request.input);
    if (!result.ok) fail('surface_input_required');
    if (request.fix) {
      if (Object.keys(request.fix).some(k => k !== 'request') || !validateInventory(request.fix.request).ok) fail('repair_input_required');
      if (request.fix.request.concern.id !== request.input.concern.id || (request.fix.request.contextId || request.task.id) !== (request.input.contextId || request.task.id)) fail('repair_scope_changed');
    }
  } else if (!validateCallerRequest(request.input).ok) fail('seller_input_required');
}

function engineIntake(request) {
  return normalizeIntake({ callerId: request.task.callerId, task: request.task.statement, origin: request.input.origin, method: 'GET',
    resource: request.input.operation.slice(4), expectedUsefulOutput: { paths: [request.input.expect.path], equals: request.input.expect },
    declaredSdk: request.input.sdk, declaredRuntime: request.input.runtime,
    maxEffort: Object.fromEntries(['probes','bodyBytes','deadlineMs','totalBodyBytes','totalResponseMs','redirects'].map(k => [k,request.input.limits[k]])),
    probeConsent: { class: 'public-https', confirmed: true }, question: request.input.question || 'useful_output' });
}

export function auditUrl(request) {
  if (request.kind !== 'seller') return null;
  const paid = exactPaidRequest(engineIntake(request));
  return 'https://agents.samedaydesk.com' + paid.pathAndQuery;
}

export async function sellerRun(request, budget, prior = null) {
  budget.noteSpawn();
  const command = Buffer.from(JSON.stringify({ input: request.input, prior }));
  budget.read(command.length);
  const child = spawn(process.execPath, [WORKER], { detached: true, env: { PATH: process.env.PATH || '' }, stdio: ['pipe','pipe','pipe'] });
  let stdout = Buffer.alloc(0), stderrBytes = 0, error = null;
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
  const timer = setTimeout(() => { error = 'deadline_exceeded'; kill(); }, Math.max(1, budget.remainingMs()));
  try {
    const complete = new Promise(resolve => {
      child.stdout.on('data', chunk => { try { budget.read(chunk.length); budget.chargeOutput(chunk.length); stdout = Buffer.concat([stdout, chunk]); } catch (e) { error = e.code; kill(); } });
      child.stderr.on('data', chunk => { stderrBytes += chunk.length; try { budget.read(chunk.length); budget.chargeOutput(chunk.length); if (stderrBytes > 1024) fail('child_stderr_exceeded'); } catch (e) { error = e.code; kill(); } });
      child.once('error', () => { error = 'child_unavailable'; resolve(); });
      child.once('close', code => { if (code && !error) error = 'child_failed'; resolve(); });
    });
    child.stdin.on('error', () => {}); child.stdin.end(command);
    await complete; if (error) fail(error); budget.check();
    const result = JSON.parse(stdout);
    budget.read(result.receipt?.resources?.bodyBytes || 0);
    return result;
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) kill(); }
}

export async function surfaceRun(request, budget, skillguardRoot) {
  if (!skillguardRoot) return { baseline: null, retest: null, reason: 'scanner_provider_unavailable' };
  budget.read(validateInventory(request.input).value.totalBytes);
  const baseline = await runScan(request.input, { skillguardRoot, budget });
  let retest = null;
  if (request.fix && baseline.scanPerformed) {
    budget.read(validateInventory(request.input).value.totalBytes + validateInventory(request.fix.request).value.totalBytes);
    retest = await rerun({ original: request.input, request: request.fix.request }, { skillguardRoot, budget });
  }
  return { baseline, retest, reason: baseline.concern?.reason || null };
}
