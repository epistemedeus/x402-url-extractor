#!/usr/bin/env node
// Separate direct solve on the IDENTICAL stripped cut. No package imports,
// project/report cache, environment provider or network. This intentionally
// implements only the decision surface compared by the receiving test.
import { readFileSync } from 'node:fs';
const raw=readFileSync(process.argv[2]);if(raw.length>1_048_576) throw new Error('bounded_input_required');
const bundle=JSON.parse(raw),q=bundle.question,asOf=Date.parse(q.asOf);
const stable=x=>x&&typeof x==='object'?Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
const planes={};
for(const s of bundle.sources) {
  if(s.coverage!=='complete'||s.populationId!==q.populationId||s.intake.malformed||s.intake.torn||s.intake.rejected
    ||Date.parse(s.from)>Date.parse(q.from)||Date.parse(s.to)!==asOf||Date.parse(s.asOf)!==asOf
    ||!q.cohorts.every(c=>s.scope.cohorts.includes(c))) continue;
  planes[s.plane]=(planes[s.plane]||[]).concat(s.records);
}
const attempts=planes.attempts||[],refs=planes.task_refs||[],retains=planes.retention||[],forward=planes.forward||[],reads=planes.reads||[];
const result=[];
for(const e of attempts) {
  if(e.result!=='paid_route_response'||Date.parse(e.ts)<Date.parse(q.from)||Date.parse(e.ts)>=Date.parse(q.to)) continue;
  const rs=refs.filter(r=>r.commerceEventId===e.id);if(rs.length!==1) continue;
  const task=rs[0];if(q.taskRefs&&!q.taskRefs.includes(task.taskRef)||!q.cohorts.includes(task.cohort)) continue;
  const row={eventId:e.id,taskRef:task.taskRef,delivery:'unknown',independent:'unknown',criterion:'unknown',output:null,retentionState:'unknown',laterUse:'unknown'};
  const candidates=retains.filter(r=>r.action==='retain'&&r.commerceEventId===e.id&&r.taskRef===task.taskRef);
  const transports=forward.filter(r=>r.stage==='transport'&&r.commerceEventId===e.id&&r.operationId===task.operationId&&r.cohort===task.cohort);
  if(candidates.length===1&&transports.length===1) {
    const r=candidates[0],o=r.observation;
    if(o&&transports[0].receiptDigest===o.responseDigest&&o.capturedAt===e.ts&&e.status===200&&Date.parse(r.createdAt)>=Date.parse(e.ts)) {
      row.delivery='observed';
      const revoked=retains.filter(x=>x.action==='revoke'&&x.targetId===r.grantId&&Date.parse(x.at)<=asOf);
      row.retentionState=revoked.length?'revoked':Date.parse(r.expiresAt)<=asOf?'expired':'active';
      if(o.predicate&&o.replay?.authority==='separate_receipt_execution'&&stable(o.evidence)===stable(o.replay.evidence)) {
        const v=o.replay.evidence;
        if(o.predicate.id==='fee-total-wei'&&v.receiptFound===true&&v.decision==='found'
          &&BigInt(v.gasUsedAtomic)*BigInt(v.effectiveGasPriceWei)===BigInt(v.transactionFeeWei)) {
          row.independent='observed';row.criterion='positive';row.output={transactionFeeWei:v.transactionFeeWei};
        }
        if(o.predicate.id==='receipt-absence'&&v.receiptFound===false&&v.decision==='not_found'&&v.status==='unavailable') {
          row.independent='observed';row.criterion='agreed_negative';row.output={minedReceiptAvailable:false,decision:'not_found'};
        }
      }
      const owners=retains.filter(x=>x.action==='retain'&&x.recordId===r.recordId);
      if(row.independent==='observed'&&new Set(owners.map(x=>x.grantId)).size===1&&reads.some(x=>x.recordId===r.recordId&&x.taskRef===r.taskRef
        &&Date.parse(x.at)>Date.parse(r.createdAt)&&Date.parse(x.at)<Date.parse(r.expiresAt)&&Date.parse(x.at)<=asOf
        &&!revoked.some(v=>Date.parse(v.at)<=Date.parse(x.at)))) row.laterUse='observed';
    }
  }
  result.push(row);
}
result.sort((a,b)=>a.eventId.localeCompare(b.eventId));
process.stdout.write(JSON.stringify({decisions:result,paymentPermitted:false,recognizedRevenueAtomic:'0'})+'\n');
