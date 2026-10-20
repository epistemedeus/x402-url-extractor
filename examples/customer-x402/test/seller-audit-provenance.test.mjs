import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const provenance=()=>JSON.parse(readFileSync(path.join(REPO,'public-acquisition/bytes/samedaydesk-seller-audit-buyer/0.1.0/provenance.json')));
test('draft provenance pins a committed source containing the packed seller-audit implementation',()=>{
 const p=provenance();
 const source=spawnSync('git',['show',`${p.sourceCommit}:examples/customer-x402/src/seller-audit.mjs`],{cwd:REPO,encoding:'utf8'});
 assert.equal(source.status,0,source.stderr);
 assert.equal(source.stdout,readFileSync(path.join(REPO,'examples/customer-x402/src/seller-audit.mjs'),'utf8'));
});

import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(args,cwd=REPO)=>{const r=spawnSync('git',args,{cwd,maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr.toString());return r.stdout;};
const archive=path.join(REPO,'public-acquisition/bytes/samedaydesk-seller-audit-buyer/0.1.0/samedaydesk-seller-audit-buyer-0.1.0.tar.gz');
const rewrite=text=>text.replaceAll('from "../../../extract-excerpt-budget.mjs"','from "../vendor/extract-excerpt-budget.mjs"')
 .replaceAll('from "../../../extract-batch-config.mjs"','from "../vendor/extract-batch-config.mjs"')
 .replaceAll('from "../../../caller-result-client/src/http-caller-result.mjs"','from "../vendor/caller-result/http-caller-result.mjs"');

test('packed/source/lock and producer provenance are exact committed bytes',()=>{
 const p=provenance(), work=mkdtempSync(path.join(tmpdir(),'seller-audit-equivalence-'));
 try {
  assert.match(p.sourceCommit,/^[a-f0-9]{40}$/);assert.match(p.sourceTree,/^[a-f0-9]{40}$/);
  assert.equal(p.sourceTree,git(['rev-parse',`${p.sourceCommit}^{tree}`]).toString().trim());
  assert.equal(p.packedArchiveSha256,digest(readFileSync(archive)));
  const unpack=spawnSync('tar',['-xzf',archive,'-C',work],{encoding:'utf8'});assert.equal(unpack.status,0,unpack.stderr);
  assert.ok(p.inputs.some(i=>i.path===p.producer));
  assert.ok(p.inputs.some(i=>i.path==='public-acquisition/engine.mjs'));
  assert.equal(new Set(p.inputs.map(i=>i.path)).size,p.inputs.length);
  let mapped=0;
  for (const input of p.inputs) {
   const original=git(['show',`${p.sourceCommit}:${input.path}`]);
   assert.equal(input.sha256,digest(original));assert.equal(input.bytes,original.length);
   assert.equal(input.gitBlob,git(['rev-parse',`${p.sourceCommit}:${input.path}`]).toString().trim());
   assert.deepEqual(readFileSync(path.join(REPO,input.path)),original);
   if(input.packedPath) {
    const expected=input.path.startsWith('examples/customer-x402/src/')?Buffer.from(rewrite(original.toString())):original;
    assert.deepEqual(readFileSync(path.join(work,input.packedPath)),expected,input.path);mapped++;
   }
  }
  assert.equal(mapped,25); // twenty buyer modules/entry plus four vendor modules and license
  const lock=JSON.parse(git(['show',`${p.sourceCommit}:examples/customer-x402/package-lock.json`]));
  lock.name=p.package;lock.version=p.version;lock.packages[''].name=p.package;lock.packages[''].version=p.version;
  lock.packages[''].bin={'samedaydesk-seller-audit':'bin/seller-audit.mjs'};
  assert.deepEqual(JSON.parse(readFileSync(path.join(work,'package-lock.json'))),lock);
  const pkg=JSON.parse(readFileSync(path.join(work,'package.json')));
  assert.deepEqual(pkg.dependencies,lock.packages[''].dependencies);
  assert.equal(pkg.dependencies['@x402/fetch'],'2.16.0');
 } finally {rmSync(work,{recursive:true,force:true});}
});

test('packer refuses dirty source/vendor/lock/producer and stale provenance before changing draft assets',()=>{
 const work=mkdtempSync(path.join(tmpdir(),'seller-audit-dirty-'));
 try {
  git(['clone','--quiet','--shared',REPO,work]);
  const manifest=path.join(work,'public-acquisition/manifest.json');const before=digest(readFileSync(manifest));
  const run=(args=[])=>spawnSync(process.execPath,['examples/customer-x402/export/pack-seller-audit.mjs',...args],{cwd:work,encoding:'utf8'});
  for(const rel of ['examples/customer-x402/src/output.mjs','extract-excerpt-budget.mjs','examples/customer-x402/package-lock.json','examples/customer-x402/export/pack-seller-audit.mjs','public-acquisition/engine.mjs']) {
   writeFileSync(path.join(work,rel),Buffer.concat([readFileSync(path.join(work,rel)),Buffer.from('\n ')]));
   const r=run();assert.notEqual(r.status,0,rel);assert.match(r.stderr,/dirty committed input/);
   assert.equal(digest(readFileSync(manifest)),before);git(['restore','--',rel],work);
  }
  const staged='examples/customer-x402/src/output.mjs';
  const original=readFileSync(path.join(work,staged));
  writeFileSync(path.join(work,staged),Buffer.concat([original,Buffer.from('\n ')]));
  git(['add','--',staged],work);writeFileSync(path.join(work,staged),original);
  const stagedResult=run();assert.notEqual(stagedResult.status,0);assert.match(stagedResult.stderr,/dirty committed input/);
  git(['restore','--staged','--worktree','--',staged],work);
  // An explicit old commit cannot label newer consumed bytes as that source.
  const stale=run(['--source-commit','aab96934b6b5e9a623089949d37b672ea826055b']);
  assert.notEqual(stale.status,0);assert.match(stale.stderr,/dirty input|dirty committed input/);
  assert.equal(digest(readFileSync(manifest)),before);
 } finally {rmSync(work,{recursive:true,force:true});}
});

test('packer refuses a sealed draft target before replacing any archive',()=>{
 const work=mkdtempSync(path.join(tmpdir(),'seller-audit-sealed-'));
 try {
  git(['clone','--quiet','--shared',REPO,work]);
  const relative='public-acquisition/manifest.json', manifest=path.join(work,relative);
  const data=JSON.parse(readFileSync(manifest));
  for(const asset of data.assets) if(asset.id==='samedaydesk-seller-audit-buyer') asset.publicationStatus='sealed';
  writeFileSync(manifest,JSON.stringify(data));
  const relativeArchive=path.relative(REPO,archive),before=digest(readFileSync(path.join(work,relativeArchive)));
  const r=spawnSync(process.execPath,['examples/customer-x402/export/pack-seller-audit.mjs'],{cwd:work,encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stderr,/sealed or hosted asset/);
  assert.equal(digest(readFileSync(path.join(work,relativeArchive))),before);
 } finally {rmSync(work,{recursive:true,force:true});}
});
