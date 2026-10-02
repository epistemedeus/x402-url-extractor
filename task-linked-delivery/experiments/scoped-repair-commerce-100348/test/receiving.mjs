#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';

const pkg=path.resolve(import.meta.dirname,'..'),root=path.resolve(pkg,'../../..'),prefix=path.relative(root,pkg);
const dir=mkdtempSync(path.join(tmpdir(),'sol348-root-receiving-'));
function run(cmd,args,options={}){const result=spawnSync(cmd,args,{cwd:dir,timeout:120000,maxBuffer:4194304,encoding:'utf8',...options});if(result.status!==0){process.stderr.write((result.stdout||'').slice(-20000)+(result.stderr||'').slice(-4000));throw new Error('receiving_check_failed');}return result.stdout;}
run('git',['clone','--local','--no-hardlinks',root,dir],{cwd:root,timeout:15000});
cpSync(pkg,path.join(dir,prefix),{recursive:true});symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
const patch=path.join(dir,prefix,'route/ROOT-INTEGRATION.patch');
try{run(process.execPath,[path.join(dir,prefix,'export/install-candidate.mjs'),'--apply'],{timeout:10000});}catch(error){if(error.message!=='receiving_check_failed')throw error;throw new Error('export_required_before_receiving');}
run('git',['apply','--check',patch],{timeout:5000});run('git',['apply',patch],{timeout:5000});
run('git',['add','server.js','commerce-events.mjs','useful-result-reuse/store.mjs','experiments/seller-repair-service-100266','public-acquisition',prefix]);
run('git',['-c','user.name=Disposable receiving QA','-c','user.email=qa@example.invalid','commit','-m','Disposable Root mount and source defect regression']);
const env={PATH:process.env.PATH||'',SCOPED_ROOT_MOUNT_PATCHED:'1',SCOPED_SURFACE_AUTHORITY:process.env.SCOPED_SURFACE_AUTHORITY||'/home/ubuntu/root-sol-347/packages/accepted-derivative/src/index.mjs',
  NEO_OWNER_ROOT:process.env.NEO_OWNER_ROOT||'/home/ubuntu/root-sol-347',SKILLGUARD_ROOT:process.env.SKILLGUARD_ROOT||'/home/ubuntu/sol348-skillguard'};
const suites=[['package',[prefix+'/test/*.test.mjs']],['commerce-journal-source',[
  'experiments/seller-repair-service-100266/test/*.test.mjs','task-linked-delivery/experiments/task-demand-100339/test/*.test.mjs',
  'commerce-events.test.mjs','commerce-payment-evidence.test.mjs','commerce-outcome-binding*.test.mjs','commerce-settlement-reconciler.test.mjs',
  'commerce-settlement-source-delivery.test.mjs','task-linked-delivery/receiving.test.mjs','useful-result-reuse.test.mjs']],
  ['surface-source',['experiments/scoped-surface-delivery-100312/test/*.test.mjs']],['public-acquisition',['public-acquisition/*.test.mjs']]];
const checks=[];
for(const [name,files] of suites){
  // Node 22 expands test globs, without a shell or shared environment secrets.
  const output=run(process.execPath,['--test','--test-concurrency=1',...files],{env});writeFileSync(path.join(dir,'sol348-'+name+'.tap'),output);
  const count=key=>Number(output.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]);
  checks.push({suite:name,tests:count('tests'),pass:count('pass'),fail:count('fail'),skipped:count('skipped'),logSha256:createHash('sha256').update(output).digest('hex')});
}
const status=run('git',['status','--porcelain','--untracked-files=no']);if(status.trim())throw new Error('receiving_modified_committed_source');
const receipt={schema:'samedaydesk.scoped-repair.receiving-qa.v1',sourceCommit:run('git',['-C',root,'rev-parse','HEAD']).trim(),
  receivingCommit:run('git',['rev-parse','HEAD']).trim(),patchSha256:createHash('sha256').update(readFileSync(patch)).digest('hex'),
  checks,disposableDirectory:dir,sharedSourceChangedInWorker:false,productionHosted:false,hostedAcquisitionVerified:false,
  outsideUseful:false,settlement:'unknown',paidProviderCalls:0,recognizedRevenueAtomic:'0'};
if(process.env.SCOPED_RECEIVING_RECEIPT)writeFileSync(process.env.SCOPED_RECEIVING_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
