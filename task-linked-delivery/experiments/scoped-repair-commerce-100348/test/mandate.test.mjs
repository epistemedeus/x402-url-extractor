import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { NEO, ROOT, NOW } from './support.mjs';
test('actual adjacent mandate rejects current-task, principal, revision, expiry and challenge changes',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'scoped-actual-mandate-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  // Exact private owning modules run only in this disposable harness. They are
  // not vendored, rewritten or included in the licensed public client.
  for(const file of ['authority.mjs','clock.mjs','codes.mjs'])await writeFile(path.join(dir,file),await readFile(path.join(NEO,'experiments/buyer-mandate-20260930/src',file)));
  await symlink(path.join(ROOT,'node_modules'),path.join(dir,'node_modules'),'dir');
  const {evaluateCallerAuthority}=await import(pathToFileURL(path.join(dir,'authority.mjs')));
  const authority={requesterId:'caller-b',taskId:'order-status',audience:'buyer-mandate',principal:'caller-b',method:'GET',path:'/commerce/seller-integrity-audit',
    url:'https://agents.samedaydesk.com/commerce/seller-integrity-audit?origin=https%3A%2F%2Fintegration.example',expiresAt:new Date(NOW+1000).toISOString(),
    recipient:'0x'+'2'.repeat(40),amountAtomic:'10000',network:'eip155:8453',asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',projectionDigest:'sha256:'+'a'.repeat(64),recordRevision:1};
  const task={taskId:authority.taskId,requesterId:authority.requesterId,principal:authority.principal,audience:authority.audience,capabilityId:'seller-audit',method:authority.method,
    path:authority.path,projectionDigest:authority.projectionDigest,recordRevision:1,revoked:false,revokedAt:null,amountAtomic:authority.amountAtomic,recipient:authority.recipient,correctedAt:null};
  const challenge={x402Version:2,resource:{url:authority.url},accepts:[{scheme:'exact',network:authority.network,amount:authority.amountAtomic,asset:authority.asset,payTo:authority.recipient,maxTimeoutSeconds:300}]};
  const journey={capabilityId:task.capabilityId,request:{method:'GET',url:authority.url},execution:{recipient:authority.recipient,amountAtomic:authority.amountAtomic},
    now:new Date(NOW).toISOString(),expiresAt:authority.expiresAt,challengeHeader:Buffer.from(JSON.stringify(challenge)).toString('base64')};
  const input={authority,task,journey,projectionDigest:authority.projectionDigest,navigatedTaskId:task.taskId,now:NOW};
  assert.equal(evaluateCallerAuthority(input).task.taskId,'order-status');
  for(const [change,code] of [[{navigatedTaskId:'wrong-task'},'task_mismatch'],[{task:{...task,principal:'other-owner'}},'principal_mismatch'],
    [{task:{...task,recordRevision:2}},'record_corrected'],[{now:NOW+1001},'expired'],[{task:{...task,revoked:true,revokedAt:new Date(NOW).toISOString()}},'revoked']])
    assert.throws(()=>evaluateCallerAuthority({...input,...change}),{code});
  const altered=structuredClone(challenge);altered.accepts[0].amount='20000';
  assert.throws(()=>evaluateCallerAuthority({...input,journey:{...journey,challengeHeader:Buffer.from(JSON.stringify(altered)).toString('base64')}}),{code:'amount_changed'});
});
