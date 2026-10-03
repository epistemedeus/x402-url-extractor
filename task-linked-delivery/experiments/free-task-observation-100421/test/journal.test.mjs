import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,writeFile,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFreeTaskObservation } from '../src/integration.mjs';
import { nodePort } from './native-ports.mjs';

test('existing customer store loss before append stays unknown and a lost ACK reconciles without replay',async()=>{
  const receipts=[];
  for(const fault of ['before_append','lost_ack']) {
    const dir=await mkdtemp(path.join(tmpdir(),'sol421-owned-write-'));
    try {
      const first=(await nodePort('native-ports.mjs',{dataDir:dir,mode:fault,fault})).value;
      const restarted=(await nodePort('native-ports.mjs',{action:'reconcile',dataDir:dir,request:first.requestA})).value;
      assert.notEqual(first.observation.workerPid,restarted.workerPid);
      assert.equal(first.observation.freeAdmissionCalls,1);assert.equal(first.observation.automaticMutationRetries,0);
      assert.equal(restarted.reason,fault==='lost_ack'?'duplicate':'write_outcome_unknown');
      assert.equal(restarted.physicalRows,fault==='lost_ack'?1:0);assert.equal(restarted.grantReturned,false);
      if(fault==='lost_ack') {
        const file=path.join(dir,'useful-result-customer.ndjson');
        const before=await readFile(file);const row=JSON.parse(before.toString().trim());
        assert.equal(row.paymentPermitted,false);assert.equal(row.paidValidDelivery,false);assert.equal(row.settlementStatus,'unknown');
        const malformed=Buffer.concat([before,Buffer.from('{"torn":')]);await writeFile(file,malformed);
        const torn=(await nodePort('native-ports.mjs',{action:'reconcile',dataDir:dir,request:first.requestA})).value;
        // Store drops a torn tail, so reconciliation is historical readback;
        // it does not repair the tail or append any mutation.
        assert.equal(torn.reason,'duplicate');assert.deepEqual(await readFile(file),malformed);
      }
      receipts.push({...first.observation,restarted});
    } finally {await rm(dir,{recursive:true,force:true});}
  }
  if(process.env.SOL421_EVIDENCE_OUT) {await mkdir(process.env.SOL421_EVIDENCE_OUT,{recursive:true});
    await writeFile(path.join(process.env.SOL421_EVIDENCE_OUT,'lost-ack-restart.json'),JSON.stringify({receipts,
      durability:'existing_customer_store_buffered_write_no_fsync_guarantee',oneWriter:true,
      crossProcessExclusion:false,recognizedRevenueAtomic:'0'},null,2)+'\n');}
});
test('an additional process writer is refused before any port is opened',()=>{
  assert.throws(()=>createFreeTaskObservation({writerProcessCount:2}),e=>e.code==='one_writer_required');
});
