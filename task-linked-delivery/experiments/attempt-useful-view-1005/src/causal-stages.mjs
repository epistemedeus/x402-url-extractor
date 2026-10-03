import { verifiedCaptureFor } from './cut.mjs';
import { FREE_EXPORT, verifyReplay } from '../../free-task-observation-100421/src/receipt.mjs';

const unknown = reason => ({ status: 'unknown', reasons: [reason], evidence: [] });
const observed = (evidence, extra = {}) => ({ status: 'observed', reasons: [], evidence, ...extra });
const names = ['delivery_observation', 'caller_asserted_usefulness', 'independently_replayed_output', 'authorized_retention', 'later_use', 'settlement'];

// The frozen 421 projection keeps its historical replay semantics. Only an
// authenticated native capture can project these independently observed stages.
// Predicates, row validation and payment classification remain existing ports.
export function projectCapturedStages(bundle, projected) {
  const proof = verifiedCaptureFor(bundle);
  if (!proof || projected.diagnostics.conflicts || projected.diagnostics.bindingConflicts) return projected;
  const covered = p => projected.coverage[p].complete;
  if (!covered('attempts') || !covered('task_refs')) return projected;
  const rows = p => covered(p) ? bundle.sources.filter(s => s.plane === p).flatMap(s => s.records) : [];
  const asOf = Date.parse(bundle.question.asOf), from = Date.parse(bundle.question.from);
  const journeys = [];
  for (const event of rows('attempts')) {
    if (Date.parse(event.ts) < from || Date.parse(event.ts) >= asOf) continue;
    const refs = rows('task_refs').filter(r => r.commerceEventId === event.id);
    if (refs.length !== 1) continue;
    const ref = refs[0];
    if (!bundle.question.taskRefs.includes(ref.taskRef) || ref.operationId !== bundle.question.operationIds[0]) continue;
    const forwards = rows('forward').filter(r => r.commerceEventId === event.id && r.operationId === ref.operationId && r.cohort === ref.cohort && r.method === event.method && r.route === event.route);
    const transports = forwards.filter(r => r.stage === 'transport');
    const candidates = [...rows('retention').filter(r => r.schema === FREE_EXPORT), ...(covered('retention') ? proof.paidRetention || [] : [])]
      .filter(r => r.action === 'retain' && r.commerceEventId === event.id && r.taskRef === ref.taskRef
        && r.operationId === ref.operationId && (r.schema !== FREE_EXPORT || r.cohort === ref.cohort)
        && r.method === event.method && r.route === event.route && Date.parse(r.createdAt) <= asOf);
    const record = candidates.length === 1 ? candidates[0] : null;
    const stages = Object.fromEntries(names.map(n => [n, unknown('no_' + n + '_authority')]));
    stages.settlement = unknown(event.result === 'paid_success' ? 'attributable_settlement_unobserved' : 'free_observation_has_no_payment_authority');
    if (event.status === 200 && transports.length === 1) stages.delivery_observation = observed([transports[0].eventId], { authority: 'producer_journal_http_finish_and_transport', at: event.ts });
    else stages.delivery_observation = unknown(!covered('forward') ? 'forward_not_covered' : event.status !== 200 ? 'execution_did_not_deliver' : 'no_bound_response_observation');
    let usefulness = 'unknown', retentionState = 'unknown', currentUseful = false;
    if (record) {
      const o = record.observation;
      stages.caller_asserted_usefulness = !o || o.callerClaim === null ? unknown('no_caller_claim')
        : { status: 'asserted', verification: 'unverified', value: o.callerClaim, reasons: ['caller_claim_is_not_independent_usefulness'], evidence: [record.recordId] };
      const revokes = rows('retention').filter(r => r.action === 'revoke' && r.targetId === record.grantId && Date.parse(r.at) <= asOf);
      retentionState = revokes.length ? 'revoked' : Date.parse(record.expiresAt) <= asOf ? 'expired' : 'active';
      stages.authorized_retention = observed([record.grantId], { authority: 'existing_customer_grant', state: retentionState, currentRights: retentionState === 'active', durability: 'existing_customer_store_no_fsync_guarantee' });
      const bound = !!o && event.status === 200 && transports.length === 1 && transports[0].receiptDigest === o.responseDigest && o.capturedAt === event.ts;
      const replay = o ? verifyReplay(o.evidence, o.predicate, o.replay) : { status: 'unknown', reason: 'no_independent_replay_authority' };
      if (bound && replay.status === 'pass') {
        usefulness = replay.criterion;
        stages.independently_replayed_output = observed([record.recordId], { authority: 'separate_receipt_execution_and_fixed_predicate', criterion: replay.criterion, provenance: o.replay.provenance, historical: true });
      } else stages.independently_replayed_output = unknown(!o ? replay.reason : !bound ? 'response_binding_unobserved' : replay.reason);
      if (!o && event.result === 'paid_success' && transports.length === 1) {
        // resultId hashes canonical JSON; transport hashes exact HTTP bytes.
        // Their owner is the same server-sealed response, never digest equality.
        stages.delivery_observation.schemaUsefulOutput = record.criterion;
        stages.delivery_observation.schemaAuthority = 'existing_paid_receipt_operation_contract';
      }
      currentUseful = usefulness !== 'unknown' && retentionState === 'active';
      const owners = rows('retention').filter(r => r.action === 'retain' && r.recordId === record.recordId);
      const reads = rows('reads').filter(r => r.recordId === record.recordId && r.taskRef === ref.taskRef && Date.parse(r.at) > Date.parse(record.createdAt)
        && Date.parse(r.at) < Date.parse(record.expiresAt) && Date.parse(r.at) <= asOf && !revokes.some(v => Date.parse(v.at) <= Date.parse(r.at)));
      if (new Set(owners.map(r => r.grantId)).size !== 1) stages.later_use = unknown('ambiguous_grant_owner');
      else if (reads.length) stages.later_use = observed(reads.map(r => r.eventId), { authority: 'existing_authorized_retained_read', callerReceipt: 'unknown', appliedUse: 'unknown', historical: true });
      else stages.later_use = unknown(covered('reads') ? 'no_authorized_later_read' : 'reads_not_covered');
    }
    // The registered reconciler's row must name the original event and finish
    // timestamp. Its retained transport is separately bound to the same event.
    // Classification and revenue remain with that existing reconciler.
    if (event.result === 'paid_success' && covered('settlements')) {
      const settlements = rows('settlements').filter(r => r.sourceEventId === event.id && r.sourceEventTimestamp === event.ts && r.route === event.route);
      if (settlements.length === 1 && transports.length === 1) stages.settlement = observed([settlements[0].sourceEventId], {
        authority: 'existing_settlement_journal', paymentClass: settlements[0].paymentClass || 'unclassified', settlementReference: settlements[0].settlementReference });
    }
    journeys.push({ commerceEventId: event.id, taskRef: ref.taskRef, operationId: ref.operationId, cohort: ref.cohort,
      sourceDeliveryAttribution: proof.sourceDeliveryAttribution?.[event.id] || null,
      classification: ['owner_qa', 'controlled_test'].includes(ref.cohort) || ['internal', 'owner_monitor'].includes(event.originClass) ? 'owner_internal'
        : ref.cohort === 'sponsored_trial' ? 'recruited_sponsored' : 'unclassified', identity: 'not_inferred', retentionState, usefulness, currentUseful, stages, paymentPermitted: false });
  }
  return { ...projected, journeys };
}
