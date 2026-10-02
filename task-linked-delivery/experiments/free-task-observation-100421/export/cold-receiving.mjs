import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp,mkdir,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadPublicAcquisition,mountPublicAcquisition,PUBLIC_ACQUISITION_INDEX_PATH } from '../../../../public-acquisition/engine.mjs';
const pkg=fileURLToPath(new URL('../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const decisions=r=>r.journeys.map(j=>({eventId:j.commerceEventId,taskRef:j.taskRef,delivery:j.stages.delivery_observation.status,
  independent:j.stages.independently_replayed_output.status,criterion:j.usefulness,output:j.stages.independently_replayed_output.output||null,
  retentionState:j.retentionState,laterUse:j.stages.later_use.status}));
export async function coldReceiving(candidate=path.join(pkg,'export/public')) {
  const start=performance.now(),published=loadPublicAcquisition({manifestPath:path.join(candidate,'manifest.json'),bytesRoot:path.join(candidate,'bytes')});
  const app=express();mountPublicAcquisition(app,{published,publicUrl:'http://127.0.0.1'});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port,work=await mkdtemp(path.join(tmpdir(),'sol421-exported-consumer-'));
  const env={PATH:process.env.PATH};const measurements=[];
  const run=(cwd,file,args)=>{const t=performance.now(),r=spawnSync(process.execPath,[file,...args],{cwd,env,encoding:'utf8',timeout:15000,maxBuffer:2_097_152});
    assert.equal(r.status,0,r.stderr+r.stdout);return {value:JSON.parse(r.stdout),elapsedMs:performance.now()-t};};
  async function get(url,method='GET') {
    const r=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(5000)});
    const bytes=Buffer.from(await r.arrayBuffer());assert.ok(bytes.length<=1_048_576);return {status:r.status,headers:r.headers,bytes};
  }
  try {
    const index=await get(base+PUBLIC_ACQUISITION_INDEX_PATH);assert.equal(index.status,200);
    const doc=JSON.parse(index.bytes),asset=doc.assets.find(a=>a.id==='free-task-observation-100421'&&a.role==='archive');assert.ok(asset);
    const file=await get(base+asset.alternatePath),head=await get(base+asset.alternatePath,'HEAD');
    assert.equal(file.status,200);assert.equal(file.bytes.length,asset.bytes);assert.equal(sha(file.bytes),asset.sha256);
    assert.equal(head.status,200);assert.equal(head.bytes.length,0);assert.equal(head.headers.get('content-length'),String(asset.bytes));
    const fetched=[];let provenance;
    for(const role of ['license','source-notice','provenance']) {
      const a=doc.assets.find(a=>a.id===asset.id&&a.role===role),r=await get(base+a.alternatePath);assert.equal(r.status,200);assert.equal(sha(r.bytes),a.sha256);
      fetched.push({role,bytes:r.bytes.length,sha256:a.sha256});if(role==='provenance') provenance=JSON.parse(r.bytes);
    }
    const archive=path.join(work,asset.filename);await writeFile(archive,file.bytes);
    const consumer=path.join(work,'consumer');await mkdir(consumer);const extractStart=performance.now();
    const unpack=spawnSync('tar',['-xzf',archive,'-C',consumer],{env,encoding:'utf8',timeout:10000});assert.equal(unpack.status,0,unpack.stderr);
    const extractionMs=performance.now()-extractStart,adaptStart=performance.now();
    for(const member of provenance.sourceFiles) {
      const rel=member.path.replace('task-linked-delivery/experiments/free-task-observation-100421/','');
      assert.equal(sha(await readFile(path.join(consumer,rel))),member.sha256);
    }
    const adaptationMs=performance.now()-adaptStart;
    const original=JSON.parse(await readFile(path.join(consumer,'fixtures/after.bundle.json')));
    const positive=original.sources.find(s=>s.plane==='retention').records.find(r=>r.observation?.independent.criterion==='positive');
    const negative=original.sources.find(s=>s.plane==='retention').records.find(r=>r.observation?.independent.criterion==='agreed_negative');
    const cases=[['both-objectives',{...original,question:{...original.question,id:'both-useful-free-objectives',taskRefs:[positive.taskRef,negative.taskRef]}}],
      ['absence-only',{...original,question:{...original.question,id:'absence-objective',taskRefs:[negative.taskRef]}}]];
    const changed=structuredClone(cases[0][1]);changed.sources.find(s=>s.plane==='forward').records.find(r=>r.commerceEventId===positive.commerceEventId&&r.stage==='transport').receiptDigest='f'.repeat(64);
    cases.push(['changed-response',changed]);
    for(const [name,bundle] of cases) {
      const input=path.join(work,name+'.json'),receipt=path.join(work,name+'.retained.json');await writeFile(input,JSON.stringify(bundle));
      const consumerResult=run(consumer,'bin/free-task-observation.mjs',['query','--bundle',input,'--retain',receipt]);
      const direct=run(consumer,'test/direct-equal-input.mjs',[input]);assert.deepEqual(direct.value.decisions,decisions(consumerResult.value));
      const restart=run(consumer,'bin/free-task-observation.mjs',['replay','--receipt',receipt]);assert.deepEqual(restart.value,consumerResult.value);
      if(name==='both-objectives') assert.equal(consumerResult.value.rates.independently_replayed_output.value,1);
      if(name==='absence-only') assert.equal(consumerResult.value.journeys[0].usefulness,'agreed_negative');
      if(name==='changed-response') assert.equal(consumerResult.value.rates.independently_replayed_output.value,0.5);
      measurements.push({name,inputBytes:Buffer.byteLength(JSON.stringify(bundle)),inputSha256:sha(Buffer.from(JSON.stringify(bundle))),
        reportId:consumerResult.value.reportId,decisions:decisions(consumerResult.value),directEqualInput:true,
        queryIncludingProcessStartupMs:consumerResult.elapsedMs,directIncludingProcessStartupMs:direct.elapsedMs,restartMs:restart.elapsedMs});
    }
    const testStart=performance.now(),tests=spawnSync(process.execPath,['--test','test/portable.test.mjs'],{cwd:consumer,env,encoding:'utf8',timeout:15000});
    assert.equal(tests.status,0,tests.stdout+tests.stderr);
    const out={schema:'sol421.cold-receiving.v1',observedAt:new Date().toISOString(),node:process.version,
      sourceCommit:provenance.sourceCommit,sourceTreeDigest:provenance.sourceTreeDigest,
      archive:{filename:asset.filename,bytes:file.bytes.length,sha256:asset.sha256,members:provenance.sourceFiles.length},fetched,
      extractionMs,adaptation:{memberHashChecks:provenance.sourceFiles.length,memberVerificationMs:adaptationMs,
        noDependencyInstall:true,explicitCallerInputs:true,environmentKeys:['PATH']},measurements,
      portableTests:{tests:3,pass:3,fail:0,elapsedMs:performance.now()-testStart,tapSha256:sha(Buffer.from(tests.stdout))},
      totalMs:performance.now()-start,acquired:'existing_public_acquisition_loopback_bytes',hosted:false,
      customerCount:'unknown',tokenSavings:'unknown',paymentPermitted:false,recognizedRevenueAtomic:'0'};
    return out;
  } finally {await new Promise(r=>server.close(r));await rm(work,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) process.stdout.write(JSON.stringify(await coldReceiving(process.argv[2]),null,2)+'\n');
