import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { loadPublicAcquisition, mountPublicAcquisition } from '../../../../public-acquisition/engine.mjs';
import { surface, seller, target } from './support.mjs';
import { startHost } from './host-helper.mjs';
import { processRun } from './process.mjs';

const pkg=path.resolve(import.meta.dirname,'..'),candidate=path.join(pkg,'export/current');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('licensed cold HTTP acquisition, two caller tasks, changed later input and restart use the actual owners',async t=>{
  const started=performance.now(),root=await mkdtemp(path.join(tmpdir(),'scoped-cold-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const manifest=JSON.parse(await readFile(path.join(candidate,'manifest.json'))),asset=manifest.assets.find(asset=>asset.role==='archive');
  const provenance=JSON.parse(await readFile(path.join(candidate,'bytes',path.dirname(asset.relativePath),'provenance.json')));
  const repack=spawnSync(process.execPath,[path.join(pkg,'export/pack.mjs'),'--source-commit',provenance.sourceCommit,'--out',path.join(root,'repack')],{timeout:16000,encoding:'utf8',maxBuffer:16384});
  assert.equal(repack.status,0,repack.stderr);assert.equal(JSON.parse(repack.stdout).archiveSha256,provenance.archiveSha256);
  const published=loadPublicAcquisition({manifestPath:path.join(candidate,'manifest.json'),bytesRoot:path.join(candidate,'bytes')});
  const app=express();mountPublicAcquisition(app,{published});const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const index=await fetch(base+'/.well-known/public-acquisition/index.json',{signal:AbortSignal.timeout(1000)});
  assert.equal(index.status,200);assert.equal((await index.json()).productionHosted,false);
  const rel=asset.relativePath;
  const received=await fetch(base+'/.well-known/public-acquisition/assets/'+rel,{signal:AbortSignal.timeout(1000)});
  assert.equal(received.status,200);const bytes=Buffer.from(await received.arrayBuffer());assert.equal(hash(bytes),provenance.archiveSha256);
  const archive=path.join(root,'client.tar.gz');await writeFile(archive,bytes);
  const one=path.join(root,'first'),two=path.join(root,'restart');await mkdir(one);await mkdir(two);
  for(const dir of [one,two]){
    const extract=spawnSync('tar',['-xzf',archive,'-C',dir],{timeout:2000,maxBuffer:16384});assert.equal(extract.status,0);
    const portable=await processRun(['--test','test/portable.test.mjs'],{cwd:dir});assert.equal(portable.code,0,portable.err);
    const smoke=await processRun(['bin/check-cold.mjs'],{cwd:dir});assert.equal(smoke.code,0);assert.equal(JSON.parse(smoke.out).requestRequired,true);
  }
  const data=path.join(root,'isolated-data');let host=await startHost(data);t.after(()=>host.close());
  async function cli(dir,command,input){const result=await processRun(['bin/scoped-repair.mjs',command,'--service',host.base,'--request','-'],{cwd:dir,stdin:JSON.stringify(input),deadline:6000});assert.equal(result.code,0,result.err||result.out);return JSON.parse(result.out);}
  const staticTask=surface({id:'cold-env-task'});
  const staticDelivery=await cli(one,'deliver',staticTask);
  assert.equal(staticDelivery.packet.qualification.state,'compatible_reusable_fix');assert.equal(staticDelivery.packet.acceptanceResult.passed,true);
  const before=await target(null),after=await target(true);t.after(before.close);t.after(after.close);
  const outputTask=seller(before.base,after.base),file=path.join(one,'caller-task.json');await writeFile(file,JSON.stringify(outputTask));
  const response=await processRun(['bin/scoped-repair.mjs','deliver','--service',host.base,'--request','caller-task.json'],{cwd:one,deadline:6000});
  assert.equal(response.code,0,response.err||response.out);const outputDelivery=JSON.parse(response.out);
  assert.equal(outputDelivery.packet.qualification.state,'compatible_reusable_fix');assert.equal(outputDelivery.packet.acceptanceResult.passed,true);
  const missing=surface({id:'cold-missing-fix',fix:false});const negative=await cli(one,'deliver',missing);
  assert.equal(negative.packet.qualification.state,'missing_task_input');assert.equal(negative.packet.acceptanceResult.passed,false);
  const contradiction=await cli(one,'review',{packetId:negative.packet.packetId,taskId:missing.task.id,callerId:missing.task.callerId,claimantUseful:true});
  assert.equal(contradiction.claimantOutcome.state,'contradicted_by_observed_work');
  const changed=surface({id:'cold-env-task',fix:false});changed.requestId='cold-env-later';changed.terms.version='integration-v2';
  const later=await cli(two,'reuse',{packetId:staticDelivery.packet.packetId,request:changed});
  assert.equal(later.applicability,'changed_input_requires_fresh_execution');assert.equal(later.current.acceptanceResult.passed,false);assert.equal(later.paymentInherited,false);
  await host.close();host=await startHost(data);
  const recovered=await cli(two,'deliver',staticTask);assert.equal(recovered.replay,true);assert.equal(recovered.packet.packetId,staticDelivery.packet.packetId);
  const packetFile=path.join(two,'delivery.json');await writeFile(packetFile,JSON.stringify(recovered));
  const check=await processRun(['bin/scoped-repair.mjs','check','--packet','delivery.json'],{cwd:two});assert.equal(check.code,0);
  assert.equal(JSON.parse(check.out).executionAuthenticity,'not_established_by_local_checksum');
  recovered.packet.binding.termsDigest='altered';await writeFile(packetFile,JSON.stringify(recovered));
  assert.equal((await processRun(['bin/scoped-repair.mjs','check','--packet','delivery.json'],{cwd:two})).code,2);
  const receipt={schema:'samedaydesk.scoped-repair.cold-readback.v1',sourceCommit:provenance.sourceCommit,archiveSha256:hash(bytes),archiveBytes:bytes.length,
    acquiringRoute:'actual_public_acquisition_engine_loopback',tasks:[{task:staticTask.task.id,qualification:staticDelivery.packet.qualification.state,passed:true,executionMs:staticDelivery.packet.effort.executionMs},
      {task:outputTask.task.id,qualification:outputDelivery.packet.qualification.state,passed:true,executionMs:outputDelivery.packet.effort.executionMs}],usefulNegative:true,contradictoryOutcome:true,
    changedLaterInput:true,restartedReplay:true,strippedRoots:2,npmInstallRequired:false,wallMs:Math.round(performance.now()-started),
    productionHosted:false,hostedAcquisitionVerified:false,outsideUseful:false,paidProviderCalls:0,settlement:'unknown',recognizedRevenueAtomic:'0'};
  if(process.env.SCOPED_COLD_RECEIPT)await writeFile(process.env.SCOPED_COLD_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
});
