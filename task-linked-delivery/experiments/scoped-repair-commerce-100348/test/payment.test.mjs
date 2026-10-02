import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { authorizePlan, verifyAuthorization, authorizeExecution, digest } from 'agent-payment-policy';
import { acceptanceAction } from '../src/contracts.mjs';
import { service, seller, target, NOW, quoteIntent, surface } from './support.mjs';
import { merchant, unpaidOffer } from './merchant.mjs';

function signed(packet,key,{issued=NOW,action=acceptanceAction(packet),plan=packet.quote.plan,ttl=120000}={}) {
  const authorization=authorizePlan(plan,{privateKey:key.privateKey,kid:'disposable-owner-key',now:issued,ttlMs:ttl});
  const verified=verifyAuthorization(authorization,{publicKey:key.publicKey,plan,now:issued});
  const executionAuthorization=authorizeExecution({authorization:verified,method:'accept_delivery',network:plan.selected.network,action},
    {privateKey:key.privateKey,kid:'disposable-owner-key',now:issued,ttlMs:ttl});
  return {packetId:packet.packetId,taskId:packet.binding.task.id,callerId:packet.binding.task.callerId,decision:'accepted',authorization,executionAuthorization};
}
test('actual unpaid merchant quote and existing signatures bind exact scoped acceptance without payment',async t=>{
  const real=await merchant();t.after(real.close);const before=await target(null),after=await target(true);t.after(before.close);t.after(after.close);
  const key=generateKeyPairSync('ed25519');let clock=NOW,mutation=null;
  const offerFor=async({url,budget})=>({...await unpaidOffer(real.base,url,budget,{expiresAt:new Date(NOW+180000).toISOString()}),...mutation});
  const env=await service({offerFor,publicKeys:new Map([['caller-b',key.publicKey]]),now:()=>clock});t.after(env.close);
  const request=seller(before.base,after.base);request.quoteIntent=quoteIntent();
  const {packet}=await env.service.deliver(request);
  assert.equal(packet.quote.status,'candidate');assert.equal(packet.quote.plan.selected.amountAtomic,'10000');
  assert.equal(packet.quote.authorized,false);assert.equal(packet.quote.implementationPriceAtomic,null);
  const command=signed(packet,key);
  const accepted=await env.service.accept(command);
  assert.equal(accepted.acceptance.authorized,true,accepted.acceptance.reason);
  assert.equal(accepted.acceptance.paidAuthorizationVerified,true);
  assert.equal(accepted.acceptance.additionalImplementationAuthorized,false);
  assert.equal(accepted.acceptance.settlement,'unknown');
  assert.equal(accepted.paymentPerformed,false);
  const wrongTask={...command,taskId:'unrelated-task'};assert.equal((await env.service.accept(wrongTask)).acceptance.reason,'wrong_task_or_owner');
  const wrongOwner={...command,callerId:'other-owner'};assert.equal((await env.service.accept(wrongOwner)).acceptance.authorized,false);
  const forged=signed(packet,generateKeyPairSync('ed25519'));assert.equal((await env.service.accept(forged)).acceptance.reason,'authorization_refused');
  const changedAction=signed(packet,key,{action:{...acceptanceAction(packet),termsDigest:'sha256:'+'a'.repeat(64)}});
  assert.equal((await env.service.accept(changedAction)).acceptance.reason,'authorization_refused');
  const wrongBody=signed(packet,key,{action:{...acceptanceAction(packet),requestBindingDigest:'sha256:'+'b'.repeat(64)}});
  assert.equal((await env.service.accept(wrongBody)).acceptance.authorized,false);
  assert.equal((await env.service.accept({...command,decision:'declined'})).acceptance.reason,'claimant_declined');
  assert.equal((await env.service.accept({...command,authorization:null,executionAuthorization:null,paymentAuthorized:true})).acceptance.authorized,false);
  for(const changed of [{amountAtomic:'20000'},{recipient:'0x'+'1'.repeat(40)},{network:'eip155:1'},{asset:'0x'+'2'.repeat(40)},
    {url:packet.quote.offer.url+'&requiredPaths=forged'},{method:'POST',body:{task:'other'}},{expiresAt:new Date(NOW+200000).toISOString()}]){
    mutation=changed;assert.equal((await env.service.accept(command)).acceptance.reason,'current_terms_changed');
  }
  mutation=null;const expired=signed(packet,key,{ttl:1000});clock=NOW+1001;
  assert.equal((await env.service.accept(expired)).acceptance.reason,'grant_expired');clock=NOW;
  const differentPlan=structuredClone(packet.quote.plan);differentPlan.selected.network='eip155:1';
  differentPlan.planId=digest(Object.fromEntries(Object.entries(differentPlan).filter(([k])=>k!=='planId')));
  assert.equal((await env.service.accept(signed(packet,key,{plan:differentPlan}))).acceptance.authorized,false);
  assert.deepEqual(real.calls,{verify:0,settle:0});
  mutation={url:packet.quote.offer.url+'&requiredPaths=another-task'};
  const wrongQuote={...request,requestId:'wrong-initial-quote'};
  const wrongPacket=await env.service.deliver(wrongQuote);
  assert.equal(wrongPacket.packet.quote.reason,'quote_operation_binding_changed');
  assert.equal(wrongPacket.packet.quote.authorized,false);
});

test('assessment error, no-match, 402, declined work and a second priced scope never mint payment authority',async t=>{
  const env=await service();t.after(env.close);
  const scan=surface({id:'unmet-implementation',fix:false});scan.implementation={requested:true,scope:'Implement the missing OAuth audience validation and its named regression in this caller source.'};scan.quoteIntent=quoteIntent();
  const {packet}=await env.service.deliver(scan);
  assert.equal(packet.quote.reason,'existing_audit_is_not_this_scope');
  assert.equal((await env.service.accept({packetId:packet.packetId,taskId:scan.task.id,callerId:scan.task.callerId,decision:'accepted'})).acceptance.reason,'work_predicate_failed');
  const invalid=structuredClone(scan);invalid.quoteIntent.purpose='new_surface_subscription';
  await assert.rejects(()=>env.service.deliver(invalid),{code:'unsupported_paid_scope'});
  const unavailable=await service({skillguardRoot:null});t.after(unavailable.close);
  const unknown=await unavailable.service.deliver(surface({id:'unobserved-outcome'}));
  const claim=await unavailable.service.review({packetId:unknown.packet.packetId,taskId:'unobserved-outcome',callerId:'caller-a',claimantUseful:true});
  assert.equal(claim.claimantOutcome.state,'unverified_claim');assert.equal(claim.observedWork.reason,'no_independent_observation');
});
