import { createHash } from 'node:crypto';
import { digest, fail, parseJson } from '../vendor/bounds.mjs';

export const OPERATION = 'normalized-transaction-receipt';
export const ROUTE = '/chain/transaction-receipt';
export const PRODUCT = 'samedaydesk-transaction-receipt';
export const BODY_LIMIT = 12_288;
export const FREE_EXPORT = 'samedaydesk.free-task-observation.retention-export.v1';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const TASK = /^t[a-f0-9]{62}$/;
export const HEX = /^[0-9a-f]{64}$/;
const ATOMIC = /^(0|[1-9][0-9]{0,77})$/;

// Exact existing producer digest domain, not another measurement digest.
export function responseDigest(bytes) {
  return createHash('sha256').update('samedaydesk.commerce-paid-success-evidence.response.v1\0').update(bytes).digest('hex');
}
export function decodeBody(encoded) {
  if (typeof encoded !== 'string' || encoded.length > BODY_LIMIT * 4 / 3 + 4) fail('response_bounds');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.length > BODY_LIMIT) fail('response_bounds');
  return { bytes, body: parseJson(bytes) };
}
export function receiptEvidence(body) {
  if (!body || body.product !== PRODUCT || body.version !== '1.0.0'
    || body.paidValidDelivery !== undefined || body.usefulDelivery !== undefined
    || !['base','ethereum'].includes(body.request?.network)
    || !/^0x[0-9a-f]{64}$/.test(body.request?.transactionHash || '')
    || body.request.transactionHash !== body.transaction?.hash) return null;
  const network = body.request.network === 'base' ? 'eip155:8453' : 'eip155:1';
  if (body.chain?.network !== network) return null;
  const found = body.ok === true && body.decision === 'found' && body.receipt?.found === true
    && ['success','reverted'].includes(body.transaction?.status);
  const negative = body.ok === true && body.decision === 'not_found' && body.receipt?.found === false
    && body.transaction?.status === 'unavailable';
  if (!found && !negative) return null;
  const e = { network, decision: body.decision, receiptFound: body.receipt.found, status: body.transaction.status,
    blockNumber: found ? body.transaction.blockNumber : null,
    gasUsedAtomic: found ? body.transaction.gasUsedAtomic : null,
    effectiveGasPriceWei: found ? body.transaction.effectiveGasPriceWei : null,
    transactionFeeWei: found ? body.transaction.transactionFeeWei : null };
  if (found && ![e.blockNumber,e.gasUsedAtomic,e.effectiveGasPriceWei,e.transactionFeeWei].every(x => typeof x === 'string' && ATOMIC.test(x))) return null;
  return e;
}
export function validEvidence(e) {
  if (!e || Object.keys(e).sort().join(',') !== 'blockNumber,decision,effectiveGasPriceWei,gasUsedAtomic,network,receiptFound,status,transactionFeeWei') return false;
  if (!['eip155:8453','eip155:1'].includes(e.network)) return false;
  return e.decision === 'found' && e.receiptFound === true && ['success','reverted'].includes(e.status)
    && [e.blockNumber,e.gasUsedAtomic,e.effectiveGasPriceWei,e.transactionFeeWei].every(x => typeof x === 'string' && ATOMIC.test(x))
    || e.decision === 'not_found' && e.receiptFound === false && e.status === 'unavailable'
      && [e.blockNumber,e.gasUsedAtomic,e.effectiveGasPriceWei,e.transactionFeeWei].every(x => x === null);
}
export function predicateDescriptor(p) {
  if (p === null || p === undefined) return null;
  if (!p || Object.keys(p).join(',') !== 'id' || !['fee-total-wei','receipt-absence'].includes(p.id)) fail('predicate_rejected');
  return { id: p.id };
}
export function executePredicate(e, p) {
  p = predicateDescriptor(p);
  if (!p) return { status: 'unknown', reason: 'no_independent_predicate', criterion: 'unknown', output: null };
  if (!validEvidence(e)) return { status: 'fail', reason: 'execution_failed', criterion: 'unknown', output: null };
  if (p.id === 'fee-total-wei') {
    const matches = e.decision === 'found' && BigInt(e.gasUsedAtomic) * BigInt(e.effectiveGasPriceWei) === BigInt(e.transactionFeeWei);
    return { status: matches ? 'pass' : 'fail', reason: matches ? null : 'fee_arithmetic_mismatch',
      criterion: matches ? 'positive' : 'unknown', output: matches ? { transactionFeeWei: e.transactionFeeWei } : null };
  }
  const matches = e.decision === 'not_found' && e.receiptFound === false && e.status === 'unavailable';
  return { status: matches ? 'pass' : 'fail', reason: matches ? null : 'receipt_not_absent',
    criterion: matches ? 'agreed_negative' : 'unknown', output: matches ? { minedReceiptAvailable: false, decision: 'not_found' } : null };
}
export function verifyReplay(evidence, predicate, replay) {
  if (!predicate) return executePredicate(evidence, null);
  if (!replay || replay.authority !== 'separate_receipt_execution' || !validEvidence(replay.evidence))
    return { status: 'unknown', reason: 'no_independent_receipt_execution', criterion: 'unknown', output: null };
  if (digest(replay.evidence) !== digest(evidence))
    return { status: 'fail', reason: 'replayed_output_changed', criterion: 'unknown', output: null };
  return executePredicate(replay.evidence, predicate);
}
