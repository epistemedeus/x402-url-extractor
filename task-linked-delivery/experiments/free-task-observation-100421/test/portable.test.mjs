import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync,statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { projectBundle,replayRetained } from '../src/project.mjs';
const pkg=fileURLToPath(new URL('../',import.meta.url)),cli=path.join(pkg,'bin/free-task-observation.mjs');
const fixture=path.join(pkg,'fixtures/after.bundle.json');
const decisions=r=>r.journeys.map(j=>({eventId:j.commerceEventId,taskRef:j.taskRef,delivery:j.stages.delivery_observation.status,
  independent:j.stages.independently_replayed_output.status,criterion:j.usefulness,
  output:j.stages.independently_replayed_output.output||null,retentionState:j.retentionState,laterUse:j.stages.later_use.status}));
const run=(args,extra={})=>spawnSync(process.execPath,[cli,...args],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000,maxBuffer:2_097_152,...extra});
test('caller-owned source runs in a stripped process and agrees with separate direct equal-input solving',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'sol421-cold-consumer-'));
  try {
    const b=JSON.parse(readFileSync(fixture));
    const all=projectBundle(b),positive=all.journeys.find(j=>j.usefulness==='positive'),negative=all.journeys.find(j=>j.usefulness==='agreed_negative');
    assert.ok(positive);assert.ok(negative);
    const cases=[['all',b],['absence',{...b,question:{...b.question,id:'absence-only',taskRefs:[negative.taskRef]}}]];
    const changed=structuredClone(b);changed.sources.find(s=>s.plane==='forward').records.find(r=>r.commerceEventId===positive.commerceEventId&&r.stage==='transport').receiptDigest='f'.repeat(64);
    cases.push(['changed-response',changed]);
    for(const [name,bundle] of cases) {
      const input=path.join(dir,name+'.json'),receipt=path.join(dir,name+'.retained.json');writeFileSync(input,JSON.stringify(bundle));
      const query=run(['query','--bundle',input,'--retain',receipt]);assert.equal(query.status,0,query.stderr);
      const r=JSON.parse(query.stdout);assert.deepEqual(r,projectBundle(bundle));assert.equal(statSync(receipt).mode&0o777,0o600);
      const direct=spawnSync(process.execPath,[path.join(pkg,'test/direct-equal-input.mjs'),input],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
      assert.equal(direct.status,0,direct.stderr);assert.deepEqual(JSON.parse(direct.stdout).decisions,decisions(r));
      const restarted=run(['replay','--receipt',receipt]);assert.equal(restarted.status,0,restarted.stderr);assert.deepEqual(JSON.parse(restarted.stdout),r);
      if(name==='changed-response') assert.equal(r.journeys.find(j=>j.commerceEventId===positive.commerceEventId).stages.independently_replayed_output.status,'unknown');
    }
    const raw=JSON.parse(readFileSync(path.join(dir,'all.retained.json')));raw.bundle.sources.find(s=>s.plane==='forward').records.pop();
    assert.throws(()=>replayRetained(raw),e=>e.code==='replay_mismatch');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('bounds, output overwrite, symlink, malformed input and silent stdin remain explicit refusals',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'sol421-consumer-bounds-'));
  try {
    const link=path.join(dir,'link.json');symlinkSync(fixture,link);
    assert.equal(run(['query','--bundle',link]).status,2);
    assert.equal(run(['query','--bundle',fixture,'--retain',fixture]).status,2);
    assert.equal(run(['query','--bundle','-'],{input:Buffer.alloc(1_048_577)}).status,2);
    assert.equal(run(['query','--bundle','-'],{input:'{"broken":'}).status,2);
    assert.equal(run(['query','--bundle','-'],{input:'{"a":'+ '['.repeat(26)+'0'+']'.repeat(26)+'}'}).status,2);
    const start=Date.now(),child=spawn(process.execPath,[cli,'query','--bundle','-','--deadline-ms','100'],{env:{PATH:process.env.PATH},stdio:['pipe','pipe','pipe']});
    let stderr='';child.stderr.on('data',b=>stderr+=b);const code=await new Promise(r=>child.once('exit',r));child.stdin.destroy();
    assert.equal(code,2);assert.match(stderr,/deadline_exceeded/);assert.ok(Date.now()-start<2000);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('reuse of exact395 free evidence preserves the original unknowns',()=>{
  const bundle=JSON.parse(readFileSync(path.join(pkg,'fixtures/395-gap.bundle.json'))),r=projectBundle(bundle);
  assert.equal(r.journeys.length,1);assert.equal(r.journeys[0].stages.delivery_observation.status,'unknown');
  assert.equal(r.journeys[0].stages.settlement.status,'unknown');assert.equal(r.recognizedRevenueAtomic,'0');
});
