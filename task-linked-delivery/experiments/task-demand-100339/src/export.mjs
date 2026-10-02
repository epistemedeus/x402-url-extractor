import { isTaskRefRecord, isForwardV2Record } from '../vendor/causal-contract.mjs';
import { LIMITS, checkTree, digest, fail, parseJson } from './bounds.mjs';

export const EXPORT_SCHEMA = 'samedaydesk.task-demand.export.v1';
export const RETENTION_SCHEMA = 'samedaydesk.task-demand.retention-export.v1';
export const CUSTOMER_SCHEMA = 'samedaydesk.useful-result-reuse.customer-grant.v1';
export const METRIC_SCHEMA = 'samedaydesk.useful-result-reuse.metric.v1';
export const RECONCILIATION_SCHEMA = 'samedaydesk.commerce-settlement-reconciliation.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const ATOMIC = /^(0|[1-9][0-9]{0,77})$/;
export function time(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)); }
function pick(row, keys) { return Object.fromEntries(keys.filter(k => row[k] !== undefined).map(k => [k, row[k]])); }

// Caller explicitly supplies already authorized read-only records. This function
// never opens a merchant data directory, reads an environment token or runs RPC.
export function stripRecord(row, plane) {
  if (!row || typeof row !== 'object') return null;
  if (plane === 'task_refs' && isTaskRefRecord(row)) return { ...row };
  if (plane === 'forward' && isForwardV2Record(row)) return { ...row };
  if (plane === 'attempts' && row.v === 3 && UUID.test(row.id || '') && time(row.ts)
    && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(row.method || '')
    && /^\/[a-zA-Z0-9/._:*-]{1,199}$/.test(row.route || '')
    && ['request','challenge','validation_failure','service_failure','paid_route_response','paid_success','replay_success'].includes(row.result)
    && Number.isInteger(row.status) && row.status >= 100 && row.status <= 599) {
    const out = pick(row, ['v','id','ts','method','route','result','status']);
    // Native v3 ts is response finish, while receipt retention runs during
    // res.end. Preserve the producer's measured interval, not a guessed grace.
    if (row.durationMs !== undefined) {
      if (!Number.isSafeInteger(row.durationMs) || row.durationMs < 0 || row.durationMs > Date.parse(row.ts)) return null;
      out.durationMs = row.durationMs;
    }
    // These are existing producer classifications, never identity join keys.
    if (['internal','owner_monitor','external','scanner','crawler'].includes(row.originClass)) out.originClass = row.originClass;
    if (/^[a-z_]{1,64}$/.test(row.paymentFailureCode || '')) out.paymentFailureCode = row.paymentFailureCode;
    return out;
  }
  if (plane === 'settlements' && row.schemaVersion === RECONCILIATION_SCHEMA && row.state === 'reconciled'
    && UUID.test(row.sourceEventId || '') && time(row.reconciledAt) && time(row.sourceEventTimestamp)
    && /^0x[0-9a-f]{64}$/.test(row.settlementReference || '') && ATOMIC.test(row.amountAtomic || '') && BigInt(row.amountAtomic) > 0n
    && row.network === 'eip155:8453' && /^\/[a-zA-Z0-9/._:*-]{1,199}$/.test(row.route || '')) {
    const out = pick(row, ['schemaVersion','state','sourceEventId','sourceEventTimestamp','reconciledAt','route','network','settlementReference','amountAtomic']);
    if (['internal','validation','incentivized','affiliated','independent','unclassified'].includes(row.paymentClass)) out.paymentClass = row.paymentClass;
    return out;
  }
  if (plane === 'retention' && row.schema === CUSTOMER_SCHEMA) {
    if (row.action === 'revoke' && time(row.at) && /^[a-f0-9]{16}$/.test(row.targetId || ''))
      return { schema: RETENTION_SCHEMA, action: 'revoke', at: row.at, targetId: row.targetId };
    if (row.action !== 'retain' || !HEX.test(row.resultId || '') || !/^[a-f0-9]{16}$/.test(row.grantId || '')
      || !/^[a-f0-9]{32}$/.test(row.recordId || '') || !time(row.createdAt) || !time(row.expiresAt)
      || row.operationId !== 'normalized-transaction-receipt' || !/^t[a-f0-9]{62}$/.test(row.taskRef || '')
      || row.taskJoin !== 'bound' || row.method !== 'GET' || row.route !== '/chain/transaction-receipt') return null;
    if (row.recordId !== row.resultId.slice(0,32)) return null;
    const body = row.body;
    if (!body || body.product !== 'samedaydesk-transaction-receipt' || body.version !== '1.0.0'
      || body.paidValidDelivery === true || body.usefulDelivery === 'true' || row.settlementStatus !== 'verified'
      || !/^0x[0-9a-f]{64}$/.test(body.request?.transactionHash || '') || !body.request?.network
      || digest(body) !== row.resultId) return null;
    const success = body.ok === true && body.decision === 'found' && body.receipt?.found === true
      && ['success','reverted'].includes(body.transaction?.status);
    const negative = body.ok === true && body.decision === 'not_found' && body.receipt?.found === false;
    if (!success && !negative) return null;
    const criterion = row.evidenceClass === 'paid_valid_delivery' && success && row.paidValidDelivery === true
      ? 'positive' : row.evidenceClass === 'useful_negative' && negative ? 'agreed_negative' : 'unknown';
    return { ...pick(row, ['action','grantId','recordId','resultId','operationId','taskRef','createdAt','expiresAt','method','route']),
      schema: RETENTION_SCHEMA, criterion, criterionAuthority: 'operation_contract', sourceSchema: CUSTOMER_SCHEMA };
  }
  if (plane === 'reads' && row.schema === METRIC_SCHEMA && row.kind === 'useful_later_read'
    && ID.test(row.eventId || '') && time(row.at) && /^[a-f0-9]{32}$/.test(row.recordId || '')
    && /^t[a-f0-9]{62}$/.test(row.taskRef || '')) return pick(row, ['schema','kind','eventId','at','recordId','taskRef']);
  // Exported retention data can be consumed again without access to the body.
  if (plane === 'retention' && validRetention(row)) return { ...row };
  return null;
}
function exactKeys(row, keys) { return Object.keys(row).every(k => keys.includes(k)); }
export function validRetention(row) {
  if (row?.schema !== RETENTION_SCHEMA) return false;
  if (row.action === 'revoke') return exactKeys(row, ['schema','action','at','targetId']) && time(row.at) && /^[a-f0-9]{16}$/.test(row.targetId || '');
  return row.action === 'retain' && exactKeys(row, ['schema','action','grantId','recordId','resultId','operationId','taskRef','createdAt','expiresAt','method','route','criterion','criterionAuthority','sourceSchema'])
    && /^[a-f0-9]{16}$/.test(row.grantId || '') && /^[a-f0-9]{32}$/.test(row.recordId || '') && HEX.test(row.resultId || '')
    && row.recordId === row.resultId.slice(0,32) && /^t[a-f0-9]{62}$/.test(row.taskRef || '') && row.operationId === 'normalized-transaction-receipt'
    && row.method === 'GET' && row.route === '/chain/transaction-receipt' && time(row.createdAt) && time(row.expiresAt)
    && Date.parse(row.expiresAt) > Date.parse(row.createdAt) && ['positive','agreed_negative','unknown'].includes(row.criterion)
    && row.criterionAuthority === 'operation_contract' && row.sourceSchema === CUSTOMER_SCHEMA;
}
export function validStripped(row, plane) {
  const stripped = stripRecord(row, plane);
  return stripped !== null && digest(stripped) === digest(row);
}
export function exportRecords(records, tick = () => {}) {
  if (!Array.isArray(records) || records.length > LIMITS.rows) fail('record_limit_exceeded');
  checkTree(records, tick);
  return records;
}
export function parseNdjson(bytes, tick = () => {}) {
  if (bytes.length > LIMITS.fileBytes) fail('input_bytes_exceeded');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = text.split('\n'), rows = [];
  let malformed = 0, torn = 0;
  for (let i = 0; i < lines.length; i++) {
    tick(); const line = lines[i];
    if (!line.trim()) continue;
    if (i === lines.length - 1) { torn++; continue; }
    if (rows.length + malformed >= LIMITS.rows) fail('record_limit_exceeded');
    if (Buffer.byteLength(line) > LIMITS.rowBytes) { malformed++; continue; }
    try { rows.push(parseJson(Buffer.from(line), tick)); }
    catch (e) { if (e.code && e.code !== 'invalid_json') throw e; malformed++; }
  }
  return { rows, malformed, torn };
}
