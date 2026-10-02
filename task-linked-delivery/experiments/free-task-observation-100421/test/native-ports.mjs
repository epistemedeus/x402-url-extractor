import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createCommerceTelemetry } from '../../../../commerce-events.mjs';
import { authorizeOutcomeBinding,openCausalCommerceEvent } from '../../../../commerce-outcome-binding.mjs';
import { createUsefulResultReuse } from '../../../../useful-result-reuse/service.mjs';
import { createReuseStore } from '../../../../useful-result-reuse/store.mjs';
import { requestIdentityFor } from '../../../../useful-result-reuse/customer-grant.mjs';
import { handleUsefulResultReuse,mountUsefulResultReuse } from '../../../../useful-result-reuse/http.mjs';
import { transactionReceipt } from '../../../../transaction-receipt.mjs';
import { createFreeTaskObservation } from '../src/integration.mjs';
import { callerObservation,exposeAuthorizedCausalProof,handleFreeTaskObservation } from '../src/http-integration.mjs';
import { exportSource,parseNdjson,PLANES } from '../src/export.mjs';
import { BUNDLE_SCHEMA,projectBundle,retainReport } from '../src/project.mjs';
import { feeHash,absentHash,failedHash,claimHash,changedHash,fixtureClient } from './receipt-fixtures.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export const TOKEN='synthetic-authorized-free-observation-only-100421';
const SECRET='synthetic-free-observation-actor-secret-100421';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const FILES={attempts:['commerce-events.1.ndjson','commerce-events.ndjson'],task_refs:['commerce-outcome-task-ref.1.ndjson','commerce-outcome-task-ref.ndjson'],
  forward:['commerce-outcome-binding.1.ndjson','commerce-outcome-binding.ndjson'],retention:['useful-result-customer.1.ndjson','useful-result-customer.ndjson'],
  reads:['useful-result-metrics.1.ndjson','useful-result-metrics.ndjson'],settlements:['commerce-settlements.ndjson']};
