import { budget, checkTree, digest, canonical, fail, LIMITS } from '../vendor/bounds.mjs';
import { BASE_COMMIT, PLANES, time, validStripped, validateSource } from './export.mjs';
import { FREE_EXPORT, OPERATION, TASK, verifyReplay } from './receipt.mjs';
export const BUNDLE_SCHEMA='samedaydesk.free-task-observation.bundle.v1';
export const REPORT_SCHEMA='samedaydesk.free-task-observation.report.v1';
export const RETAINED_SCHEMA='samedaydesk.free-task-observation.retained.v1';
const STAGES=['delivery_observation','caller_asserted_usefulness','independently_replayed_output','authorized_retention','later_use','settlement'];
const unknown=reason=>({status:'unknown',reasons:[reason],evidence:[]});
const observed=(ids,extra={})=>({status:'observed',reasons:[],evidence:ids.sort(),...extra});
const only=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).every(k=>keys.includes(k));
function question(q) {
  if (!only(q,['id','text','populationId','from','to','asOf','operationIds','cohorts','taskRefs'])
    || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(q.id || '') || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(q.populationId || '')
    || typeof q.text!=='string' || !q.text.length || q.text.length>512 || ![q.from,q.to,q.asOf].every(time)
    || Date.parse(q.from)>=Date.parse(q.to) || Date.parse(q.asOf)<Date.parse(q.to)
    || !Array.isArray(q.operationIds) || q.operationIds.length!==1 || q.operationIds[0]!==OPERATION
    || !Array.isArray(q.cohorts) || !q.cohorts.length || q.cohorts.some(c=>!['owner_qa','controlled_test','external_unknown','sponsored_trial'].includes(c))
    || q.taskRefs!==undefined && (!Array.isArray(q.taskRefs)||!q.taskRefs.length||q.taskRefs.some(t=>!TASK.test(t)))) fail('question_rejected');
  return q;
}
function rowKey(r,p) {
  if(p==='attempts') return r.id;
  if(p==='retention') return r.action==='retain' ? 'retain:'+r.grantId : 'revoke:'+r.targetId+':'+r.at;
  if(p==='settlements') return r.settlementReference;
  return r.eventId;
}
export function projectBundle(bundle,{priorReportId=null,tick=budget()}={}) {
  checkTree(bundle,tick);
  if(Buffer.byteLength(canonical(bundle))>LIMITS.fileBytes) fail('input_bytes_exceeded');
  if(!only(bundle,['schema','question','sources'])||bundle.schema!==BUNDLE_SCHEMA||!Array.isArray(bundle.sources)||bundle.sources.length>LIMITS.sources) fail('bundle_rejected');
  const q=question(bundle.question),asOf=Date.parse(q.asOf),start=Date.parse(q.from),end=Date.parse(q.to);
  const rows=Object.fromEntries(PLANES.map(p=>[p,[]])),sources=[],sourceIds=new Set(),seen=new Map(),blocked=new Set();
  const diagnostics={duplicates:0,conflicts:0,rejectedRecords:0,bindingConflicts:0,unboundAttempts:0,missingPredecessors:0,unexpectedSettlements:0};
  let count=0,total=0;
  for(const s of bundle.sources) {
    tick();validateSource(s);if(sourceIds.has(s.id)) fail('duplicate_source_id');sourceIds.add(s.id);
    count+=s.records.length;total+=s.intake.rawBytes;
    if(count>LIMITS.rows) fail('record_limit_exceeded');if(total>LIMITS.totalBytes) fail('total_raw_bytes_exceeded');
    const reasons=[];
    if(s.populationId!==q.populationId) reasons.push('population_misaligned');
    if(!q.operationIds.every(o=>s.scope.operationIds.includes(o))||!q.cohorts.every(c=>s.scope.cohorts.includes(c))
      ||s.scope.taskRefs && (!q.taskRefs||!q.taskRefs.every(t=>s.scope.taskRefs.includes(t)))) reasons.push('scope_not_covered');
    if(Date.parse(s.from)>start||Date.parse(s.to)<asOf) reasons.push('time_not_covered');
    if(Date.parse(s.asOf)>asOf||Date.parse(s.to)>asOf) reasons.push('cut_after_asof');
    if(s.coverage!=='complete') reasons.push('coverage_'+s.coverage);
    if(s.intake.malformed||s.intake.torn||s.intake.rejected) reasons.push('unusable_intake');
    const candidates=[];
    for(const r of s.records) {
      tick();if(Buffer.byteLength(canonical(r))>LIMITS.rowBytes) fail('row_bytes_exceeded');
      if(!validStripped(r,s.plane)) {diagnostics.rejectedRecords++;reasons.push('rejected_records');continue;}
      const at=r.ts||r.at||r.createdAt||r.reconciledAt;
      if(at&&(Date.parse(at)<Date.parse(s.from)||Date.parse(at)>Date.parse(s.to))) reasons.push('record_outside_cut');
      candidates.push(r);
    }
    const alignedComplete=reasons.length===0;
    sources.push({id:s.id,plane:s.plane,kind:s.kind,populationId:s.populationId,coverage:s.coverage,
      alignedComplete,reasons:[...new Set(reasons)].sort(),projectedDigest:digest(s.records),intake:s.intake});
    // A partial/foreign cut cannot confer current rights or evidence authority.
    if(!alignedComplete) continue;
    for(const r of candidates) {
      const key=s.plane+':'+rowKey(r,s.plane),hash=digest(r),old=seen.get(key);
      if(old) {if(old.hash===hash) diagnostics.duplicates++;else {diagnostics.conflicts++;blocked.add(key);}continue;}
      seen.set(key,{r,hash});rows[s.plane].push({row:r,key});
    }
  }
  for(const p of PLANES) rows[p]=rows[p].filter(x=>!blocked.has(x.key)).map(x=>x.row);
  const coverage=Object.fromEntries(PLANES.map(p=>{const ss=sources.filter(s=>s.plane===p&&s.populationId===q.populationId);
    return [p,{complete:ss.length>0&&ss.every(s=>s.alignedComplete),reasons:ss.length?[...new Set(ss.flatMap(s=>s.reasons))].sort():['source_absent']}];}));
  const refs=new Map(),badRefs=new Set(),events=new Map(rows.attempts.map(e=>[e.id,e]));
  for(const r of rows.task_refs) {
    const old=refs.get(r.commerceEventId);
    if(old&&(old.taskRef!==r.taskRef||old.operationId!==r.operationId||old.cohort!==r.cohort)) {badRefs.add(r.commerceEventId);diagnostics.bindingConflicts++;}
    else refs.set(r.commerceEventId,r);
  }
  for(const key of blocked) if(key.startsWith('task_refs:')) badRefs.add(seen.get(key).r.commerceEventId);
  const selected=r=>r.operationId===OPERATION&&q.cohorts.includes(r.cohort)&&(!q.taskRefs||q.taskRefs.includes(r.taskRef));
  for(const r of refs.values()) if(selected(r)&&!events.has(r.commerceEventId)) diagnostics.missingPredecessors++;
  const journeys=[];
  for(const e of rows.attempts) {
    tick();if(Date.parse(e.ts)<start||Date.parse(e.ts)>=end) continue;
    const ref=refs.get(e.id);
    if(!ref||badRefs.has(e.id)) {diagnostics.unboundAttempts++;continue;}
    if(!selected(ref)||e.result!=='paid_route_response') continue;
    const stages=Object.fromEntries(STAGES.map(s=>[s,unknown('no_'+s+'_authority')]));
    stages.settlement=unknown('free_observation_has_no_payment_authority');
    const forwards=rows.forward.filter(r=>r.commerceEventId===e.id&&r.operationId===ref.operationId&&r.cohort===ref.cohort&&r.route===e.route&&r.method===e.method);
    const transports=forwards.filter(r=>r.stage==='transport');
    const candidates=rows.retention.filter(r=>r.schema===FREE_EXPORT&&r.commerceEventId===e.id&&r.taskRef===ref.taskRef
      &&r.operationId===ref.operationId&&r.cohort===ref.cohort&&r.route===e.route&&r.method===e.method&&Date.parse(r.createdAt)<=asOf);
    const r=candidates.length===1 ? candidates[0] : null;
    let retentionState='unknown',usefulness='unknown',currentUseful=false;
    if(r&&e.status===200&&transports.length===1&&transports[0].receiptDigest===r.observation.responseDigest
      &&r.observation.capturedAt===e.ts&&Date.parse(r.createdAt)>=Date.parse(e.ts)
      &&['attempts','task_refs','forward','retention'].every(p=>coverage[p].complete)) {
      const o=r.observation;
      stages.delivery_observation=observed([transports[0].eventId,r.recordId],{authority:o.authority,
        contract:'existing_receipt_contract',at:o.observedAt,httpFinish:e.ts,coverage:'complete'});
      stages.caller_asserted_usefulness=o.callerClaim===null ? unknown('no_caller_claim')
        : {status:'asserted',verification:'unverified',value:o.callerClaim,reasons:['caller_success_is_not_independent_usefulness'],evidence:[r.recordId]};
      const replay=verifyReplay(o.evidence,o.predicate,o.replay);
      if(replay.status==='pass') {
        usefulness=replay.criterion;
        stages.independently_replayed_output=observed([r.recordId],{authority:'separate_receipt_execution_and_fixed_predicate',
          predicate:o.predicate,criterion:replay.criterion,output:replay.output,provenance:o.replay.provenance,
          historical:true,sourceAuthenticity:'supplied_export_not_independently_authenticated'});
      } else stages.independently_replayed_output=unknown(replay.reason);
      const revokes=rows.retention.filter(v=>v.action==='revoke'&&v.targetId===r.grantId&&Date.parse(v.at)<=asOf);
      retentionState=revokes.length?'revoked':Date.parse(r.expiresAt)<=asOf?'expired':'active';
      currentUseful=replay.status==='pass'&&retentionState==='active';
      stages.authorized_retention=observed([r.grantId],{authority:'existing_customer_grant',at:r.createdAt,
        expiresAt:r.expiresAt,state:retentionState,currentRights:retentionState==='active',durability:'existing_customer_store_no_fsync_guarantee'});
      const owners=rows.retention.filter(v=>v.action==='retain'&&v.recordId===r.recordId);
      const reads=rows.reads.filter(v=>v.recordId===r.recordId&&v.taskRef===r.taskRef
        &&Date.parse(v.at)>Date.parse(r.createdAt)&&Date.parse(v.at)<Date.parse(r.expiresAt)&&Date.parse(v.at)<=asOf
        &&!revokes.some(z=>Date.parse(z.at)<=Date.parse(v.at)));
      if(new Set(owners.map(v=>v.grantId)).size!==1) stages.later_use=unknown('ambiguous_grant_owner');
      else if(reads.length&&replay.status==='pass'&&coverage.reads.complete) stages.later_use=observed(reads.map(v=>v.eventId),{
        authority:'existing_authorized_retained_read',utility:replay.criterion,historical:true,outsideUseEstablished:false});
      else stages.later_use=unknown(!coverage.reads.complete?'reads_not_covered':replay.status!=='pass'?'read_without_independent_usefulness':'no_authorized_later_read');
      if(rows.reads.some(v=>v.recordId===r.recordId&&v.taskRef!==r.taskRef)&&stages.later_use.status==='unknown') stages.later_use.reasons.push('read_task_mismatch');
    } else {
      stages.delivery_observation=unknown(!r?'no_free_delivery_record':transports.length!==1?'no_bound_response_observation':'response_or_scope_mismatch');
    }
    if(rows.settlements.some(r=>r.sourceEventId===e.id)||forwards.some(r=>r.stage==='settlement')) diagnostics.unexpectedSettlements++;
    journeys.push({commerceEventId:e.id,taskRef:ref.taskRef,operationId:ref.operationId,cohort:ref.cohort,
      classification:['owner_qa','controlled_test'].includes(ref.cohort)||['internal','owner_monitor'].includes(e.originClass)?'owner_internal':ref.cohort==='sponsored_trial'?'recruited_sponsored':'unclassified',
      identity:'not_inferred',retentionState,usefulness,currentUseful,stages,paymentPermitted:false});
  }
  journeys.sort((a,b)=>a.commerceEventId.localeCompare(b.commerceEventId));
  const reasons=[];
  for(const p of ['attempts','task_refs']) if(!coverage[p].complete) reasons.push(p+'_not_covered');
  if(diagnostics.unboundAttempts||diagnostics.missingPredecessors) reasons.push('causal_population_incomplete');
  if(diagnostics.conflicts||diagnostics.bindingConflicts) reasons.push('conflicting_evidence');
  if(diagnostics.unexpectedSettlements) reasons.push('unexpected_settlement_for_free_attempt');
  if(new Set(sources.map(s=>s.kind)).size>1) reasons.push('mixed_evidence_kind');
  const requirements={delivery_observation:['forward','retention'],independently_replayed_output:['forward','retention'],authorized_retention:['retention'],later_use:['forward','retention','reads']};
  const rates=Object.fromEntries(Object.entries(requirements).map(([s,ps])=>{
    const rs=[...reasons,...ps.filter(p=>!coverage[p].complete).map(p=>p+'_not_covered')];
    if(!journeys.length) rs.push('empty_denominator');
    if(s==='later_use'&&journeys.some(j=>j.stages.later_use.reasons.includes('ambiguous_grant_owner'))) rs.push('ambiguous_grant_owner');
    const numerator=journeys.filter(j=>j.stages[s].status==='observed').length;
    return [s,{numerator,denominator:rs.length?null:journeys.length,value:rs.length?null:numerator/journeys.length,reasons:[...new Set(rs)].sort()}];
  }));
  const report={schema:REPORT_SCHEMA,question:q,priorReportId,denominator:{covered:reasons.length===0,observed:journeys.length,reasons},
    journeys,rates,coverage,diagnostics,sources,provenance:{baseCommit:BASE_COMMIT,authenticity:'supplied_read_only_exports_not_independently_authenticated',
      identity:'not_inferred',outsideUseEstablished:false,crossProcessJournalExclusion:false,retainedGenerations:2},
    tokenSavings:'unknown',customerCount:'unknown',unknownSpend:'unknown',paymentPermitted:false,recognizedRevenueAtomic:'0'};
  return {...report,reportId:digest(report)};
}
export function retainReport(bundle,report) {
  if(digest(projectBundle(bundle,{priorReportId:report.priorReportId}))!==digest(report)) fail('report_not_reproducible');
  return {schema:RETAINED_SCHEMA,bundle,report};
}
export function replayRetained(receipt) {
  if(!only(receipt,['schema','bundle','report'])||receipt.schema!==RETAINED_SCHEMA) fail('retained_rejected');
  const replay=projectBundle(receipt.bundle,{priorReportId:receipt.report.priorReportId});
  if(digest(replay)!==digest(receipt.report)) fail('replay_mismatch');
  return replay;
}
