import { LIMITS, budget, canonical, checkTree, digest, fail, outputJson } from './bounds.mjs';
import { EXPORT_SCHEMA, time, validStripped } from './export.mjs';
import { isSchemaValidDeliveryEvidence, FORWARD_WRITER_ID, FORWARD_PRODUCER_BASE_COMMIT } from '../vendor/causal-contract.mjs';
import { projectCosts, settleEconomics, observeGross } from '../vendor/economics/economics.mjs';

export const BUNDLE_SCHEMA = 'samedaydesk.task-demand.bundle.v1';
export const REPORT_SCHEMA = 'samedaydesk.task-demand.report.v1';
export const RETAINED_SCHEMA = 'samedaydesk.task-demand.retained.v1';
export const BASE_COMMIT = '5008b5e7213511e26eb3d369fcc0056e48b4ef20';
export const PLANES = ['attempts','task_refs','forward','retention','reads','settlements'];
export const CLASSES = ['owner_internal','recruited_sponsored','attributable_independent','unclassified'];
const COHORTS = ['controlled_test','owner_qa','sponsored_trial','external_unknown'];
const STAGES = ['attempt','valid_delivery','claimed_usefulness','retention','later_use','settlement'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TASK = /^t[a-f0-9]{62}$/;
function only(value, keys, code) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail(code); }
function list(value, re) { return Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(x => re.test(x)) && new Set(value).size === value.length; }
function selected(list, value) { return !list || list.includes(value); }

export function validateQuestion(q) {
  only(q, ['id','text','populationId','from','to','asOf','taskRefs','operationIds','cohorts'], 'question_rejected');
  if (!SLUG.test(q.id || '') || !SLUG.test(q.populationId || '') || typeof q.text !== 'string' || q.text.length < 1 || q.text.length > 512) fail('question_rejected');
  if (![q.from,q.to,q.asOf].every(time) || Date.parse(q.from) >= Date.parse(q.to) || Date.parse(q.asOf) < Date.parse(q.to)) fail('question_time_rejected');
  if (!list(q.operationIds, SLUG) || !Array.isArray(q.cohorts) || q.cohorts.length < 1 || q.cohorts.length > 4 || !q.cohorts.every(c => COHORTS.includes(c)) || new Set(q.cohorts).size !== q.cohorts.length) fail('question_population_rejected');
  if (q.taskRefs !== undefined && !list(q.taskRefs, TASK)) fail('question_task_rejected');
  return q;
}
export function validateSource(s) {
  only(s, ['schema','id','plane','kind','populationId','scope','from','to','asOf','coverage','producerCommit','records','intake'], 'source_rejected');
  if (s.schema !== EXPORT_SCHEMA || !SLUG.test(s.id || '') || !PLANES.includes(s.plane)
    || !['synthetic_fixture','supported_read_only_export'].includes(s.kind) || !SLUG.test(s.populationId || '')
    || s.producerCommit !== BASE_COMMIT || !['complete','partial','unknown'].includes(s.coverage)
    || ![s.from,s.to,s.asOf].every(time) || Date.parse(s.from) >= Date.parse(s.to) || Date.parse(s.asOf) < Date.parse(s.to)
    || !Array.isArray(s.records)) fail('source_rejected');
  only(s.scope,['operationIds','cohorts','taskRefs'],'source_scope_rejected');
  if (!list(s.scope.operationIds,SLUG) || !Array.isArray(s.scope.cohorts) || s.scope.cohorts.length < 1 || s.scope.cohorts.length > 4
    || !s.scope.cohorts.every(c=>COHORTS.includes(c)) || new Set(s.scope.cohorts).size !== s.scope.cohorts.length
    || s.scope.taskRefs !== undefined && !list(s.scope.taskRefs,TASK)) fail('source_scope_rejected');
  if (s.intake) {
    only(s.intake, ['rawBytes','rawSha256','malformed','torn','rejected'], 'intake_rejected');
    if (!/^[a-f0-9]{64}$/.test(s.intake.rawSha256 || '') || !['rawBytes','malformed','torn','rejected'].every(k => Number.isSafeInteger(s.intake[k]) && s.intake[k] >= 0) || s.intake.rawBytes > LIMITS.fileBytes) fail('intake_rejected');
  }
  return s;
}
function rowId(row, plane) {
  if (plane === 'attempts') return row.id;
  if (plane === 'settlements') return row.settlementReference;
  if (plane === 'retention') return row.action === 'retain' ? 'retain:' + row.grantId : 'revoke:' + row.targetId + ':' + row.at;
  return row.eventId;
}
function classify(ref, event, settlement) {
  if (['controlled_test','owner_qa'].includes(ref.cohort) || ['internal','owner_monitor'].includes(event.originClass) || ['internal','affiliated','validation'].includes(settlement?.paymentClass)) return 'owner_internal';
  if (ref.cohort === 'sponsored_trial' || settlement?.paymentClass === 'incentivized') return 'recruited_sponsored';
  // The explicit existing reconciler class is an attribution label. No wallet,
  // actor, digest or UA is available here, and no customer identity is inferred.
  if (settlement?.paymentClass === 'independent') return 'attributable_independent';
  return 'unclassified';
}
function unknown(reason) { return { status: 'unknown', reasons: [reason], evidence: [] }; }
function observed(ids, extra = {}) { return { status: 'observed', reasons: [], evidence: ids.sort(), ...extra }; }
function sanitizedBundle(bundle) {
  return { ...bundle, sources: bundle.sources.map(s => ({ ...s, records:s.records.map(r => {
    if (validStripped(r,s.plane)) return r;
    if (r?.schema === 'samedaydesk.task-demand.rejected-row.v1' && Object.keys(r).length === 2 && /^[a-f0-9]{64}$/.test(r.materialDigest || '')) return r;
    return {schema:'samedaydesk.task-demand.rejected-row.v1',materialDigest:digest(r)};
  }) })) };
}