export async function rawCut(dataDir) {
  const out={coverage:'complete',malformed:0,torn:0,rejected:0,raw:{}};
  for(const [p,names] of Object.entries(FILES)) {
    const chunks=[];
    for(const name of names) {
      const file=path.join(dataDir,name);let h;
      try {h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);} catch(e) {if(e.code==='ENOENT') continue;throw e;}
      try {const stat=await h.stat();assert.ok(stat.isFile());assert.ok(stat.size<1_048_576);chunks.push(await h.readFile());} finally {await h.close();}
    }
    const bytes=Buffer.concat(chunks),parsed=parseNdjson(bytes);
    // Supported later-read plane excludes other original metric kinds.
    out[p]=p==='reads'?parsed.rows.filter(r=>r.kind==='useful_later_read')
      :p==='attempts'?parsed.rows.filter(r=>r.route==='/chain/transaction-receipt'):parsed.rows;
    out.raw[p]=bytes;out.malformed+=parsed.malformed;out.torn+=parsed.torn;
  }
  return out;
}
export function bundleFrom(cut,{taskRefs,from,asOf,id='owned-free-tasks'}={}) {
  const all=cut.attempts.map(e=>Date.parse(e.ts));
  from ||= new Date(Math.min(...all)-1000).toISOString();asOf ||= new Date(Date.now()+1).toISOString();
  const scope={operationIds:['normalized-transaction-receipt'],cohorts:['owner_qa'],...(taskRefs?{taskRefs}:{})};
  const sources=PLANES.map(plane=>exportSource({metadata:{id:'native-'+plane.replace('_','-'),plane,kind:'synthetic_fixture',
    populationId:'caller-owned-sol421',scope,from,to:asOf,asOf,coverage:cut.coverage},records:cut[plane],rawBytes:cut.raw[plane],
    malformed:cut.malformed,torn:cut.torn}));
  return {schema:BUNDLE_SCHEMA,question:{id,text:'Which explicitly scoped free tasks returned independently useful output and retained current rights?',
    populationId:'caller-owned-sol421',from,to:asOf,asOf,...scope},sources};
}
export function nodePort(file,input) {
  const child=fork(path.join(here,file),[],{env:{PATH:process.env.PATH},stdio:['ignore','ignore','pipe','ipc']});
  let stderr='',value;child.stderr.on('data',b=>{stderr=(stderr+b).slice(-2000);});
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('bounded_node_port_deadline'));},18000);
    child.on('message',m=>{value=m;});child.once('error',reject);child.once('exit',code=>{
      clearTimeout(timer);if(code||value?.error) reject(new Error(value?.error||stderr||'node_port_failed'));else resolve(value);
    });child.send(input);
  });
}
export async function session({dataDir,mode='after',priorGrant=null,priorRequest=null,fault=null}) {
  const telemetry=createCommerceTelemetry({dataDir,internalToken:TOKEN,secret:SECRET,writerProcessCount:1});
  const physicalStore=createReuseStore({dataDir,maxRecordBytes:16_384});
  let injected=false,freeAdmissionCalls=0,physicalAppendAcknowledged=0;
  const customerStore=!fault?physicalStore:Object.freeze({...physicalStore,
    async mutate(name,work) {
      let loseAck=false;
      const result=await physicalStore.mutate(name,async rows=>{
        const outcome=await work(rows);
        if(outcome?.append?.evidenceClass==='free_observed_delivery') {
          freeAdmissionCalls++;
          if(!injected) {
            injected=true;
            if(fault==='before_append') throw new Error('isolated failure before existing store append');
            if(fault==='lost_ack') loseAck=true;
          }
        }
        return outcome;
      });
      if(loseAck) {physicalAppendAcknowledged++;throw new Error('isolated lost acknowledgement after existing store append');}
      return result;
    }});
  let cutOverride=null,clockOffset=0,preFinish=null,replayCalls=0;const replayPids=[],executionCalls={};
  let service,bridge;
  const compose=mountedService=>{
    service=mountedService;
    bridge=createFreeTaskObservation({internalToken:TOKEN,customerStore,customer:service,
    readCut:async()=>{await telemetry.flush();return cutOverride||rawCut(dataDir);},authorizeOutcomeBinding,openCausalCommerceEvent,requestIdentityFor,
    now:()=>Date.now()+clockOffset,
    replayReceipt:async input=>{replayCalls++;const replay=await nodePort('receipt-replay.mjs',input);replayPids.push(replay.pid);return replay;}});
    return (req,res)=>handleFreeTaskObservation(req,res,{bridge,service,handleUsefulResultReuse});
  };
  const app=express();app.use(telemetry.middleware);app.use(express.json({limit:24_000}));
  app.use((req,res,next)=>{exposeAuthorizedCausalProof(req,res,{telemetry,internalToken:TOKEN,authorizeOutcomeBinding});next();});
  if(mode==='before') {
    const handler=compose(createUsefulResultReuse({dataDir,internalToken:TOKEN,customerStore}));
    app.use((req,res,next)=>{if(!handler(req,res)) next();});
  } else {
    mountUsefulResultReuse(app,{dataDir,internalToken:TOKEN,customerStore,freeTaskObservation:compose});
    assert.ok(bridge,'exact receiving must execute the unapplied mount adapter');
  }
  app.get('/chain/transaction-receipt',async(req,res)=>{
    const hash=req.query.transactionHash,client=fixtureClient(hash);
    const body=await transactionReceipt({network:req.query.network,transactionHash:hash},{client});
    executionCalls[hash]=(executionCalls[hash]||0)+client.calls.receipt;
    const proof=telemetry.causalCommerceEventProof(res),claim=authorizeOutcomeBinding(req.headers,TOKEN);
    // The unchanged paid-retention port must keep refusing this exact free body.
    const paid=await service.retainDeliveredReceipt({optIn:true,settlementStatus:'unknown',body,
      taskLabel:req.headers['x-samedaydesk-outcome-task'],causalEventProof:proof});
    assert.equal(paid.reason,'settlement_unverified');
    if(hash===feeHash) {
      preFinish=await bridge.observe({...callerObservation({bodyBase64:Buffer.from(JSON.stringify(body)).toString('base64'),proof,
        eventId:proof.split('.')[0],taskRef:claim.taskRef,taskLabel:req.headers['x-samedaydesk-outcome-task'],predicate:{id:'fee-total-wei'}}),suppliedToken:TOKEN});
      assert.equal(preFinish.accepted,false);await delay(10);
    }
    res.json(body);
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const CURRENT='/.well-known/useful-result-reuse/current.json',GRANT='/.well-known/useful-result-reuse/retained';
  const post=async(request,action='observe-free-result',token=TOKEN)=>{
    const r=await fetch(base+CURRENT,{method:'POST',headers:{'content-type':'application/json','x-samedaydesk-internal':token,
      'x-samedaydesk-result-action':action},body:JSON.stringify(request),signal:AbortSignal.timeout(10000)});return {status:r.status,body:await r.json()};};
  const grantGet=async(grant,extra={})=>{const r=await fetch(base+GRANT,{headers:{'x-samedaydesk-result-grant':grant,...extra}});return {status:r.status,body:await r.json()};};
  const grantRevoke=async grant=>{const r=await fetch(base+GRANT,{method:'POST',headers:{'x-samedaydesk-result-grant':grant,'x-samedaydesk-result-action':'revoke'}});return {status:r.status,body:await r.json()};};
  const probes=[];
  try {
    let prior=null;
    if(priorGrant) {
      prior={read:await grantGet(priorGrant),revoke:await grantRevoke(priorGrant),withdrawn:await grantGet(priorGrant)};
      if(priorRequest) {const revoked=await post(priorRequest);assert.equal(revoked.body.reason,'revoked');}
    }
    const a=await nodePort('caller.mjs',{base,token:TOKEN,hash:feeHash,label:'sol421-fee-'+mode.replaceAll('_','-')});
    if(fault) {
      assert.equal(a.result.reason,fault==='lost_ack'?'duplicate':'write_outcome_unknown');
      const reconciliation=await post(a.request,'reconcile-free-result');
      assert.equal(reconciliation.body.reason,fault==='lost_ack'?'duplicate':'write_outcome_unknown');
      const repeat=fault==='lost_ack'?await post(a.request):null;
      if(repeat) assert.equal(repeat.body.reason,'duplicate');
      const cut=await rawCut(dataDir),physicalRows=cut.retention.filter(r=>r.action==='retain'&&r.commerceEventId===a.request.commerceEventId).length;
      assert.equal(physicalRows,fault==='lost_ack'?1:0);assert.equal(freeAdmissionCalls,1);
      const bundle=bundleFrom(cut),report=projectBundle(bundle);
      return {requestA:a.request,retained:retainReport(bundle,report),observation:{fault,workerPid:process.pid,
        initialReason:a.result.reason,reconciledReason:reconciliation.body.reason,explicitDuplicateReason:repeat?.body.reason||null,
        freeAdmissionCalls,physicalAppendAcknowledged,physicalRows,customerStoreFsyncCalls:0,
        automaticMutationRetries:0,grantReturned:a.result.grant!==null,
        grantAcknowledgement:fault==='lost_ack'?'unknown':'not_established',recognizedRevenueAtomic:'0'}};
    }
    const b=await nodePort('caller.mjs',{base,token:TOKEN,hash:absentHash,label:'sol421-absence-'+mode});
    assert.notEqual(a.pid,b.pid);assert.equal(a.httpStatus,200);assert.equal(b.httpStatus,200);
    assert.equal(a.callerOutput.status,'pass');assert.equal(b.callerOutput.criterion,'agreed_negative');
    let c=null,d=null,reads=null;
    if(mode!=='before') {
      if(a.result.error) await bridge.observe({...a.request,suppliedToken:TOKEN});
      assert.equal(a.result.accepted,true,JSON.stringify(a.result));assert.equal(b.result.accepted,true,JSON.stringify(b.result));
      await delay(10);reads=[await grantGet(a.result.grant),await grantGet(b.result.grant)];
      assert.equal(reads[0].body.result.transaction.transactionFeeWei,'42000');assert.equal(reads[1].body.result.decision,'not_found');
      c=await nodePort('caller.mjs',{base,token:TOKEN,hash:claimHash,label:'sol421-assertion-'+mode,predicate:null,callerClaim:true});
      assert.equal(c.result.accepted,true);assert.equal(c.result.observation.independent.status,'unknown');
      await grantGet(c.result.grant);
      d=await nodePort('caller.mjs',{base,token:TOKEN,hash:failedHash,label:'sol421-failure-'+mode,predicate:{id:'receipt-absence'}});
      assert.equal(d.result.reason,'execution_failed');
      const changed=await nodePort('caller.mjs',{base,token:TOKEN,hash:changedHash,label:'sol421-replay-change-'+mode});
      assert.equal(changed.result.observation.independent.reason,'replayed_output_changed');
      probes.push({name:'changed_independent_output',reason:changed.result.observation.independent.reason});
      const unobserved=await nodePort('caller.mjs',{base,token:TOKEN,hash:feeHash,label:'sol421-no-opt-in-'+mode,optIn:false});
      assert.equal(unobserved.callerOutput.status,'pass');assert.equal(unobserved.result.reason,'wrong_attempt');
      probes.push({name:'http200_without_opt_in_proof',reason:unobserved.result.reason,actualUsefulFee:unobserved.callerOutput.output.transactionFeeWei});
      const unsealed=await post({...a.request,causalEventProof:null});assert.equal(unsealed.body.reason,'wrong_attempt');
      probes.push({name:'caller_label_without_native_proof',reason:unsealed.body.reason});
      const cases=[['wrong_attempt',{...a.request,commerceEventId:b.request.commerceEventId}],
        ['wrong_task',{...a.request,taskLabel:'different-task'}],['wrong_resource',{...a.request,route:'/other'}],
        ['arbitrary_success_predicate',{...a.request,predicate:{id:'successful'}}],
        ['invented_settlement',{...a.request,settlementStatus:'verified'}],['not_requested',{...a.request,optIn:false}]];
      const altered=structuredClone(a.body);altered.transaction.transactionFeeWei='1';
      cases.push(['changed_response',{...a.request,bodyBase64:Buffer.from(JSON.stringify(altered)).toString('base64')}]);
      for(const [name,request] of cases) {const r=await post(request);assert.equal(r.body.accepted,false);probes.push({name,reason:r.body.reason});}
      const unauth=await post(a.request,'observe-free-result','forged');assert.equal(unauth.body.reason,'unauthorized');probes.push({name:'forged_token',reason:unauth.body.reason});
      const current=await rawCut(dataDir);cutOverride={...current,coverage:'partial'};
      const partial=await post(a.request);assert.equal(partial.body.reason,'causal_cut_not_covered');probes.push({name:'partial_cut',reason:partial.body.reason});
      cutOverride={...current,task_refs:current.task_refs.filter(r=>r.commerceEventId!==a.request.commerceEventId)};
      const missing=await post(a.request);assert.equal(missing.body.reason,'missing_or_conflicting_predecessor');probes.push({name:'missing_predecessor',reason:missing.body.reason});cutOverride=null;
      const duplicate=await post(a.request);assert.equal(duplicate.body.reason,'duplicate');
      const reconciliation=await post(a.request,'reconcile-free-result');assert.equal(reconciliation.body.reason,'duplicate');
      probes.push({name:'duplicate_explicit_reconciliation',reason:reconciliation.body.reason,grantReturned:reconciliation.body.grant!==null});
      const wrongTask=await grantGet(a.result.grant,{'x-samedaydesk-outcome-task-ref':b.request.taskRef});assert.equal(wrongTask.body.error,'wrong_task');
      const wrongAttempt=await grantGet(a.result.grant,{'x-samedaydesk-causal-attempt':b.request.commerceEventId});assert.equal(wrongAttempt.body.error,'wrong_attempt');
      const wrongBody=await grantGet(a.result.grant,{'x-samedaydesk-result-id':'f'.repeat(64)});assert.equal(wrongBody.body.error,'wrong_result');
      const wrongMethod=await grantGet(a.result.grant,{'x-samedaydesk-bound-method':'POST'});assert.equal(wrongMethod.body.error,'wrong_method');
      probes.push(...[['grant_wrong_task',wrongTask],['grant_wrong_attempt',wrongAttempt],['grant_wrong_body',wrongBody],['grant_wrong_method',wrongMethod]].map(([name,v])=>({name,reason:v.body.error})));
      const share=await fetch(base+GRANT,{method:'POST',headers:{'x-samedaydesk-result-grant':a.result.grant,'x-samedaydesk-result-action':'share-knowledge'}});
      assert.equal((await share.json()).error,'action_rejected');probes.push({name:'undelegated_share_right',reason:'action_rejected'});
      clockOffset=8*86400000;
      const expired=await bridge.observe({...a.request,suppliedToken:TOKEN});assert.equal(expired.reason,'expired');probes.push({name:'expired_no_regrant',reason:expired.reason});clockOffset=0;
      const expiredService=createUsefulResultReuse({dataDir,internalToken:TOKEN,customerStore,now:()=>Date.now()+8*86400000});
      const expiredRead=await expiredService.readDeliveredReceipt({token:a.result.grant});assert.equal(expiredRead.reason,'expired');probes.push({name:'expired_grant_read',reason:expiredRead.reason});
      const foreignDir=path.join(dataDir,'other-tenant'),foreign=createUsefulResultReuse({dataDir:foreignDir,internalToken:TOKEN});
      const wrongTenant=await foreign.readDeliveredReceipt({token:a.result.grant});assert.equal(wrongTenant.reason,'grant_rejected');probes.push({name:'wrong_tenant',reason:wrongTenant.reason});
    } else {
      assert.equal(a.result.reason,'no_bound_response_observation');assert.equal(b.result.reason,'no_bound_response_observation');
    }
    await telemetry.flush();const cut=await rawCut(dataDir),bundle=bundleFrom(cut),report=projectBundle(bundle);
    for(const e of cut.attempts.filter(r=>r.route==='/chain/transaction-receipt')) assert.equal(e.result,'paid_route_response');
    assert.equal(cut.forward.filter(r=>r.stage==='settlement').length,0);assert.equal(cut.settlements.length,0);
    const safeOps=[a,b,...(c?[c,d]:[])].map(x=>({callerPid:x.pid,eventId:x.request.commerceEventId,taskRef:x.request.taskRef,
      callerPredicate:x.callerOutput,observationAccepted:x.result.accepted,observationReason:x.result.reason,
      independentlyExecuted:x.result.observation?.independent||null,receivedMs:x.receivedMs,observationMs:x.observationMs,
      httpStatus:x.httpStatus,paymentPermitted:false}));
    return {bundle,retained:retainReport(bundle,report),grantA:a.result.grant,grantB:b.result.grant,requestA:a.request,
      observation:{mode,workerPid:process.pid,callerProcesses:safeOps,replayPids,replayCalls,executionCalls,
        preFinishReason:preFinish?.reason,probes,priorRestart:prior?{readStatus:prior.read.status,readDecision:prior.read.body.result?.decision,
          revoked:prior.revoke.body.accepted,withdrawnReason:prior.withdrawn.body.error}:null,
        actualHTTP:true,actualJournalWrites:true,rpcBoundary:'fixture_rpc',realPayment:false,keyCreated:false,
        productionJournalEnrolled:false,customerCount:'unknown',tokenSavings:'unknown',recognizedRevenueAtomic:'0'}};
  } finally {await new Promise(r=>server.close(r));}
}
export async function reconcileSession({dataDir,request}) {
  const customerStore=createReuseStore({dataDir,maxRecordBytes:16_384});
  const customer=createUsefulResultReuse({dataDir,internalToken:TOKEN,customerStore});
  const bridge=createFreeTaskObservation({internalToken:TOKEN,customerStore,customer,readCut:()=>rawCut(dataDir),
    authorizeOutcomeBinding,openCausalCommerceEvent,requestIdentityFor});
  const result=await bridge.reconcile({...request,suppliedToken:TOKEN});
  const rows=(await rawCut(dataDir)).retention.filter(r=>r.action==='retain'&&r.commerceEventId===request.commerceEventId);
  return {workerPid:process.pid,reason:result.reason,physicalRows:rows.length,grantReturned:result.grant!==null,
    automaticMutationRetries:0,recognizedRevenueAtomic:'0'};
}
if(process.send) process.once('message',input=>(input.action==='reconcile'?reconcileSession(input):session(input))
  .then(value=>process.send({value},()=>process.disconnect())).catch(e=>process.send({error:e.stack},()=>process.disconnect())));
