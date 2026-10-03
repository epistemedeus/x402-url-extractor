import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { surface } from './support.mjs';
import { callService } from '../src/client.mjs';
import { allowance } from '../src/bounds.mjs';

import { startHost } from './host-helper.mjs';

test('real lost reply, new host process and bounded retry recover one historical packet without renewed work',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'scoped-lost-reply-'));t.after(()=>rm(dir,{recursive:true,force:true}));let host=await startHost(dir);
  const request=surface();
  await assert.rejects(()=>fetch(host.base+'/commerce/scoped-repair/deliver',{method:'POST',headers:{'content-type':'application/json','x-test-drop-reply':'1'},body:JSON.stringify(request),signal:AbortSignal.timeout(5000)}));
  const before=await readFile(path.join(dir,'scoped-repair-packets.ndjson'),'utf8');
  await host.close();host=await startHost(dir);t.after(host.close);
  const replay=await callService(host.base,'deliver',request,allowance());assert.equal(replay.replay,true);assert.equal(replay.persistence,'historical_readback');
  assert.equal(replay.packet.packetId,JSON.parse(before.trim()).packet.packetId);
  assert.equal(await readFile(path.join(dir,'scoped-repair-packets.ndjson'),'utf8'),before);
  const changed=structuredClone(request);changed.terms.version='updated-terms';
  await assert.rejects(()=>callService(host.base,'deliver',changed,allowance()),{code:'request_binding_changed'});
});
