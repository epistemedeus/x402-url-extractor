import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCommerceTelemetry } from './commerce-events.mjs';

function emit(t) {
  let finish;
  t.middleware({path:'/openapi.json',url:'/openapi.json',method:'GET',headers:{'user-agent':'Agent402/1.0'},query:{},ip:'203.0.113.10',socket:{}},
    {statusCode:200,once(name,fn){if(name==='finish')finish=fn;},getHeader(){return undefined;}},()=>{});
  finish();
}

test('age expiry must not discard an uninterpreted row alongside a proved-old one',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'root-retention-age-'));
  try {
    const t=createCommerceTelemetry({dataDir:dir,secret:'root-retention-test',internalToken:'root-retention-test-token-long',maxBytes:1,maxAgeMs:60000});
    emit(t);await t.flush();
    const row=JSON.parse((await readFile(t.paths.currentPath,'utf8')).trim());
    row.ts=new Date(Date.now()-180000).toISOString();
    const bytes=JSON.stringify(row)+'\nnot-json\n';
    await writeFile(t.paths.rotatedPath,bytes,{mode:0o600});
    emit(t);await t.flush();
    assert.equal(await readFile(t.paths.segmentPaths[2],'utf8'),bytes);
    const snapshot=await t.snapshot({days:1});
    assert.equal(snapshot.requestedWindowComplete,false);
    assert.equal(snapshot.integrityStatus,'unusable_records_present');
  }finally{await rm(dir,{recursive:true,force:true});}
});
