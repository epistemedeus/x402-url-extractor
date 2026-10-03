// Development-only synthetic fixtures created by the received causal producer.
// Not included in the cold pack and never pointed at a private merchant journal.
import { writeFileSync } from 'node:fs';
import { authorizeOutcomeBinding, buildTaskRefRecord, buildHttpFinishForwardRecords } from '../../../../commerce-outcome-binding.mjs';
import { evaluateResponseBytes } from '../../../../http-delivery-evidence/index.mjs';
import { BUNDLE_SCHEMA, BASE_COMMIT, PLANES } from '../src/project.mjs';
import { exportObserverSource } from '../src/observer-integration.mjs';
import { digest } from '../src/bounds.mjs';

const token = 'synthetic-task-demand-test-token-only-100339';
const from = '2026-10-01T00:00:00.000Z', to = '2026-10-02T00:00:00.000Z';
const op = 'normalized-transaction-receipt';
const records = Object.fromEntries(PLANES.map(p => [p,[]]));
const refs = [];
for (let n = 1; n <= 4; n++) {
  const cohort = ['owner_qa','sponsored_trial','external_unknown','external_unknown'][n-1];
  const claim = authorizeOutcomeBinding({ 'x-samedaydesk-internal':token,
    'x-samedaydesk-outcome-operation':op, 'x-samedaydesk-outcome-cohort':cohort,
    'x-samedaydesk-outcome-task':'synthetic-task-' + n },token);
  refs.push(claim.taskRef);
  const id = '10000000-0000-4000-8000-' + String(n).padStart(12,'0');
  const at = '2026-10-01T01:0' + n + ':00.000Z';
  const event = { v:3,id,ts:at,method:'GET',route:'/chain/transaction-receipt',
    result:n === 2 ? 'challenge' : 'paid_success',status:n === 2 ? 402 : 200,
    originClass:n === 1 ? 'internal' : 'external' };
  records.attempts.push(event); records.task_refs.push(buildTaskRefRecord({claim,commerceEventId:id}));
  const fields = { product:'samedaydesk-transaction-receipt',version:'1.0.0',ok:true,
    decision:n === 3 ? 'not_found' : 'found',receipt:{found:n !== 3},transaction:{status:n === 3 ? 'unavailable':'success'},
    request:{network:'eip155:8453',transactionHash:'0x' + String(n).repeat(64)} };
  const resultId = digest(fields), grantId = String(n).repeat(16), recordId = resultId.slice(0,32);
  // The real validator reports unsupported_target for the receipt route. The
  // separate received retention contract supplies receipt-delivery evidence.
  const validation = evaluateResponseBytes({method:'GET',resource:event.route,
    responseBytes:Buffer.from(JSON.stringify(fields)),
    merchantHttpStatus:200,settlementClass:'real_unverified',recordId:id});
  const forward = buildHttpFinishForwardRecords({claim,event,paidEvidence:{responseDigest:resultId},
    httpDeliveryRecord:{ ...validation, responseDigest:resultId }});
  records.forward.push(...forward);
  if (n === 2) continue;
  records.settlements.push({schemaVersion:'samedaydesk.commerce-settlement-reconciliation.v1',state:'reconciled',sourceEventId:id,
    sourceEventTimestamp:at,reconciledAt:'2026-10-01T01:10:00.000Z',route:event.route,network:'eip155:8453',
    settlementReference:'0x' + String(n).repeat(64),amountAtomic:'5000',paymentClass:n === 1 ? 'internal' : n === 4 ? 'independent' : 'unclassified'});
  records.retention.push({schema:'samedaydesk.useful-result-reuse.customer-grant.v1',action:'retain',grantId,recordId,resultId,
    operationId:op,taskRef:claim.taskRef,taskJoin:'bound',createdAt:'2026-10-01T01:20:00.000Z',expiresAt:'2026-10-08T01:20:00.000Z',
    method:event.method,route:event.route,body:fields,settlementStatus:'verified',evidenceClass:n === 3 ? 'useful_negative':'paid_valid_delivery',paidValidDelivery:n !== 3});
  records.reads.push({schema:'samedaydesk.useful-result-reuse.metric.v1',kind:'useful_later_read',eventId:'read-' + n,
    at:'2026-10-01T02:00:00.000Z',recordId,taskRef:claim.taskRef});
}
const sources = PLANES.map(plane => exportObserverSource({metadata:{id:'synthetic-' + plane.replace('_','-'),plane,kind:'synthetic_fixture',populationId:'synthetic-cohort',
  scope:{operationIds:[op],cohorts:['owner_qa','sponsored_trial','external_unknown'],taskRefs:refs},
  from,to,asOf:to,coverage:'complete'}, records:records[plane]}));
const question = {id:'retention-friction',text:'Where did this covered owner and sponsored task cohort stop before later use?',populationId:'synthetic-cohort',
  from,to,asOf:to,operationIds:[op],cohorts:['owner_qa','sponsored_trial'],taskRefs:refs.slice(0,2)};
const economics = { source:'useful-economics-100290',directBaseline:{apiEquivalentBuildEffort:{probes:3,tokens:'unknown'},
  reviewAdaptationAtomic:{known:false,reason:'original_token_review_cost_unknown'},cashMarginalAtomic:{atomic:'0'}},
  marginal:{apiEquivalentBuildEffort:{probes:1,tokens:120},cashMarginalAtomic:{atomic:'0'},feesAtomic:{atomic:'0'},
    reviewAdaptationAtomic:{known:false,reason:'review_not_metered'},includedQuotaOpportunityCostAtomic:{known:false,reason:'included_quota_not_metered'},
    sharedRndAtomic:{known:false,reason:'not_allocatable',allocatable:false}} };
writeFileSync(new URL('./questions.json',import.meta.url),JSON.stringify({schema:BUNDLE_SCHEMA,question,sources,economics},null,2)+'\n');
writeFileSync(new URL('./question-negative.json',import.meta.url),JSON.stringify({...question,id:'negative-utility',text:'Did a bounded negative receipt remain useful for a later authorized read?',cohorts:['external_unknown'],taskRefs:[refs[2]]},null,2)+'\n');
writeFileSync(new URL('./question-independent.json',import.meta.url),JSON.stringify({...question,id:'independent-attribution',text:'Which explicitly classified independent attempts reached later use?',cohorts:['external_unknown'],taskRefs:[refs[3]]},null,2)+'\n');
