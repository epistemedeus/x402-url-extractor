import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { budget, checkTree, digest, fail } from '../vendor/bounds.mjs';
import { isTaskRefRecord, isForwardV2Record } from '../vendor/causal-contract.mjs';
import { BODY_LIMIT, decodeBody, HEX, OPERATION, PRODUCT, predicateDescriptor, receiptEvidence, responseDigest, ROUTE, TASK, UUID, verifyReplay } from './receipt.mjs';
import { stripRecord } from './export.mjs';

const CUSTOMER_SCHEMA = 'samedaydesk.useful-result-reuse.customer-grant.v1';
const CUSTOMER_FILE = 'useful-result-customer.ndjson';
const sha = x => createHash('sha256').update(x).digest('hex');
const refusal = (reason, extra = {}) => ({ accepted: false, reason, wrote: false, grant: null,
  paymentPermitted: false, paidValidDelivery: false, recognizedRevenueAtomic: '0', ...extra });

// Dependencies are explicitly injected existing merchant ports, sharing ONE
// createReuseStore instance with createCustomerRetention. No implicit dir reader,
// provider, credentials, queue, event store or new identity authority.
export function createFreeTaskObservation({ internalToken, writerProcessCount = 1, customerStore, customer,
  readCut, authorizeOutcomeBinding, openCausalCommerceEvent, requestIdentityFor, replayReceipt = null,
  now = () => Date.now(), ttlMs = 7 * 86400000 } = {}) {
  if (writerProcessCount !== 1) fail('one_writer_required');
  if (!customerStore?.mutate || !customerStore?.read || !customer?.readDeliveredReceipt
    || !customer?.revokeDeliveredReceipt || ![readCut,authorizeOutcomeBinding,openCausalCommerceEvent,requestIdentityFor].every(x => typeof x === 'function')) fail('existing_ports_required');
  function authorized(suppliedToken) {
    if (typeof internalToken !== 'string' || Buffer.byteLength(internalToken) < 32 || typeof suppliedToken !== 'string') return false;
    const a = Buffer.from(internalToken), b = Buffer.from(suppliedToken);
    return a.length === b.length && timingSafeEqual(a,b);
  }
  function binding(input) {
    if (!authorized(input.suppliedToken)) fail('unauthorized');
    const eventId = openCausalCommerceEvent(input.causalEventProof, internalToken);
    if (!UUID.test(input.commerceEventId || '') || eventId !== input.commerceEventId) fail('wrong_attempt');
    if (input.operationId !== OPERATION || input.method !== 'GET' || input.route !== ROUTE) fail('wrong_resource');
    const claim = authorizeOutcomeBinding({ 'x-samedaydesk-internal': input.suppliedToken,
      'x-samedaydesk-outcome-task': input.taskLabel, 'x-samedaydesk-outcome-operation': input.operationId,
      'x-samedaydesk-outcome-cohort': input.cohort }, internalToken);
    if (!claim?.taskRef || !TASK.test(input.taskRef || '') || claim.taskRef !== input.taskRef) fail('wrong_task');
    return { claim, eventId };
  }
  async function predecessor(input, claim, eventId) {
    const cut = await readCut();
    if (!cut || cut.coverage !== 'complete' || cut.malformed || cut.torn || cut.rejected) fail('causal_cut_not_covered');
    const events = cut.attempts.filter(x => x.id === eventId);
    const refs = cut.task_refs.filter(x => x.commerceEventId === eventId);
    if (events.length !== 1 || refs.length !== 1 || !isTaskRefRecord(refs[0])) fail('missing_or_conflicting_predecessor');
    const e = events[0], ref = refs[0];
    if (ref.taskRef !== claim.taskRef || ref.operationId !== OPERATION || ref.cohort !== claim.cohort) fail('wrong_task');
    if (e.method !== 'GET' || e.route !== ROUTE || e.result !== 'paid_route_response'
      || e.status !== 200 || e.paymentPresent !== false || e.replayed === true) fail('not_free_causal_response');
    if (!Number.isFinite(Date.parse(e.ts)) || Date.parse(e.ts) > now()) fail('http_finish_not_observed');
    const transports = cut.forward.filter(x => isForwardV2Record(x) && x.commerceEventId === eventId && x.stage === 'transport');
    if (transports.length !== 1 || transports[0].operationId !== OPERATION || transports[0].cohort !== claim.cohort
      || transports[0].method !== 'GET' || transports[0].route !== ROUTE) fail('no_bound_response_observation');
    return { event: e, transport: transports[0] };
  }
  function priorResult(rows, eventId, taskRef, requestDigest) {
    const matches = rows.filter(r => r.schema === CUSTOMER_SCHEMA && r.action === 'retain' && r.commerceEventId === eventId);
    if (matches.length > 1) return refusal('observation_conflict');
    const prior = matches[0];
    if (!prior) return null;
    if (!stripRecord(prior,'retention')) return refusal('record_integrity');
    if (prior.taskRef !== taskRef || prior.observation?.requestDigest !== requestDigest) return refusal('observation_conflict');
    if (rows.some(r => r.action === 'revoke' && r.targetId === prior.grantId)) return refusal('revoked');
    if (Date.parse(prior.expiresAt) <= now()) return refusal('expired');
    return refusal('duplicate', { resultId: prior.resultId, reconciliation: 'existing_record_read_back',
      grantAcknowledgement: 'unknown_if_original_ack_lost', observation: prior.observation });
  }
  async function observe(input) {
    const tick = budget(); checkTree(input&&typeof input==='object'?{...input,bodyBase64:null}:input,tick);
    if(!input||typeof input!=='object'||Array.isArray(input)) return refusal('input_rejected');
    if (input.optIn !== true) return refusal('not_requested');
    if (Object.keys(input).some(k => !['optIn','suppliedToken','causalEventProof','commerceEventId','taskLabel','taskRef','operationId','cohort','method','route','bodyBase64','predicate','callerClaim','retainUntil'].includes(k))) return refusal('unsupported_authority_field');
    let claim, eventId, bytes, body, evidence, predicate, event, transport;
    try {
      ({claim,eventId} = binding(input)); ({bytes,body} = decodeBody(input.bodyBase64));
      predicate = predicateDescriptor(input.predicate);
      if (input.callerClaim !== undefined && typeof input.callerClaim !== 'boolean') fail('claim_rejected');
      ({event,transport} = await predecessor(input,claim,eventId));
      if (transport.receiptDigest !== responseDigest(bytes)) fail('response_changed');
      evidence = receiptEvidence(body); if (!evidence) fail('execution_failed');
    } catch(e) { return refusal(e.code || 'observation_unavailable'); }
    const requestDigest = digest({eventId, taskRef:claim.taskRef, responseDigest:responseDigest(bytes), predicate, callerClaim:input.callerClaim ?? null,
      retainUntil:input.retainUntil ?? null});
    const prior = priorResult(await customerStore.read(CUSTOMER_FILE),eventId,claim.taskRef,requestDigest);
    if (prior) return prior;
    const clock = now(); let expires = clock + ttlMs;
    if (input.retainUntil !== undefined) {
      const t = Date.parse(input.retainUntil);
      if (typeof input.retainUntil !== 'string' || !Number.isFinite(t) || t <= clock || t > expires) return refusal('expiry_rejected');
      expires = t;
    }
    let replay = null;
    if (predicate && typeof replayReceipt === 'function') {
      try {
        const independent = await replayReceipt({ ...body.request });
        const replayEvidence = receiptEvidence(independent.body);
        if (replayEvidence) replay = { authority:'separate_receipt_execution', evidence:replayEvidence,
          provenance:independent.provenance === 'fixture_rpc' ? 'fixture_rpc' : 'explicit_observation_port' };
      } catch { /* A failed replay is unknown; never retry a mutation or provider. */ }
    }
    const independent = verifyReplay(evidence,predicate,replay);
    const observation = { authority:'authorized_caller_received_bytes', commerceEventId:eventId,
      capturedAt:event.ts, observedAt:new Date(clock).toISOString(), responseDigest:responseDigest(bytes), responseByteLength:bytes.length,
      evidence, predicate, callerClaim:input.callerClaim ?? null, requestDigest, replay, independent };
    // Reuse the customer-held 32-byte grant and its hashed journal representation.
    // This is the existing bearer capability contract; no signing key or identity.
    const token = randomBytes(32).toString('hex'), grantHash = sha(token), resultId = digest(body);
    const record = { schema:CUSTOMER_SCHEMA, action:'retain', actions:['read','revoke'],
      body, resultId, eventDigest:resultId, recordId:resultId.slice(0,32), grantHash, grantId:grantHash.slice(0,16),
      requestIdentity:requestIdentityFor({method:'GET',route:ROUTE,...body.request}),
      createdAt:new Date(clock).toISOString(), expiresAt:new Date(expires).toISOString(),
      commerceEventId:eventId, taskRef:claim.taskRef, taskJoin:'bound', cohort:claim.cohort,
      operationId:OPERATION, method:'GET', route:ROUTE, outcomeSchema:PRODUCT, outcomeSchemaVersion:'1.0.0',
      evidenceClass:'free_observed_delivery', paidValidDelivery:false, paymentPermitted:false,
      settlementStatus:'unknown', settlementDigest:null, observation };
    if (Buffer.byteLength(JSON.stringify(record)+'\n') > customerStore.maxRecordBytes || bytes.length > BODY_LIMIT) return refusal('record_bounds');
    try {
      const decision = await customerStore.mutate(CUSTOMER_FILE, async rows => {
        const prior = priorResult(rows,eventId,claim.taskRef,requestDigest);
        return prior ? {result:prior} : {append:record,result:{accepted:true,reason:null,wrote:true,
          grant:token,resultId,grantId:record.grantId,expiresAt:record.expiresAt,observation,
          evidenceClass:record.evidenceClass,paymentPermitted:false,paidValidDelivery:false,recognizedRevenueAtomic:'0'}};
      });
      return decision;
    } catch {
      // Explicit physical readback classifies a lost ACK. Never append again.
      try {
        const prior = priorResult(await customerStore.read(CUSTOMER_FILE),eventId,claim.taskRef,requestDigest);
        if (prior) return prior;
      } catch { /* The outcome is unknown when retained bytes cannot be read. */ }
      return refusal('write_outcome_unknown', {commerceEventId:eventId});
    }
  }
  async function readDeliveredReceipt(input) {
    const rows = await customerStore.read(CUSTOMER_FILE);
    const hash = typeof input.token === 'string' && HEX.test(input.token) ? sha(input.token) : '';
    const row = rows.find(r => r.action === 'retain' && r.grantHash === hash);
    if (row?.evidenceClass === 'free_observed_delivery') {
      if (!stripRecord(row,'retention')) return {found:true,reason:'record_integrity',result:null};
      if (input.taskRef && input.taskRef !== row.taskRef) return {found:true,reason:'wrong_task',result:null};
      if (input.commerceEventId && input.commerceEventId !== row.commerceEventId) return {found:true,reason:'wrong_attempt',result:null};
    }
    const result = await customer.readDeliveredReceipt(input);
    if (row?.evidenceClass === 'free_observed_delivery' && !result.reason) {
      return {...result, useful:row.observation?.independent?.status === 'pass' ? 'true' : 'unknown',
        independentOutput:row.observation?.independent || null, currentRetentionRights:true, paymentPermitted:false};
    }
    return result;
  }
  return Object.freeze({ observe, readDeliveredReceipt, revokeDeliveredReceipt:customer.revokeDeliveredReceipt,
    async grantActionAllowed(token,action) {
      const hash=typeof token==='string'&&HEX.test(token)?sha(token):'';
      const row=(await customerStore.read(CUSTOMER_FILE)).find(r=>r.action==='retain'&&r.grantHash===hash);
      return row?.evidenceClass!=='free_observed_delivery'||Array.isArray(row.actions)&&row.actions.includes(action);
    },
    async reconcile(input) {
      try {
        const {claim,eventId} = binding(input);
        const rows = await customerStore.read(CUSTOMER_FILE);
        const candidates = rows.filter(r => r.action === 'retain' && r.commerceEventId === eventId && r.taskRef === claim.taskRef);
        if (candidates.length !== 1) return refusal(candidates.length ? 'observation_conflict' : 'write_outcome_unknown');
        return priorResult(rows,eventId,claim.taskRef,candidates[0].observation.requestDigest);
      } catch(e) {return refusal(e.code || 'write_outcome_unknown');}
    } });
}
