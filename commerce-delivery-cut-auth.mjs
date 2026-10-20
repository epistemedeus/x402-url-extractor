import { createHmac, timingSafeEqual } from 'node:crypto';

export const DELIVERY_CUT_SCHEMA = 'samedaydesk.delivery-journal-cut.v1';
export const DELIVERY_CUT_MAX_BYTES = 32768;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function signDeliveryCut(body, token) {
  return createHmac('sha256', token).update('delivery-journal-cut-v1\n').update(JSON.stringify(body)).digest('hex');
}
export function authenticateDeliveryCut(record, token) {
  if (!record || typeof token !== 'string' || Buffer.byteLength(token) < 32
    || record.schema !== DELIVERY_CUT_SCHEMA || record.kind !== 'delivery_journal_capture'
    || !UUID.test(record.cutId || '') || !UUID.test(record.sessionId || '')
    || !/^[0-9]+:[0-9]+$/.test(record.namespace || '')
    || !/^[0-9a-f]{64}$/.test(record.sourceDigest || '')
    || record.population !== 'registered_process_journal_appends'
    || record.crossProcessExclusivity !== 'unproven' || !record.planes
    || !Number.isFinite(Date.parse(record.from)) || Date.parse(record.from) >= Date.parse(record.asOf)
    || Date.parse(record.asOf) > Date.now() || !/^[0-9a-f]{64}$/.test(record.authentication || '')
    || Buffer.byteLength(JSON.stringify(record)) > DELIVERY_CUT_MAX_BYTES) return false;
  const { authentication, ...body } = record;
  return timingSafeEqual(Buffer.from(authentication), Buffer.from(signDeliveryCut(body, token)));
}
