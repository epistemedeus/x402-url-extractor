import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { classify } from '../../../../experiments/seller-repair-service-100266/src/classify.mjs';
import { ROOT, seller, target, service, surface } from './support.mjs';
import { merchant } from './merchant.mjs';
import { allowance } from '../src/bounds.mjs';
import { callService } from '../src/client.mjs';

const patched=process.env.SCOPED_ROOT_MOUNT_PATCHED==='1';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('Root patch applies only to the exact shared contracts; observed false differs from an absent field',async t=>{
  if(!patched){
    const check=spawnSync('git',['apply','--check',path.resolve(import.meta.dirname,'../route/ROOT-INTEGRATION.patch')],{cwd:ROOT,timeout:5000,encoding:'utf8'});
    assert.equal(check.status,0,check.stderr);
  }
  const intake={method:'GET',question:'useful_output',expectedUsefulOutput:{paths:['result.ready'],equals:{path:'result.ready',value:true}}};
  const declared={source:'supplied',requiredPaths:['result.ready']};
  const wrong=classify({intake,declared,observed:{status:200,json:true,paths:['result','result.ready'],values:{'result.ready':false}}});
  assert.equal(wrong.reason,patched?'observed_value_mismatch':'missing_field_not_paid_demand');
  const missing=classify({intake,declared:{source:'supplied',requiredPaths:[]},observed:{status:200,json:true,paths:['result'],values:{}}});
  assert.equal(missing.reason,'missing_field_not_paid_demand');assert.equal(missing.paidAuditRequired,false);
  if(patched){
    const before=await target(false),after=await target(true);t.after(before.close);t.after(after.close);
    const env=await service();t.after(env.close);const result=await env.service.deliver(seller(before.base,after.base));
    assert.equal(result.packet.qualification.state,'compatible_reusable_fix');
    assert.equal(result.packet.baseline.classification.reason,'observed_value_mismatch');
    assert.equal(result.packet.acceptanceResult.passed,true);
  }
});

test('received archives remain sealed under every historical exporter and reject corrupted predecessor bytes',async()=>{
  const folder=path.join(ROOT,'experiments/seller-repair-service-100266');
  const versions=[['pack-consumer.mjs','0.2.0'],['pack-consumer-030.mjs','0.3.0'],['pack-consumer-040.mjs','0.4.0'],['pack-consumer-041.mjs','0.4.1']];
  const sources=await Promise.all(versions.map(async([script,version])=>({script,version,bytes:await readFile(path.join(folder,'candidate','seller-repair-external-consumer-'+version+'.tar.gz'))})));
  // Mutating old exporters run exclusively in the disposable receiving copy.
  if(!patched){assert.equal(sources.length,4);return;}
  for(const entry of sources){
    const result=spawnSync(process.execPath,[path.join(folder,'bin',entry.script)],{cwd:ROOT,timeout:5000,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).sealed,true);
    assert.equal(digest(await readFile(path.join(folder,'candidate','seller-repair-external-consumer-'+entry.version+'.tar.gz'))),digest(entry.bytes));
  }
  const entry=sources[1],file=path.join(folder,'candidate','seller-repair-external-consumer-'+entry.version+'.tar.gz');
  try{
    await writeFile(file,Buffer.concat([entry.bytes,Buffer.from('changed')]));
    const result=spawnSync(process.execPath,[path.join(folder,'bin',entry.script)],{cwd:ROOT,timeout:5000,encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/sealed archive changed/);
  }finally{await writeFile(file,entry.bytes);}
});

test('actual receiving merchant mounts bounded free work and leaves missing acceptance authority explicit',async t=>{
  if(!patched){assert.equal(patched,false);return;}
  const real=await merchant();t.after(real.close);
  const result=await callService(real.base,'deliver',surface({id:'root-mounted-task'}),allowance());
  assert.equal(result.packet.qualification.state,'compatible_reusable_fix');
  assert.equal(result.packet.acceptanceResult.passed,true);assert.equal(result.persistence,'unconfigured');
  assert.equal(result.packet.quote.authorized,false);
  await assert.rejects(()=>callService(real.base,'accept',{packetId:result.packet.packetId,taskId:'root-mounted-task',callerId:'caller-a',decision:'accepted'},allowance()),{code:'delivery_store_unavailable'});
  const invalid=await fetch(real.base+'/commerce/scoped-repair/deliver',{method:'POST',headers:{'content-type':'application/json'},body:'{"broken":',signal:AbortSignal.timeout(1000)});
  assert.equal(invalid.status,400);assert.equal((await invalid.json()).paymentPerformed,false);
  assert.deepEqual(real.calls,{verify:0,settle:0});
});
