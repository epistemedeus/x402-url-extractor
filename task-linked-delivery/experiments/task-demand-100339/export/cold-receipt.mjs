import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { loadPublicAcquisition, mountPublicAcquisition, PUBLIC_ACQUISITION_INDEX_PATH } from '../../../../public-acquisition/engine.mjs';
import { fileURLToPath } from 'node:url';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fetchBytes(url,method='GET') {
  const response=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(5000)});
  const chunks=[];let total=0;
  if(response.body) for await (const chunk of response.body) {total+=chunk.length;assert.ok(total<=1_048_576);chunks.push(chunk);}
  return {status:response.status,headers:response.headers,bytes:Buffer.concat(chunks)};
}
export async function coldReceipt(candidate) {
  const loaded=loadPublicAcquisition({manifestPath:path.join(candidate,'manifest.json'),bytesRoot:path.join(candidate,'bytes')});
  const app=express();
  mountPublicAcquisition(app,{published:loaded,publicUrl:'http://127.0.0.1'});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const work=await mkdtemp(path.join(tmpdir(),'task-demand-cold-'));
  const env={PATH:process.env.PATH};
  const run=(cwd,args,input)=>{
    const child=spawnSync(process.execPath,['bin/task-demand.mjs',...args],{cwd,env,input,encoding:'utf8',timeout:10000,maxBuffer:2_097_152});
    assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout);
  };
  try {
    const index=await fetchBytes(base+PUBLIC_ACQUISITION_INDEX_PATH);assert.equal(index.status,200);
    const doc=JSON.parse(index.bytes),asset=doc.assets.find(x=>x.id==='task-demand-100339' && x.role==='archive');
    assert.equal(doc.productionHosted,false);assert.equal(doc.hostedAcquisitionVerified,false);
    const archive=await fetchBytes(base+asset.alternatePath),head=await fetchBytes(base+asset.alternatePath,'HEAD');
    assert.equal(archive.status,200);assert.equal(archive.bytes.length,asset.bytes);assert.equal(sha(archive.bytes),asset.sha256);
    assert.equal(head.status,200);assert.equal(head.bytes.length,0);assert.equal(head.headers.get('content-length'),String(asset.bytes));
    const fetched=[];
    for (const role of ['provenance','license','source-notice']) {
      const described=doc.assets.find(x=>x.id==='task-demand-100339' && x.role===role);
      const body=await fetchBytes(base+described.alternatePath);assert.equal(body.status,200);assert.equal(sha(body.bytes),described.sha256);
      fetched.push({role,bytes:body.bytes.length,sha256:described.sha256});
    }
    const provenance=JSON.parse((await fetchBytes(base+doc.assets.find(x=>x.id==='task-demand-100339' && x.role==='provenance').alternatePath)).bytes);
    const file=path.join(work,asset.filename);await writeFile(file,archive.bytes);
    const a=path.join(work,'consumer-a'),b=path.join(work,'consumer-b');await mkdir(a);await mkdir(b);
    for(const cwd of [a,b]) {
      const unpack=spawnSync('tar',['-xzf',file,'-C',cwd],{env,encoding:'utf8',timeout:10000});assert.equal(unpack.status,0,unpack.stderr);
    }
    const retained=path.join(a,'retained.json');
    const first=run(a,['query','--bundle','fixtures/questions.json','--retain',retained]);
    assert.equal(first.groups.owner_internal.counts.later_use,1);assert.equal(first.groups.recruited_sponsored.counts.later_use,0);
    const replay=run(a,['replay','--receipt',retained]);assert.deepEqual(replay,first);
    const raw=await readFile(path.join(b,'fixtures/questions.json'));
    const second=run(b,['query','--bundle','-','--question','fixtures/question-negative.json'],raw);
    assert.equal(second.journeys[0].stages.later_use.utility,'agreed_negative');
    const changed=JSON.parse(raw),question=JSON.parse(await readFile(path.join(b,'fixtures/question-negative.json')));
    changed.question=question;
    changed.sources.find(s=>s.plane==='retention').records.find(r=>r.taskRef===question.taskRefs[0]).criterion='unknown';
    await writeFile(path.join(b,'changed.json'),JSON.stringify(changed));
    const updated=run(b,['query','--bundle','changed.json','--prior',retained,'--retain','changed-retained.json']);
    assert.equal(updated.groups.unclassified.counts.later_use,0);assert.equal(updated.priorReportId,first.reportId);
    assert.deepEqual(run(b,['replay','--receipt','changed-retained.json']),updated);
    const independent=run(b,['query','--bundle','fixtures/questions.json','--question','fixtures/question-independent.json']);
    assert.equal(independent.journeys[0].classification,'attributable_independent');
    assert.equal(independent.journeys[0].stages.later_use.outsideUseEstablished,false);
    const tests=spawnSync(process.execPath,['--test','test/portable.test.mjs'],{cwd:b,env,encoding:'utf8',timeout:15000});
    assert.equal(tests.status,0,tests.stderr+tests.stdout);
    return {schema:'samedaydesk.task-demand.cold-receipt.v1',observedAt:new Date().toISOString(),proofClass:'loopback_owner_qa',
      productionHosted:false,hostedAcquisitionVerified:false,independentDemand:false,outsideUseEstablished:false,recognizedRevenueAtomic:'0',
      sourceCommit:provenance.sourceCommit,sourceTreeDigest:provenance.sourceTreeDigest,
      acquisitionTool:'public-acquisition/engine.mjs loadPublicAcquisition + mountPublicAcquisition',
      archive:{filename:asset.filename,bytes:archive.bytes.length,sha256:asset.sha256,inventoryMembers:provenance.sourceFiles.length},
      license:'MIT',fetched,freshProcesses:6,questions:[{id:first.question.id,reportId:first.reportId},{id:second.question.id,reportId:second.reportId}],
      restartedReplay:true,changedEvidenceReplay:true,seededIndependentOutsideUseRefused:true,standalonePortableTests:3,
      node:process.version,merchantDependenciesInstalledInConsumers:false,providerCredentialsUsed:false};
  } finally {await new Promise(resolve=>server.close(resolve));await rm(work,{recursive:true,force:true});}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const candidate=process.argv[2] || fileURLToPath(new URL('./public',import.meta.url));
  process.stdout.write(JSON.stringify(await coldReceipt(candidate),null,2)+'\n');
}