function effort(input, gross) {
  if (input === undefined) input = {};
  only(input, ['source','directBaseline','marginal'], 'economics_rejected');
  if (input.source !== undefined && input.source !== 'useful-economics-100290') fail('economics_source_rejected');
  const allowed = ['grossSettledRevenueAtomic','feesAtomic','cashMarginalAtomic','reviewAdaptationAtomic','includedQuotaOpportunityCostAtomic','sharedRndAtomic','apiEquivalentBuildEffort','measuredLaterSavedWork'];
  for (const part of [input.directBaseline,input.marginal]) {
    if (!part) continue;
    only(part, allowed, 'economics_rejected');
    for (const [key, v] of Object.entries(part)) {
      if (key === 'apiEquivalentBuildEffort') {
        only(v, ['probes','tokens'], 'economics_rejected');
        if (!Number.isSafeInteger(v.probes) || v.probes < 0 || !(v.tokens === undefined || v.tokens === 'unknown' || Number.isSafeInteger(v.tokens) && v.tokens >= 0)) fail('economics_rejected');
      } else if (key === 'measuredLaterSavedWork') {
        only(v, ['unit','saved'], 'economics_rejected');
        if (!SLUG.test(v.unit || '') || !Number.isSafeInteger(v.saved) || v.saved < 0) fail('economics_rejected');
      } else {
        only(v, ['atomic','lower','upper','known','reason','allocatable','countsAsCash'], 'economics_rejected');
        if (v.allocatable === true) fail('shared_rnd_not_allocatable');
        if (v.reason !== undefined && !/^[a-z0-9_]{1,80}$/.test(v.reason)) fail('economics_rejected');
      }
    }
  }
  const baseline = projectCosts(input.directBaseline);
  const marginal = projectCosts(input.marginal);
  const result = settleEconomics({ supplied: input.marginal, observedGross: gross });
  // Existing mergeCosts deliberately leaves historic tokens unknown. Preserve
  // directly supplied metered probes/tokens as their own plane without pricing.
  result.planes.apiEquivalentBuildEffort = marginal.apiEquivalentBuildEffort;
  return { source: 'useful-economics-100290/src/economics.mjs@' + BASE_COMMIT,
    directBaseline: baseline, marginal, cashAssessment: result,
    comparison: { savings: null, reason: 'no_matched_metered_effort_comparison', sumsIntoCash: false },
    historicalCommissions: { netUsdc: '2.85', source: 'experiments/seller-repair-service-100266/commercial/deliver.mjs@' + BASE_COMMIT,
      currentRun: false, historicalTokens: 'unknown', recalibrated: false, includedInCashAssessment: false } };
}

