#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { inventoryArchive, loadPublicAcquisition } from '../../../../public-acquisition/engine.mjs';

const pkg=path.resolve(import.meta.dirname,'..'),repo=path.resolve(pkg,'../../..'),prefix=path.relative(repo,pkg);
const id='scoped-repair-commerce-100348',version=JSON.parse(readFileSync(path.join(pkg,'export/client-package.json'))).version;
const hash=x=>createHash('sha256').update(x).digest('hex');
const die=code=>{throw new Error(code);};
const end=performance.now()+15000;let sourceBytes=0;
const remaining=()=>{const left=Math.floor(end-performance.now());if(left<1)die('pack_deadline');return left;};
function read(file){remaining();const size=statSync(file).size;if(size>1048576||sourceBytes+size>2097152)die('pack_source_bound');const bytes=readFileSync(file);sourceBytes+=bytes.length;return bytes;}
function run(command,args,options={}){const result=spawnSync(command,args,{timeout:remaining(),maxBuffer:2097152,...options});if(result.status!==0)die('pack_child_failed');remaining();return result.stdout;}
const args={};
for(let i=2;i<process.argv.length;i+=2){if(!['--source-commit','--out'].includes(process.argv[i])||!process.argv[i+1]||args[process.argv[i]])die('pack_argument');args[process.argv[i]]=process.argv[i+1];}
const sourceCommit=args['--source-commit'];if(!/^[a-f0-9]{40}$/.test(sourceCommit||''))die('exact_source_commit_required');
const out=path.resolve(args['--out']||path.join(pkg,'export/candidates',version));
const stage=mkdtempSync(path.join(tmpdir(),'scoped-client-pack-'));
const sources=[],transforms=[];
function member(from,to,changes=[]){
  const bytes=read(path.join(repo,from));
  const committed=run('git',['show',sourceCommit+':'+from],{cwd:repo});
  if(!committed.equals(bytes))die('source_commit_mismatch');
  let output=bytes.toString('utf8');
  for(const [old,next] of changes){if(output.split(old).length!==2)die('relocation_context');output=output.replace(old,next);}
  const dest=path.join(stage,to);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,output);
  sources.push({path:from,sha256:hash(bytes),bytes:bytes.length});
  transforms.push({member:to,source:from,relocations:changes,sha256:hash(Buffer.from(output))});
}
try{
  for(const file of ['LICENSE','README.md','SOURCE-NOTICE.txt','bin/scoped-repair.mjs','bin/check-cold.mjs'])member(prefix+'/'+file,file);
  member(prefix+'/src/client.mjs','src/client.mjs',[["from 'agent-payment-policy'","from '../vendor/policy/core.mjs'"],["from '../../task-demand-100339/src/bounds.mjs'","from '../vendor/task-demand-bounds.mjs'"]]);
  member(prefix+'/src/contracts.mjs','src/contracts.mjs',[["from 'agent-payment-policy'","from '../vendor/policy/core.mjs'"]]);
  member(prefix+'/src/bounds.mjs','src/bounds.mjs',[["from '../../../../experiments/scoped-surface-delivery-100312/src/budget.mjs'","from '../vendor/surface-budget.mjs'"],["from '../../task-demand-100339/src/bounds.mjs'","from '../vendor/task-demand-bounds.mjs'"]]);
  member('experiments/scoped-surface-delivery-100312/src/budget.mjs','vendor/surface-budget.mjs');
  member('experiments/scoped-surface-delivery-100312/src/pins.mjs','vendor/pins.mjs');
  member('task-linked-delivery/experiments/task-demand-100339/src/bounds.mjs','vendor/task-demand-bounds.mjs');
  member(prefix+'/export/client-package.json','package.json');
  member(prefix+'/export/portable.test.mjs','test/portable.test.mjs');
  // Exact installed public dependency from the merchant lock, with its license.
  const lock=JSON.parse(read(path.join(repo,'package-lock.json')));
  const locked=lock.packages['node_modules/agent-payment-policy'];
  const actual=JSON.parse(read(path.join(repo,'node_modules/agent-payment-policy/package.json')));
  if(locked.version!=='0.12.0'||actual.version!==locked.version||actual.license!=='MIT')die('policy_pin_changed');
  const lockBytes=run('git',['show',sourceCommit+':package-lock.json'],{cwd:repo});
  if(!lockBytes.equals(readFileSync(path.join(repo,'package-lock.json'))))die('lock_commit_mismatch');
  for(const file of ['core.mjs','LICENSE']){
    const bytes=read(path.join(repo,'node_modules/agent-payment-policy',file));
    const dest=path.join(stage,'vendor/policy',file);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,bytes);
    sources.push({path:'npm:agent-payment-policy@0.12.0/'+file,sha256:hash(bytes),bytes:bytes.length,integrity:locked.integrity,resolved:locked.resolved});
  }
  const pin={schema:'samedaydesk.scoped-repair.client-pins.v1',sourceCommit,sourceFiles:sources,relocations:transforms,
    publicDependenciesOnly:true,privateAuthorityIncluded:false,providerExecutionIncluded:false};
  writeFileSync(path.join(stage,'PINS.json'),JSON.stringify(pin,null,2)+'\n');
  const members=transforms.map(x=>x.member).concat(['vendor/policy/core.mjs','vendor/policy/LICENSE','PINS.json']).sort();
  run('tar',['--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','--format=ustar','-cf',path.join(stage,'archive.tar'),...members],{cwd:stage});
  const bytes=run('gzip',['-n','-c',path.join(stage,'archive.tar')]);
  const inventory=inventoryArchive(bytes);
  if(inventory.length!==members.length||inventory.some(m=>!members.includes(m.path)))die('unexpected_member');
  const root=path.join(out,'bytes',id,version),invRoot=path.join(out,'inventories'),filename=id+'-'+version+'.tar.gz';
  const provenance={schema:'samedaydesk.scoped-repair.provenance.v1',id,version,repository:'https://github.com/epistemedeus/x402-url-extractor',sourceCommit,
    merchantAcceptedCommit:'5008b5e7213511e26eb3d369fcc0056e48b4ef20',taskDemandCommit:'91fbf94786658c96c89f94e0f88b03caefd951b0',
    sourceFiles:sources,sourceTreeDigest:hash(JSON.stringify(sources)),archiveSha256:hash(bytes),members:members.length,license:'MIT',
    licensedMinimalSuccessor:true,predecessorArchivesChanged:false,relocations:transforms,candidate:true,draft:true,
    productionHosted:false,hostedAcquisitionVerified:false,sourceAcceptedByRoot:false,independentDemand:false,
    outsideUseEstablished:false,settlement:'unknown',recognizedRevenueAtomic:'0'};
  const invName=id+'-'+version+'.json',invBytes=Buffer.from(JSON.stringify({members:inventory},null,2)+'\n');
  const assetsData=[['archive',filename,bytes],['provenance','provenance.json',Buffer.from(JSON.stringify(provenance,null,2)+'\n')],
    ['license','LICENSE',readFileSync(path.join(pkg,'LICENSE'))],['source-notice','SOURCE-NOTICE.txt',readFileSync(path.join(pkg,'SOURCE-NOTICE.txt'))]];
  const assets=assetsData.map(([role,filename,body])=>({id,version,role,filename,relativePath:id+'/'+version+'/'+filename,bytes:body.length,sha256:hash(body),
    mediaType:role==='archive'?'application/gzip':role==='provenance'?'application/json; charset=utf-8':'text/plain; charset=utf-8',
    originContentType:role==='archive'?'application/gzip':'text/plain; charset=utf-8',originalUrl:'https://neomorphic.io/downloads/'+id+'/'+version+'/'+filename,
    attribution:'Copyright (c) 2026 SameDayDesk',licenseId:'MIT',sourceQualification:'unknown',sourceQualified:false,privateGit:'unavailable',
    hostedAcquisitionVerified:false,paidLaunch:false,measuredSavings:false,independentDemand:false,publicationStatus:'candidate',
    ...(role==='archive'?{forbiddenPathPrefixes:['.env','data/','secrets/','server.js','node_modules/'],inventory:{path:'inventories/'+invName,fileSha256:hash(invBytes),memberCount:inventory.length}}:{}),
    ...(role==='provenance'?{carriesPackageClaims:false}:{})}));
  const manifest={schema:'samedaydesk.public-acquisition.receiving.v1',draft:true,productionHosted:false,hostedAcquisitionVerified:false,deploymentReadback:'untested',
    primaryOrigin:'https://neomorphic.io',primaryRouteRemainsAvailable:true,allowedOriginalHosts:['neomorphic.io'],runtimeDownloadFallback:false,
    privateGit:'unavailable',paidLaunch:false,measuredSavings:false,independentDemand:false,sourceQualification:'unknown',
    note:'Licensed current client candidate. Loopback readback does not establish current production hosting or outside usefulness.',assets};
  const outputs=assetsData.map(([,file,body])=>[path.join(root,file),body]).concat([[path.join(invRoot,invName),invBytes],[path.join(out,'manifest.json'),Buffer.from(JSON.stringify(manifest,null,2)+'\n')]]);
  // This successor version becomes sealed on first export, including sidecars.
  for(const [file,body] of outputs)if(existsSync(file)&&!readFileSync(file).equals(body))die('sealed_successor_changed');
  for(const [file,body] of outputs){mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,body);}
  loadPublicAcquisition({manifestPath:path.join(out,'manifest.json'),bytesRoot:path.join(out,'bytes')});
  process.stdout.write(JSON.stringify({sourceCommit,archiveSha256:hash(bytes),bytes:bytes.length,members:members.length,sourceTreeDigest:provenance.sourceTreeDigest})+'\n');
}finally{rmSync(stage,{recursive:true,force:true});}
