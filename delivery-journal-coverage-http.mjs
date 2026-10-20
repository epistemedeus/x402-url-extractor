// Owner-only finite receiving on the ordinary report path. No resident monitor.
import { timingSafeEqual } from 'node:crypto';
import { commerceRuntime } from './commerce-journal-admission.mjs';
import { createDeliveryJournalCoverage, DELIVERY_COVERAGE_SCHEMA } from './delivery-journal-coverage.mjs';
import { receiveOrdinaryDeliveryJoin } from './ordinary-delivery-join.mjs';

export const ORDINARY_DELIVERY_REPORT_PATH = '/v0/ordinary-delivery-join.json';
const SAFE_FAILURES = new Set([
  'producer_flush_failed', 'capture_persist_failed', 'source_changed',
  'store_namespace_changed', 'cut_write_outcome_unknown', 'cut_limit_exceeded',
  'telemetry_producer_unavailable',
]);
export function mountDeliveryJournalCoverage(app, options = {}) {
  const internalToken = typeof options.internalToken === 'string' ? options.internalToken : '';
  const startedAt = new Date().toISOString();
  let capture;
  try { capture = createDeliveryJournalCoverage({ ...options, internalToken, app }); }
  catch {
    // Observation initialization cannot prevent the merchant serving paid work.
    capture = Object.freeze({ ready: Promise.resolve(), async capture() { throw Error('delivery_coverage_unavailable'); } });
  }
  function authorize(req, res) {
    res.set('Cache-Control', 'no-store');
    const supplied = req.headers['x-samedaydesk-internal'];
    if (Buffer.byteLength(internalToken) < 32) {
      res.status(503).json({ error: 'existing_token_unavailable' });
      return false;
    }
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(internalToken)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(internalToken))) {
      res.status(403).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  }
  app.post(ORDINARY_DELIVERY_REPORT_PATH, async (req, res) => {
    if (!authorize(req, res)) return;
    if (Object.keys(req.query || {}).length || req.body !== undefined
      && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
      return res.status(400).json({ error: 'input_rejected' });
    }
    try {
      const begun = await capture.begin();
      return res.json({ schema: DELIVERY_COVERAGE_SCHEMA, captureStarted: true, from: begun.from,
        population: 'registered_process_journal_appends', exhaustive: false });
    } catch { return res.status(503).json({ error: 'delivery_coverage_unavailable' }); }
  });
  app.get(ORDINARY_DELIVERY_REPORT_PATH, async (req, res) => {
    if (!authorize(req, res)) return;
    if (Object.keys(req.query || {}).some(key => key !== 'windowStart' && key !== 'windowEnd')
      || Object.values(req.query || {}).some(value => typeof value !== 'string')) {
      return res.status(400).json({ error: 'query_rejected' });
    }
    for (const value of Object.values(req.query || {})) {
      if (!Number.isFinite(Date.parse(value))) return res.status(400).json({ error: 'invalid_window' });
    }
    if (req.query?.windowStart && req.query?.windowEnd && Date.parse(req.query.windowStart) > Date.parse(req.query.windowEnd)) {
      return res.status(400).json({ error: 'invalid_window' });
    }
    let cut, captureFailure = null;
    try { cut = await capture.capture(); }
    catch (error) { captureFailure = SAFE_FAILURES.has(error.message) ? error.message : 'capture_initialization_or_read_failed'; }
    try {
      const windowStart = req.query?.windowStart || cut?.from || startedAt;
      const windowEnd = req.query?.windowEnd || cut?.asOf || new Date().toISOString();
      const report = await receiveOrdinaryDeliveryJoin({ dataDir: options.dataDir, internalToken, windowStart, windowEnd,
        sourceSha: commerceRuntime(app).source || null });
      return res.json({ ...report, coverageAttempt: { status: captureFailure ? 'unavailable' : 'received', reason: captureFailure } });
    } catch {
      // Do not expose filesystem paths or runtime errors on an HTTP surface.
      return res.status(503).json({ error: 'delivery_coverage_unavailable' });
    }
  });
  return capture;
}
