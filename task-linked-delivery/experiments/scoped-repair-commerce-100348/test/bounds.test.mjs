import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { allowance, fileJson, streamJson } from '../src/bounds.mjs';
import { callService } from '../src/client.mjs';
import { surface, service, seller } from './support.mjs';

const CLI=path.resolve(import.meta.dirname,'../bin/scoped-repair.mjs');
import { processRun } from './process.mjs';

test('raw file/stdin intake, FIFO, total reads and output obey the same allowance',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'scoped-bound-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(path.join(dir,'large.json'),' '.repeat(524289));
  await assert.rejects(()=>fileJson(path.join(dir,'large.json'),allowance()),{code:'input_bytes_exceeded'});
  spawnSync('mkfifo',[path.join(dir,'fifo')],{timeout:1000});
  await assert.rejects(()=>fileJson(path.join(dir,'fifo'),allowance()),{code:'regular_file_required'});
  const hung=await processRun([CLI,'deliver','--service','http://127.0.0.1:1','--request','-','--deadline-ms','120'],{stdin:'{',keepOpen:true,deadline:1200});
  assert.equal(hung.code,2);assert.ok(hung.wallMs<1000);assert.equal(hung.out.includes('paymentPerformed":true'),false);
  const env=await service();t.after(env.close);
  const small=surface();small.limits.maxOutputBytes=1024;
  await assert.rejects(()=>env.service.deliver(small),{code:'output_bytes_exceeded'});
  assert.equal((await readdir(env.dir)).includes('scoped-repair-packets.ndjson'),false);
  const short=surface();short.limits.maxChildren=1;
  await assert.rejects(()=>env.service.deliver(short),{code:'child_limit_exceeded'});
  const input=surface();input.limits.maxReadBytes=1024;
  await assert.rejects(()=>env.service.deliver(input),{code:'input_bytes_exceeded'});
});

test('child execution and slow whole-response transport are actually terminated within one deadline',async t=>{
  const slow=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');});
  await new Promise(resolve=>slow.listen(0,'127.0.0.1',resolve));
  t.after(()=>{slow.closeAllConnections();return new Promise(resolve=>slow.close(resolve));});const base='http://127.0.0.1:'+slow.address().port;
  const start=performance.now();
  await assert.rejects(()=>callService(base,'deliver',surface(),allowance({deadlineMs:100})),{code:'deadline_exceeded'});
  assert.ok(performance.now()-start<800);
  const env=await service();t.after(env.close);const request=seller(base);request.limits.deadlineMs=120;
  const begun=performance.now();await assert.rejects(()=>env.service.deliver(request),{code:'deadline_exceeded'});
  assert.ok(performance.now()-begun<900);
});
