import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createReuseStore } from '../../../../useful-result-reuse/store.mjs';
import { packetAccess } from '../src/packet-store.mjs';
import { allowance } from '../src/bounds.mjs';
import { service, seller, target } from './support.mjs';

test('physical packet-store bytes, including ignored rows, consume the caller allowance before kernel reads',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'scoped-physical-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file='scoped-repair-packets.ndjson',bytes='not-json\n'.repeat(200);
  await writeFile(path.join(dir,file),bytes);
  const actual=createReuseStore({dataDir:dir,maxFileBytes:4096,maxRecordBytes:1024});
  const access=packetAccess(actual,file),budget=allowance({maxReadBytes:1024});
  await assert.rejects(()=>access.read(budget),{code:'input_bytes_exceeded'});
  const enough=allowance();assert.deepEqual(await access.read(enough),[]);
  assert.equal(enough.snapshot().readBytes,Buffer.byteLength(bytes));
  const timed=allowance({deadlineMs:20});await new Promise(resolve=>setTimeout(resolve,25));
  await assert.rejects(()=>access.mutate(timed,()=>({append:{shouldNotWrite:true}})),{code:'deadline_exceeded'});
  assert.equal(await readFile(path.join(dir,file),'utf8'),bytes);
});

test('existing rotation kernel keeps an append crossing the file threshold readable after restart',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'scoped-store-rotation-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=createReuseStore({dataDir:dir,maxFileBytes:160,maxRecordBytes:128});const row={value:'x'.repeat(70)};
  await store.append('packets.ndjson',row);await store.append('packets.ndjson',row);
  if(process.env.SCOPED_ROOT_MOUNT_PATCHED==='1'){
    const restarted=createReuseStore({dataDir:dir,maxFileBytes:160,maxRecordBytes:128});
    assert.deepEqual(await restarted.read('packets.ndjson'),[row,row]);
    assert.ok((await readFile(path.join(dir,'packets.ndjson'))).length<=160);
  }else await assert.rejects(()=>store.read('packets.ndjson'),{code:'bounds'});
});

test('the existing request normalizer rejects seller GET bodies before any work',async t=>{
  const before=await target(true);t.after(before.close);const env=await service();t.after(env.close);
  const request=seller(before.base);request.operation.body={differentCallerTask:true};
  await assert.rejects(()=>env.service.deliver(request),/GET request body is not supported/);
});
