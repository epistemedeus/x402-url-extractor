#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
// A useful negative, without a default task, service, credential or network.
const run=spawnSync(process.execPath,[path.join(import.meta.dirname,'scoped-repair.mjs'),'deliver'],
  {env:{PATH:process.env.PATH||''},timeout:2000,maxBuffer:16384,encoding:'utf8'});
let result;try{result=JSON.parse(run.stdout);}catch{throw new Error('cold_client_invalid_reply');}
if(run.status!==2||result.reason!=='request_required'||result.executed!==false||result.paymentPerformed!==false)throw new Error('cold_client_refusal_failed');
process.stdout.write(JSON.stringify({requestRequired:true,executed:false,paymentPerformed:false,recognizedRevenueAtomic:'0'})+'\n');