export function projectBundle(bundle, { tick = budget(), priorReportId = null } = {}) {
  checkTree(bundle, tick);
  if (Buffer.byteLength(canonical(bundle)) > LIMITS.fileBytes) fail('input_bytes_exceeded');
  only(bundle, ['schema','question','sources','economics'], 'bundle_rejected');
  if (bundle.schema !== BUNDLE_SCHEMA || !Array.isArray(bundle.sources) || bundle.sources.length > LIMITS.sources) fail('bundle_rejected');
  const q = validateQuestion(bundle.question), start = Date.parse(q.from), end = Date.parse(q.to), asOf = Date.parse(q.asOf);
  const diagnostics = { duplicates: 0, conflicts: 0, rejectedRecords: 0, missingCausalSide: 0,
    bindingConflicts: 0, wrongTaskOrOperation: 0, ambiguousRetention: 0, lateRecords: 0, excludedSources: [], unboundEvents: [] };
  const sources = [], rows = Object.fromEntries(PLANES.map(p => [p, []])), seen = new Map(), blocked = new Set();
  const sourceIds = new Set(); let count = 0,rawTotal=0;
  for (const source of bundle.sources) {
    tick(); validateSource(source);
    if (sourceIds.has(source.id)) fail('duplicate_source_id'); sourceIds.add(source.id);
    count += source.records.length; if (count > LIMITS.rows) fail('record_limit_exceeded');
    rawTotal += source.intake?.rawBytes || 0;
    if (rawTotal > LIMITS.totalBytes) fail('total_raw_bytes_exceeded');
    const reasons = [];
    if (source.populationId !== q.populationId) reasons.push('population_misaligned');
    if (!q.operationIds.every(x=>source.scope.operationIds.includes(x)) || !q.cohorts.every(x=>source.scope.cohorts.includes(x))
      || source.scope.taskRefs && (!q.taskRefs || !q.taskRefs.every(x=>source.scope.taskRefs.includes(x)))) reasons.push('population_scope_not_covered');
    if (Date.parse(source.from) > start || Date.parse(source.to) < asOf) reasons.push('time_not_covered');
    if (Date.parse(source.asOf) > asOf || Date.parse(source.to) > asOf) reasons.push('cut_after_question_asof');
    if (source.coverage !== 'complete') reasons.push('source_coverage_' + source.coverage);
    if (source.intake && (source.intake.malformed || source.intake.torn || source.intake.rejected)) reasons.push('unusable_intake');
    let rejected = 0;
    for (const row of source.records) {
      tick();
      if (Buffer.byteLength(canonical(row)) > LIMITS.rowBytes) fail('row_bytes_exceeded');
      if (!validStripped(row, source.plane)) { rejected++; diagnostics.rejectedRecords++; continue; }
      const at = row.ts || row.at || row.createdAt || row.reconciledAt;
      if (at && (Date.parse(at) < Date.parse(source.from) || Date.parse(at) > Date.parse(source.to))) reasons.push('record_time_outside_cut');
      if (source.populationId !== q.populationId || Date.parse(source.asOf) > asOf || Date.parse(source.to) > asOf) continue;
      const key = source.plane + ':' + rowId(row, source.plane), hash = digest(row);
      const prior = seen.get(key);
      if (prior) {
        if (prior.hash === hash) diagnostics.duplicates++;
        else { diagnostics.conflicts++; blocked.add(key); }
        continue;
      }
      const item = { row, sourceId: source.id, key, hash };
      seen.set(key, item); rows[source.plane].push(item);
    }
    if (rejected) reasons.push('rejected_records');
    if (source.populationId !== q.populationId) diagnostics.excludedSources.push(source.id);
    sources.push({ ...Object.fromEntries(['id','plane','kind','populationId','scope','from','to','asOf','coverage','producerCommit'].map(k => [k,source[k]])),
      projectedDigest: digest(sanitizedBundle({sources:[source]}).sources[0].records), intake: source.intake || null, records: source.records.length, rejected,
      alignedComplete: reasons.length === 0, reasons });
  }
  for (const p of PLANES) rows[p] = rows[p].filter(x => !blocked.has(x.key));
  const refs = new Map(), badRefs = new Set();
  for (const item of rows.task_refs) {
    const r = item.row, old = refs.get(r.commerceEventId);
    if (old && (old.row.taskRef !== r.taskRef || old.row.operationId !== r.operationId || old.row.cohort !== r.cohort)) {
      badRefs.add(r.commerceEventId); diagnostics.bindingConflicts++;
    } else refs.set(r.commerceEventId, item);
  }
  // Duplicate task-ref event-id conflicts must poison their causal target too.
  for (const key of blocked) if (key.startsWith('task_refs:')) badRefs.add(seen.get(key).row.commerceEventId);
  const attempts = rows.attempts.filter(x => Date.parse(x.row.ts) >= start && Date.parse(x.row.ts) < end);
  const eventsById = new Map(rows.attempts.map(x => [x.row.id,x]));
  for (const [id, ref] of refs) if (!eventsById.has(id) && selected(q.taskRefs,ref.row.taskRef) && selected(q.operationIds,ref.row.operationId) && q.cohorts.includes(ref.row.cohort)) diagnostics.missingCausalSide++;
  const bindings = [];
  for (const attempt of attempts) {
    const event = attempt.row, ref = refs.get(event.id)?.row;
    if (!ref || badRefs.has(event.id)) {
      diagnostics.unboundEvents.push({ commerceEventId: event.id, reason: badRefs.has(event.id) ? 'causal_binding_conflict' : 'missing_server_task_ref' }); continue;
    }
    if (!selected(q.taskRefs,ref.taskRef) || !selected(q.operationIds,ref.operationId) || !q.cohorts.includes(ref.cohort)) { diagnostics.wrongTaskOrOperation++; continue; }
    bindings.push({ attempt, ref });
  }
  const peers = new Map();
  for (const { row: event } of rows.attempts) {
    const ref = refs.get(event.id)?.row;
    if (!ref || badRefs.has(event.id)) continue;
    const k = ref.taskRef + ':' + ref.operationId; peers.set(k,(peers.get(k) || 0) + 1);
  }
  const journeys = [];
  for (const { attempt, ref } of bindings) {
    tick(); const e = attempt.row;
    const forward = rows.forward.filter(x => x.row.commerceEventId === e.id && x.row.operationId === ref.operationId
      && x.row.cohort === ref.cohort && x.row.route === e.route && x.row.method === e.method);
    const wrongForward = rows.forward.filter(x => x.row.commerceEventId === e.id && !forward.includes(x));
    diagnostics.wrongTaskOrOperation += wrongForward.length;
    const deliveries = forward.filter(x => isSchemaValidDeliveryEvidence(x.row) && e.result === 'paid_success' && e.status >= 200 && e.status < 300);
    const delivery = deliveries.length === 1 ? deliveries[0] : null;
    const ledger = rows.settlements.filter(x => x.row.sourceEventId === e.id && x.row.route === e.route && x.row.sourceEventTimestamp === e.ts);
    const validLedger = ledger.filter(x => Date.parse(x.row.reconciledAt) <= asOf);
    diagnostics.lateRecords += ledger.length - validLedger.length;
    const settlement = validLedger.length === 1 && e.result === 'paid_success' && e.status >= 200 && e.status < 300 ? validLedger[0] : null;
    const stages = { attempt: observed([e.id], { at: e.ts, result: e.result }),
      valid_delivery: delivery ? observed([delivery.row.eventId], { at: e.ts, timing: 'same_causal_response' }) : unknown(deliveries.length > 1 ? 'conflicting_delivery' : 'no_schema_valid_delivery'),
      claimed_usefulness: unknown('no_operation_contract_usefulness'), retention: unknown('no_bound_retention'), later_use: unknown('no_authorized_later_read'),
      settlement: settlement ? observed([settlement.row.sourceEventId], { at: settlement.row.reconciledAt, amountAtomic: settlement.row.amountAtomic }) : unknown(e.result === 'replay_success' ? 'replay_is_not_new_payment' : validLedger.length > 1 ? 'multiple_settlements_for_attempt' : 'no_runtime_reconciliation') };
    if (!delivery) {
      const failed = forward.filter(x => x.row.stage === 'delivery').map(x => x.row.deliveryClass).filter(Boolean);
      stages.valid_delivery.reasons.push(...new Set(failed));
      if (e.status === 200) stages.valid_delivery.reasons.push('http200_is_not_delivery_authority');
      if (e.result === 'challenge') stages.valid_delivery.reasons.push('challenge_is_not_delivery');
    }
    const candidateRetains = rows.retention.filter(x => x.row.action === 'retain' && x.row.taskRef === ref.taskRef && x.row.operationId === ref.operationId && x.row.route === e.route && x.row.method === e.method);
    const responseStart = Date.parse(e.ts) - (e.durationMs || 0);
    const retains = candidateRetains.filter(x => Date.parse(x.row.createdAt) >= responseStart && Date.parse(x.row.createdAt) <= asOf);
    diagnostics.lateRecords += candidateRetains.filter(x => Date.parse(x.row.createdAt) > asOf).length;
    retains.sort((a,b) => a.row.createdAt.localeCompare(b.row.createdAt) || a.row.grantId.localeCompare(b.row.grantId));
    const ambiguous = peers.get(ref.taskRef + ':' + ref.operationId) !== 1 || retains.length > 1 && retains.at(-1).row.createdAt === retains.at(-2).row.createdAt;
    const retain = ambiguous ? null : retains.at(-1);
    if (ambiguous && retains.length) {
      diagnostics.ambiguousRetention++; stages.retention = unknown('ambiguous_causal_attempt_or_owner'); stages.claimed_usefulness = unknown('ambiguous_causal_attempt_or_owner'); stages.later_use = unknown('ambiguous_causal_attempt_or_owner');
    }
    let retainedState = 'unknown';
    if (retain) {
      const r = retain.row;
      // Received receipt retention validates the executed receipt contract. That
      // contract is distinct from the generic HTTP schema validator, which does
      // not support this route. Never fabricate its validator verdict.
      if (settlement && r.criterion !== 'unknown' && e.result === 'paid_success' && e.status >= 200 && e.status < 300) {
        stages.valid_delivery = observed([r.recordId], { at: r.createdAt,
          authority: 'existing_receipt_retention_contract', timing: Date.parse(r.createdAt) < Date.parse(e.ts)
            ? 'retention_created_during_causal_response' : 'retention_created_after_causal_attempt' });
      }
      const revoked = rows.retention.filter(x => x.row.action === 'revoke' && x.row.targetId === r.grantId && Date.parse(x.row.at) <= asOf);
      const expired = Date.parse(r.expiresAt) <= asOf;
      retainedState = revoked.length ? 'revoked' : expired ? 'expired' : 'active';
      stages.retention = observed([r.recordId], { at: r.createdAt, state: retainedState, expiresAt: r.expiresAt });
      if (stages.valid_delivery.status === 'observed' && settlement && r.criterion !== 'unknown') {
        stages.claimed_usefulness = observed([r.recordId], { at: r.createdAt, claim: r.criterion,
          authority: 'operation_contract', current: retainedState === 'active', outsideUseEstablished: false });
        if (retainedState !== 'active') stages.claimed_usefulness.reasons.push('grant_' + retainedState);
      } else stages.claimed_usefulness = unknown(stages.valid_delivery.status !== 'observed' ? 'claim_without_valid_delivery' : !settlement ? 'claim_without_runtime_settlement' : 'criterion_unknown');
      const reads = rows.reads.filter(x => x.row.recordId === r.recordId && x.row.taskRef === ref.taskRef);
      const wrongTaskRead = rows.reads.some(x => x.row.recordId === r.recordId && x.row.taskRef !== ref.taskRef);
      const owners = rows.retention.filter(x => x.row.action === 'retain' && x.row.recordId === r.recordId);
      const usefulReads = reads.filter(x => Date.parse(x.row.at) > Date.parse(r.createdAt) && Date.parse(x.row.at) < Date.parse(r.expiresAt)
        && Date.parse(x.row.at) <= asOf && !revoked.some(v => Date.parse(v.row.at) <= Date.parse(x.row.at)))
        .sort((a,b)=>a.row.at.localeCompare(b.row.at) || a.row.eventId.localeCompare(b.row.eventId));
      diagnostics.lateRecords += reads.filter(x => Date.parse(x.row.at) > asOf).length;
      if (new Set(owners.map(x => x.row.grantId)).size !== 1) stages.later_use = unknown('ambiguous_grant_owner');
      else if (usefulReads.length && stages.claimed_usefulness.status === 'observed') stages.later_use = observed(usefulReads.map(x => x.row.eventId), { at: usefulReads[0].row.at,
        authority: 'existing_authorized_retained_read', utility: r.criterion, outsideUseEstablished: false, historical: true });
      else stages.later_use = unknown(reads.length ? 'read_before_retention_after_expiry_revocation_or_without_usefulness' : 'no_authorized_later_read');
      if (wrongTaskRead && stages.later_use.status === 'unknown') stages.later_use.reasons.push('read_task_mismatch');
    }
    const producerReuse = forward.filter(x => x.row.stage === 'retained_use');
    if (producerReuse.length && stages.later_use.status === 'unknown') stages.later_use.reasons.push('producer_retained_use_has_no_time_or_grant');
    if (forward.some(x => x.row.stage === 'settlement') && !settlement) stages.settlement.reasons.push('forward_settlement_requires_runtime_readback');
    const classification = classify(ref,e,settlement?.row);
    if (stages.later_use.status === 'observed') stages.later_use.outsideUseEstablished = classification === 'attributable_independent'
      && sources.every(s => s.kind === 'supported_read_only_export');
    const gaps = STAGES.filter(s => stages[s].status !== 'observed').map(s => ({ stage: s, reasons: stages[s].reasons }));
    const reasons = [e.result, ...(e.paymentFailureCode ? [e.paymentFailureCode] : [])];
    if (e.result === 'replay_success') reasons.push('replay_is_not_new_payment');
    journeys.push({ commerceEventId: e.id, taskRef: ref.taskRef, operationId: ref.operationId, cohort: ref.cohort,
      classification, classificationAuthority: classification === 'attributable_independent' ? 'existing_explicit_independent_payer_class' : 'existing_server_classification',
      identity: 'not_inferred', retainedState, stages, gaps, reasons });
  }
  journeys.sort((a,b) => a.commerceEventId.localeCompare(b.commerceEventId));
  const planeCoverage = Object.fromEntries(PLANES.map(p => {
    const matching = sources.filter(s => s.plane === p && s.populationId === q.populationId);
    return [p, { complete: matching.length > 0 && matching.every(s => s.alignedComplete), reasons: matching.length ? [...new Set(matching.flatMap(s => s.reasons))].sort() : ['source_absent'] }];
  }));
  const denominatorReasons = [];
  if (new Set(sources.map(s => s.kind)).size > 1) denominatorReasons.push('mixed_synthetic_and_observed_evidence');
  for (const p of ['attempts','task_refs']) if (!planeCoverage[p].complete) denominatorReasons.push(p + '_not_covered');
  if (diagnostics.unboundEvents.length || diagnostics.missingCausalSide) denominatorReasons.push('causal_population_incomplete');
  if (diagnostics.conflicts || diagnostics.bindingConflicts) denominatorReasons.push('conflicting_evidence');
  const requirements = { valid_delivery: ['forward','retention','settlements'], claimed_usefulness: ['forward','retention','settlements'], retention: ['retention'], later_use: ['forward','retention','reads','settlements'], settlement: ['settlements'] };
  const groups = Object.fromEntries(CLASSES.map(c => {
    const js = journeys.filter(j => j.classification === c);
    const counts = Object.fromEntries(STAGES.map(s => [s,js.filter(j => j.stages[s].status === 'observed').length]));
    const rates = Object.fromEntries(Object.entries(requirements).map(([stage, planes]) => {
      const reasons = [...denominatorReasons, ...planes.filter(p => !planeCoverage[p].complete).map(p => p + '_not_covered')];
      if (stage === 'later_use' && js.some(j => j.stages.later_use.reasons.includes('ambiguous_grant_owner') || j.stages.later_use.reasons.includes('ambiguous_causal_attempt_or_owner'))) reasons.push('ambiguous_owner_or_attempt');
      if (stage === 'claimed_usefulness' && js.some(j => j.stages.claimed_usefulness.reasons.includes('ambiguous_causal_attempt_or_owner'))) reasons.push('ambiguous_owner_or_attempt');
      if (!js.length) reasons.push('empty_covered_denominator');
      return [stage, { numerator: counts[stage], denominator: reasons.length ? null : js.length,
        value: reasons.length ? null : counts[stage] / js.length, reasons: [...new Set(reasons)].sort(), population: 'server_bound_attempts_in_question_window', timeBasis: 'outcomes_observed_by_asof' }];
    }));
    return [c, { counts, rates }];
  }));
  const gross = observeGross(journeys.map(j => ({ settlementStatus: j.stages.settlement.status === 'observed' && !j.reasons.includes('replay_is_not_new_payment') ? 'verified' : 'unknown', settlementTrusted: true, grossSettledAtomic: j.stages.settlement.amountAtomic })));
  const report = { schema: REPORT_SCHEMA, question: q, inputDigest: digest(sanitizedBundle(bundle)), priorReportId,
    measurementSpace: sources.some(s => s.kind === 'synthetic_fixture') ? 'synthetic_replay' : 'supplied_observer_cut',
    sources, planeCoverage, denominator: { unit: 'server_bound_attempt', observed: journeys.length,
      covered: denominatorReasons.length === 0, reasons: denominatorReasons, allMarketTraffic: null },
    groups, journeys, diagnostics, economics: effort(bundle.economics, gross),
    provenance: { baseCommit: BASE_COMMIT, writerId: FORWARD_WRITER_ID, causalContractProducer: FORWARD_PRODUCER_BASE_COMMIT,
      evidenceAuthenticity: 'supplied_read_only_exports_not_independently_authenticated', retainedGenerations: 2, crossProcessJournalExclusion: false },
    decisions: [
      { id: 'repair-next-stage', basis: 'Per-attempt gaps and producer failure codes identify delivery, retention or read friction.' },
      { id: 'compare-covered-cohorts', basis: 'Covered denominators and separate classifications constrain conversion comparisons.' },
      { id: 'stop-or-retest-usefulness', basis: 'Unknown, useful negative, corrected or revoked outcomes guide a bounded retest.' },
      { id: 'budget-marginal-work', basis: 'Direct baseline, review/adaptation and distinct resource planes constrain further effort.' }
    ], recognizedRevenueAtomic: '0' };
  tick(); report.reportId = digest(report); outputJson(report); return report;
}
export function retainReport(bundle, report) {
  const retained = { schema: RETAINED_SCHEMA, bundle:sanitizedBundle(bundle), report };
  outputJson(retained); return retained;
}
export function replayRetained(retained, options = {}) {
  only(retained, ['schema','bundle','report'], 'retained_rejected');
  if (retained.schema !== RETAINED_SCHEMA) fail('retained_rejected');
  const report = projectBundle(retained.bundle, { ...options, priorReportId: retained.report.priorReportId });
  if (canonical(report) !== canonical(retained.report)) fail('replay_mismatch');
  return report;
}
