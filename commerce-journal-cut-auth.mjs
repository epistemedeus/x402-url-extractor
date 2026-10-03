import { createHmac, timingSafeEqual } from 'node:crypto';

export const JOURNAL_CUT_SCHEMA = 'samedaydesk.attempt-useful.journal-cut.v1';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function authenticateJournalCut(record, token) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || typeof token !== 'string' || Buffer.byteLength(token) < 32
    || record.schema !== JOURNAL_CUT_SCHEMA || record.kind !== 'attempt_useful_capture'
    || !uuid.test(record.cutId || '') || !uuid.test(record.sessionId || '') || !/^[0-9]+:[0-9]+$/.test(record.namespace || '')
    || record.producer !== 'canonical_commerce_and_useful_result_journals' || record.writerProcesses !== 1
    || !/^[a-f0-9]{64}$/.test(record.sourceDigest || '') || !record.planes
    || !Number.isFinite(Date.parse(record.from)) || Date.parse(record.from) >= Date.parse(record.asOf) || Date.parse(record.asOf) > Date.now()
    || !/^[a-f0-9]{64}$/.test(record.authentication || '') || Buffer.byteLength(JSON.stringify(record)) > 8192) return false;
  const { authentication, ...body } = record;
  const expected = createHmac('sha256', token).update('attempt-useful-cut-v1\n').update(JSON.stringify(body)).digest('hex');
  return timingSafeEqual(Buffer.from(authentication), Buffer.from(expected));
}
