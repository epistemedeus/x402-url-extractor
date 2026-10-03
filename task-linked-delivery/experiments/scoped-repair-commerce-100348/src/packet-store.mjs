import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { fail } from './bounds.mjs';

const queues=new WeakMap();
// Existing store remains the only parser, lock, append and rotation kernel.
// Reserve current physical bytes before it reads, including ignored torn rows.
// One configured writer is required; all this service's calls share the queue.
export function packetAccess(store,name){
  if(typeof store.dataDir!=='string'||!Number.isInteger(store.maxFileBytes)||store.maxFileBytes<1||store.maxFileBytes>131072
    ||!Number.isInteger(store.maxRecordBytes)||store.maxRecordBytes>16384||store.maxRecordBytes>store.maxFileBytes)fail('packet_store_contract_required');
  const files=[name.replace(/\.ndjson$/,'.1.ndjson'),name];
  function turn(budget,work){
    const prior=queues.get(store)||Promise.resolve();
    const next=prior.then(async()=>{
      budget.check();
      for(const file of files){
        const entry=await budget.wait(lstat(path.join(store.dataDir,file)).catch(error=>error.code==='ENOENT'?null:Promise.reject(error)));
        if(!entry)continue;
        if(!entry.isFile()||entry.isSymbolicLink())fail('packet_store_source_invalid');
        if(entry.size>store.maxFileBytes)fail('packet_store_bytes_exceeded');
        budget.read(entry.size);
      }
      const result=await budget.wait(work());budget.check();return result;
    });
    queues.set(store,next.catch(()=>{}));return next;
  }
  return Object.freeze({read:budget=>turn(budget,()=>store.read(name)),mutate:(budget,work)=>turn(budget,()=>store.mutate(name,work))});
}
