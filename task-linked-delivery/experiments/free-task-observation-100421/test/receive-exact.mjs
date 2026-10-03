#!/usr/bin/env node
// Executable remote-VM receiving, always in a newly created disposable clone.
// No production journal, source reset, merge, deployment or payment.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir,hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
const pkg=fileURLToPath(new URL('../',import.meta.url)),repo=path.resolve(pkg,'../../..');
const prefix=path.relative(repo,pkg),pin=JSON.parse(readFileSync(path.join(pkg,'PIN.json')));
const out=path.resolve(process.argv[2]||path.join(pkg,'evidence/exact-receiving'));
mkdirSync(out,{recursive:true});
const work=mkdtempSync(path.join(tmpdir(),'sol421-final-exact-source-'));
const env={PATH:process.env.PATH,GH_CONFIG_DIR:'/home/ubuntu/.config/pilot-gh'};
const sha=x=>createHash('sha256').update(x).digest('hex'),checks=[];
function run(name,command,args,{cwd=work,extraEnv={}}={}) {
  const start=performance.now(),r=spawnSync(command,args,{cwd,env:{...env,...extraEnv},encoding:'utf8',timeout:120000,maxBuffer:8_388_608});
  const log=(r.stdout||'')+(r.stderr||'');writeFileSync(path.join(out,name+'.log'),log);
  const readCount=name=>Number(log.match(new RegExp('^# '+name+' (\\d+)$','m'))?.[1]||0);
  checks.push({name,command:[command,...args],exitCode:r.status,elapsedMs:performance.now()-start,
    logSha256:sha(Buffer.from(log)),tests:readCount('tests'),pass:readCount('pass'),fail:readCount('fail')});
  if(r.status!==0) throw new Error(name+'_failed; inspect '+path.join(out,name+'.log'));
  return r.stdout;
}
try {
  run('clone','git',['clone','--quiet','--no-hardlinks','--no-checkout',repo,work],{cwd:repo});
  run('checkout','git',['checkout','--quiet','--detach',pin.baseCommit]);
  for(const p of [...pin.upstreamFiles,...pin.frozenArchives]) if(sha(readFileSync(path.join(work,p.path)))!==p.sha256) throw new Error('exact_source_pin_mismatch:'+p.path);
  // Replenish the pinned historic source's lazy blobs through the already
  // authorized official helper. Never inspect/print helper config or credentials.
  run('historical-source','git',['-c','credential.helper=','-c','credential.helper=!/usr/bin/gh auth git-credential',
    'fetch','--refetch','--no-filter','--no-tags','https://github.com/epistemedeus/x402-url-extractor.git','dd30439b991b4fbecc67365af68f7fd2acaccc91']);
  run('lockfile-dependencies','npm',['ci','--ignore-scripts','--no-audit','--no-fund']);
  cpSync(pkg,path.join(work,prefix),{recursive:true});
  run('before-native',process.execPath,['--test',prefix+'/test/native.test.mjs'],{extraEnv:{SOL421_RECEIVING_MODE:'before',SOL421_EVIDENCE_OUT:path.join(out,'before')}});
  for(const patch of pin.rootAdoptionPatches) {
    const file=path.join(pkg,patch.path);if(sha(readFileSync(file))!==patch.sha256) throw new Error('patch_pin_mismatch');
    run(path.basename(patch.path)+'.check','git',['apply','--check',file]);
    run(path.basename(patch.path)+'.apply','git',['apply',file]);
  }
  const tests=readdirSync(path.join(work,prefix,'test')).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>prefix+'/test/'+f);
  run('owned-mounted',process.execPath,['--test','--test-concurrency=1',...tests],{extraEnv:{SOL421_EVIDENCE_OUT:path.join(out,'after')}});
  const priorProjection='task-linked-delivery/experiments/task-demand-100339/test/';
  const priorTests=readdirSync(path.join(work,priorProjection)).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>priorProjection+f);
  run('exact395',process.execPath,['--test',...priorTests,'docs/reviews/sol395-causal-task-receiving/receiving.test.mjs']);
  run('paid-and-journals',process.execPath,['--test','--test-concurrency=1',
    'commerce-outcome-binding.concurrency.test.mjs','commerce-outcome-binding.test.mjs','commerce-outcome-binding.root.test.mjs',
    'commerce-events.test.mjs','commerce-settlement-reconciler.test.mjs','commerce-settlement-source-delivery.test.mjs',
    'task-linked-delivery/receiving.test.mjs','task-linked-delivery/experiments/delivery-outcome-100173/test/join.test.mjs',
    'task-linked-delivery/experiments/useful-economics-100290/test/join.test.mjs',
    'task-linked-delivery/experiments/useful-economics-100290/test/merchant-execution.test.mjs',
    'task-linked-delivery/experiments/useful-economics-100290/test/cold-export.test.mjs',
    'useful-result-reuse.test.mjs','useful-result-reuse.customer-grant.test.mjs','useful-result-reuse.customer-http.test.mjs',
    'useful-result-reuse.http.test.mjs','paid-useful-journey.test.mjs']);
  const changes=run('disposable-shared-diff','git',['diff','--numstat']);
  const summary={schema:'sol421.exact-receiving.v1',observedAt:new Date().toISOString(),node:process.version,host:hostname(),
    baseCommit:pin.baseCommit,checks,disposableSharedDiff:changes.trim().split('\n'),sharedWorkspaceChanged:false,
    original395DurationFixUnchanged:true,frozenArchivesUnchanged:true,productionJournalEnrolled:false,
    currentPaymentAuthorityChanged:false,modelChildren:0,realPayments:0,keyCreation:0,
    tokenSavings:'unknown',customerCount:'unknown',recognizedRevenueAtomic:'0'};
  writeFileSync(path.join(out,'validation.json'),JSON.stringify(summary,null,2)+'\n');
  process.stdout.write(JSON.stringify({baseCommit:pin.baseCommit,checks:checks.map(c=>({name:c.name,pass:c.pass,fail:c.fail})),validation:path.join(out,'validation.json')})+'\n');
} finally {rmSync(work,{recursive:true,force:true});}
