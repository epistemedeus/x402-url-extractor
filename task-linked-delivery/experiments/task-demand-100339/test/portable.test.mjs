import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const pkg=fileURLToPath(new URL('../',import.meta.url));
const cli=path.join(pkg,'bin/task-demand.mjs');
const fixture=path.join(pkg,'fixtures/questions.json');
const negative=path.join(pkg,'fixtures/question-negative.json');
const run=(args,options={})=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:10000,maxBuffer:2_097_152,...options});

test('stripped files, stdin and another process replay two questions after restart and changed evidence',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'task-demand-cli-'));
  try {
    const receipt=path.join(dir,'retained.json');
    const first=run(['query','--bundle',fixture,'--retain',receipt]);
    assert.equal(first.status,0,first.stderr); const a=JSON.parse(first.stdout);
    assert.equal(statSync(receipt).mode & 0o777,0o600);
    const restarted=run(['replay','--receipt',receipt]);
    assert.equal(restarted.status,0,restarted.stderr); assert.deepEqual(JSON.parse(restarted.stdout),a);
    const second=run(['query','--bundle','-','--question',negative],{input:readFileSync(fixture)});
    assert.equal(second.status,0,second.stderr); const b=JSON.parse(second.stdout);
    assert.equal(b.journeys[0].stages.later_use.utility,'agreed_negative'); assert.notEqual(a.reportId,b.reportId);
    const changed=JSON.parse(readFileSync(fixture));
    changed.sources.find(s=>s.plane==='retention').records[0].criterion='unknown';
    const changedPath=path.join(dir,'changed.json'),changedReceipt=path.join(dir,'changed-receipt.json');
    writeFileSync(changedPath,JSON.stringify(changed));
    const updated=run(['query','--bundle',changedPath,'--prior',receipt,'--retain',changedReceipt]);
    assert.equal(updated.status,0,updated.stderr); const c=JSON.parse(updated.stdout);
    assert.equal(c.priorReportId,a.reportId); assert.equal(c.groups.owner_internal.counts.later_use,0);
    const replay=run(['replay','--receipt',changedReceipt]);
    assert.equal(replay.status,0,replay.stderr); assert.deepEqual(JSON.parse(replay.stdout),c);
    const tampered=JSON.parse(readFileSync(changedReceipt)); tampered.report.denominator.observed=999;
    writeFileSync(changedReceipt,JSON.stringify(tampered));
    assert.equal(run(['replay','--receipt',changedReceipt]).status,2);
    const link=path.join(dir,'link.json'); symlinkSync(fixture,link);
    assert.equal(run(['query','--bundle',link]).status,2);
    assert.equal(run(['query','--bundle',fixture,'--retain',fixture]).status,2);
    assert.equal(run(['query','--bundle','-'],{input:Buffer.alloc(1_048_577)}).status,2);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('stdin silence obeys the CLI hard deadline', async()=>{
  const start=Date.now(), child=spawn(process.execPath,[cli,'query','--bundle','-','--deadline-ms','100'],{stdio:['pipe','pipe','pipe']});
  let stderr=''; child.stderr.on('data',b=>stderr+=b);
  const code=await new Promise(resolve=>child.once('exit',resolve));
  child.stdin.destroy();
  assert.equal(code,2); assert.match(stderr,/deadline_exceeded/); assert.equal(Date.now()-start<2000,true);
});

test('explicit NDJSON export strips private fields and retains torn-data coverage reasons',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'task-demand-export-'));
  try {
    const b=JSON.parse(readFileSync(fixture)),s=b.sources[0];
    const metadata=Object.fromEntries(['id','plane','kind','populationId','scope','from','to','asOf','coverage'].map(k=>[k,s[k]]));
    const file=path.join(dir,'metadata.json'); writeFileSync(file,JSON.stringify(metadata));
    const raw={...s.records[0],userAgent:'private-sentinel',paymentCredential:'private-sentinel'};
    const exported=run(['export','--input','-','--metadata',file,'--format','ndjson'],{input:JSON.stringify(raw)+'\n{"torn":'});
    assert.equal(exported.status,0,exported.stderr); assert.equal(exported.stdout.includes('private-sentinel'),false);
    const source=JSON.parse(exported.stdout); assert.equal(source.intake.torn,1);
    b.sources[0]=source;
    const report=run(['query','--bundle','-'],{input:JSON.stringify(b)});
    assert.equal(report.status,0,report.stderr); assert.equal(JSON.parse(report.stdout).denominator.covered,false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
