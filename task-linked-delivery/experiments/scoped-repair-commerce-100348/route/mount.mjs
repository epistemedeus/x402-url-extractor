import { createReuseStore } from '../../../../useful-result-reuse/store.mjs';
import { resolveHostedScanner } from '../../../../experiments/scoped-surface-delivery-100312/deploy/hosted-scanner.mjs';
import { allowance, encode, streamJson } from '../src/bounds.mjs';
import { ROUTE } from '../src/contracts.mjs';
import { createScopedRepairService, nextAction } from '../src/service.mjs';

// No fetch, signer, paid call, private authority enrollment or shared journal.
// Optional isolated storage uses the existing store. Root owns configuration.

// streamJson pauses on a raw size failure and clears its wait timer. Finish the
// bounded error, then drop an unfinished body. The allowance deadline is the
// backstop if that write never finishes. Do not resume an unbounded drain.
function destroyIncomplete(req) {
  if (!req || req.destroyed || req.complete !== false) return;
  const ignore = () => {};
  req.on('error', ignore);
  const socket = req.socket;
  if (socket) socket.on('error', ignore);
  req.destroy();
  if (socket && !socket.destroyed) socket.destroy();
}
function releaseIncomplete(req, budget) {
  if (!req || req.destroyed || req.complete !== false) return () => {};
  const timer = setTimeout(() => destroyIncomplete(req), Math.max(1, budget.remainingMs()));
  req.once('close', () => clearTimeout(timer));
  return () => { clearTimeout(timer); destroyIncomplete(req); };
}
export function mountScopedRepairCommerce(app, options = {}) {
  const store = options.store || (options.dataDir ? createReuseStore({ dataDir: options.dataDir, maxFileBytes: 131072, maxRecordBytes: 16384 }) : null);
  const service = createScopedRepairService({ skillguardRoot: resolveHostedScanner().skillguardRoot, ...options, store });
  app.use(ROUTE, async (req, res, next) => {
    const command = req.path.slice(1);
    if (req.method !== 'POST' || !['deliver','reuse','accept','review'].includes(command)) return next();
    const budget = allowance();
    try {
      if (req.headers['x-scoped-deadline-at']) {
        const left = Number(req.headers['x-scoped-deadline-at']) - Date.now();
        budget.restrict({ deadlineMs: Math.max(20, Math.min(5000, Math.floor(left))) });
        if (!Number.isFinite(left) || left < 20) throw Object.assign(new Error('deadline_exceeded'), { code: 'deadline_exceeded' });
      }
      for (const [header, key] of [['x-scoped-read-left','maxReadBytes'],['x-scoped-input-left','maxInputBytes'],['x-scoped-output-left','maxOutputBytes']]) {
        if (req.headers[header]) budget.restrict({ [key]: Number(req.headers[header]) });
      }
      const input = req.body === undefined ? await streamJson(req, budget) : (() => { throw Object.assign(new Error('raw_mount_required'), { code: 'raw_mount_required' }); })();
      const response = await service[command](input, budget);
      const bytes = encode(response, budget);
      if(req.headers['x-scoped-reply-left']){
        const replyLeft=Number(req.headers['x-scoped-reply-left']);
        if(!Number.isInteger(replyLeft)||replyLeft<1024||bytes.length>replyLeft)throw Object.assign(new Error('response_bytes_exceeded'),{code:'response_bytes_exceeded'});
      }
      if (!res.destroyed) { res.writeHead(200, { 'content-type': 'application/json', 'content-length': bytes.length, 'cache-control': 'no-store' }); res.end(bytes); }
    } catch (error) {
      const release = releaseIncomplete(req, budget);
      if (res.destroyed) { release(); return; }
      const reason = /^[a-z][a-z0-9_]{0,80}$/.test(error.code || '') ? error.code : 'qualification_failed';
      const body = JSON.stringify({ ok: false, reason, qualification: 'missing_task_input', executed: 'unknown', paymentPerformed: false,
        recognizedRevenueAtomic: '0', nextAction });
      // A fixed small failure envelope must itself fit the declared output cap.
      if (Buffer.byteLength(body) > budget.remainingOutput()) { release(); return res.destroy(); }
      const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' };
      if (req.complete === false) headers.connection = 'close';
      res.writeHead(['request_binding_changed','wrong_task_or_owner'].includes(reason) ? 409 : reason.includes('unavailable') ? 503 : 400, headers);
      res.once('finish', release);
      res.end(body);
    }
  });
  return { service, store };
}
