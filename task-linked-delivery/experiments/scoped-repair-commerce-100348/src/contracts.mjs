import { digest, normalizeRequest } from 'agent-payment-policy';
import { fail, HARD } from './bounds.mjs';

export { digest };
export const REQUEST = 'samedaydesk.scoped-repair.request.v1';
export const PACKET = 'samedaydesk.scoped-repair.packet.v1';
export const RECORD = 'samedaydesk.scoped-repair.stored-packet.v1';
export const ROUTE = '/commerce/scoped-repair';
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export function only(x, keys, code = 'request_invalid') { if (!plain(x) || Object.keys(x).some(k => !keys.includes(k))) fail(code); }
function text(x, min, max) { return typeof x === 'string' && x.length >= min && x.length <= max && !/[\u0000-\u001f\u007f]/.test(x); }

export function validateRequest(request) {
  only(request, ['schema','requestId','task','kind','operation','terms','input','fix','implementation','quoteIntent','share','limits']);
  if (request.schema !== REQUEST || !ID.test(request.requestId || '') || !['seller','surface'].includes(request.kind)) fail('request_invalid');
  only(request.task, ['id','callerId','statement']);
  if (!ID.test(request.task.id || '') || !ID.test(request.task.callerId || '') || !text(request.task.statement, 40, 512)) fail('task_input_required');
  only(request.terms, ['version','scope']);
  if (!ID.test(request.terms.version || '') || !text(request.terms.scope, 1, 240)) fail('task_input_required');
  only(request.operation, ['id','method','url','body']);
  if (!ID.test(request.operation.id || '')) fail('operation_invalid');
  only(request.limits, Object.keys(HARD), 'limits_invalid');
  if (Object.keys(HARD).some(k => !Object.hasOwn(request.limits, k))) fail('limits_invalid');
  const operation = normalizeRequest(request.operation.method, request.operation.url, Object.hasOwn(request.operation, 'body') ? { body: request.operation.body } : {});
  if (request.operation.url.includes('#')) fail('operation_invalid');
  if (!plain(request.input)) fail('task_input_required');
  if (request.kind === 'surface') {
    if (request.operation.id !== 'scoped-surface-scan' || operation.method !== 'POST' || operation.pathname !== '/commerce/scoped-surface-scan'
      || digest(request.operation.body) !== digest(request.input)) fail('operation_input_mismatch');
    if (request.input.taskId !== request.task.id || request.input.callerId !== request.task.callerId) fail('task_owner_mismatch');
    if (request.fix !== undefined && (request.fix?.request?.taskId !== request.task.id || request.fix?.request?.callerId !== request.task.callerId)) fail('task_owner_mismatch');
  } else {
    if (request.operation.id !== 'seller-output' || operation.method !== 'GET'
      || request.input.operation !== `GET ${operation.pathname}` || request.input.origin !== operation.origin
      || new URL(request.operation.url).search || request.input.callerId !== request.task.callerId || request.input.task !== request.task.statement) fail('operation_input_mismatch');
    if (request.fix !== undefined) fail('seller_fix_must_use_existing_retest');
  }
  if (request.implementation !== undefined) {
    only(request.implementation, ['requested','scope']);
    if (request.implementation.requested !== true || !text(request.implementation.scope, 40, 512)) fail('implementation_scope_required');
  }
  if (request.quoteIntent !== undefined) {
    only(request.quoteIntent, ['purpose','economics','policy']);
    if (request.quoteIntent.purpose !== 'existing_seller_audit') fail('unsupported_paid_scope');
  }
  if (request.share !== undefined && typeof request.share !== 'boolean') fail('share_invalid');
  const binding = { task: request.task, kind: request.kind, operation, termsDigest: digest(request.terms), inputDigest: digest(request.input),
    fixDigest: request.fix ? digest(request.fix) : null, implementation: request.implementation || null };
  return { ...binding, digest: digest(binding) };
}

// This executable predicate evaluates the operation's observations. A caller's
// expected value or a packet checksum is never independent execution evidence.
export function evaluateAcceptance(packet) {
  const test = packet.acceptance;
  if (test?.kind === 'surface') return { passed: packet.observed.independent === true && packet.observed.result === 'no_match',
    reason: packet.observed.independent ? (packet.observed.result === 'no_match' ? 'selected_concern_absent' : 'selected_concern_not_cleared') : 'no_independent_observation' };
  if (test?.kind === 'seller') return { passed: packet.observed.independent === true && packet.observed.useful === true,
    reason: packet.observed.independent ? (packet.observed.useful ? 'task_predicate_matched' : 'task_predicate_not_matched') : 'no_independent_observation' };
  return { passed: false, reason: 'acceptance_contract_missing' };
}

export function acceptanceAction(packet, decision = 'accepted') {
  return { type: 'scoped_delivery_acceptance', taskId: packet.binding.task.id, callerId: packet.binding.task.callerId,
    requestBindingDigest: packet.binding.digest, termsDigest: packet.binding.termsDigest, packetId: packet.packetId,
    acceptanceDigest: digest(packet.acceptance), decision };
}
export function sealPacket(packet) { return { ...packet, packetId: digest(packet) }; }
export function verifyPacket(packet) {
  if (packet?.schema !== PACKET || typeof packet.packetId !== 'string') fail('packet_invalid');
  const { packetId, ...body } = packet;
  if (digest(body) !== packetId || digest(Object.fromEntries(Object.entries(packet.binding).filter(([k]) => k !== 'digest'))) !== packet.binding.digest) fail('packet_changed');
  if (packet.paymentPerformed !== false || packet.recognizedRevenueAtomic !== '0') fail('packet_claim_invalid');
  return packet;
}
