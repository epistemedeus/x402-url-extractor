#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { inventoryArchive, loadPublicAcquisition } from '../../../../public-acquisition/engine.mjs';
import { bytesDigest, digest, fail } from '../src/bounds.mjs';
import { BASE_COMMIT } from '../src/project.mjs';

const pkg=fileURLToPath(new URL('../',import.meta.url)), repo=path.resolve(pkg,'../../..');
const prefix=path.relative(repo,pkg).replaceAll(path.sep,'/');
const args={};
for(let i=2;i<process.argv.length;i+=2){
  if(!['--source-commit','--out'].includes(process.argv[i]) || process.argv[i+1] === undefined) fail('pack_argument_rejected');
  args[process.argv[i]]=process.argv[i+1];
}
const sourceCommit=args['--source-commit'];
if(!/^[a-f0-9]{40}$/.test(sourceCommit || '')) fail('exact_source_commit_required');
const out=path.resolve(args['--out'] || path.join(pkg,'export/public'));
const id='task-demand-100339',version='0.1.0';
const members=['LICENSE','README.md','SOURCE-NOTICE.txt','PIN.json','package.json','bin/task-demand.mjs',
  'src/bounds.mjs','src/export.mjs','src/project.mjs','src/observer-integration.mjs',
  'vendor/causal-contract.mjs','vendor/economics/economics.mjs','vendor/economics/constants.mjs','vendor/economics/errors.mjs',
  'fixtures/questions.json','fixtures/question-negative.json','fixtures/question-independent.json','test/portable.test.mjs'];
const stage=mkdtempSync(path.join(tmpdir(),'task-demand-pack-'));
try {
  const sourceFiles=[];
  for(const rel of members){
    const source=readFileSync(path.join(pkg,rel));
    const committed=spawnSync('git',['show',sourceCommit+':'+prefix+'/'+rel],{cwd:repo,maxBuffer:2_097_152});
    if(committed.status !== 0 || !committed.stdout.equals(source)) fail('source_commit_member_mismatch');
    const dest=path.join(stage,rel);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,source);
    sourceFiles.push({path:prefix+'/'+rel,sha256:bytesDigest(source),bytes:source.length});
  }
  const filename=id+'-'+version+'.tar.gz';
  const packed=spawnSync('tar',['--sort=name','--mtime=UTC 2026-10-02','--owner=0','--group=0','--numeric-owner','-czf',path.join(stage,filename),...members],{cwd:stage,encoding:'utf8'});
  if(packed.status !== 0) fail('pack_failed');
  const bytes=readFileSync(path.join(stage,filename)),inventory=inventoryArchive(bytes);
  if(inventory.length !== members.length || inventory.some(m=>!members.includes(m.path))) fail('unexpected_archive_member');
  const root=path.join(out,'bytes',id,version),invRoot=path.join(out,'inventories');
  mkdirSync(root,{recursive:true});mkdirSync(invRoot,{recursive:true});
  const provenance={schema:'samedaydesk.task-demand.provenance.v1',package:id,version,
    repository:'https://github.com/epistemedeus/x402-url-extractor',sourceCommit,baseCommit:BASE_COMMIT,
    sourceFiles,sourceTreeDigest:digest(sourceFiles),archiveSha256:bytesDigest(bytes),license:'MIT',
    candidate:true,draft:true,productionHosted:false,hostedAcquisitionVerified:false,
    independentDemand:false,outsideUseEstablished:false,recognizedRevenueAtomic:'0',syntheticEvidenceOnly:true};
  const assetsData=[['archive',filename,bytes],['provenance','provenance.json',Buffer.from(JSON.stringify(provenance,null,2)+'\n')],
    ['license','LICENSE',readFileSync(path.join(pkg,'LICENSE'))],['source-notice','SOURCE-NOTICE.txt',readFileSync(path.join(pkg,'SOURCE-NOTICE.txt'))]];
  const invBytes=Buffer.from(JSON.stringify({members:inventory},null,2)+'\n'),invName=id+'-'+version+'.json';
  writeFileSync(path.join(invRoot,invName),invBytes);
  const assets=assetsData.map(([role,filename,body])=>{
    writeFileSync(path.join(root,filename),body);
    return {id,version,role,filename,relativePath:id+'/'+version+'/'+filename,bytes:body.length,sha256:bytesDigest(body),
      mediaType:role==='archive'?'application/gzip':role==='provenance'?'application/json; charset=utf-8':'text/plain; charset=utf-8',
      originContentType:role==='archive'?'application/gzip':'text/plain; charset=utf-8',
      originalUrl:'https://neomorphic.io/downloads/'+id+'/'+version+'/'+filename,
      attribution:'Copyright (c) 2026 SameDayDesk',licenseId:'MIT',sourceQualification:'unknown',sourceQualified:false,privateGit:'unavailable',
      hostedAcquisitionVerified:false,paidLaunch:false,measuredSavings:false,independentDemand:false,publicationStatus:'candidate',
      ...(role==='archive'?{forbiddenPathPrefixes:['.env','data/','secrets/','server.js','node_modules/'],inventory:{path:'inventories/'+invName,fileSha256:bytesDigest(invBytes),memberCount:inventory.length}}:{}),
      ...(role==='provenance'?{carriesPackageClaims:false}:{})};
  });
  const manifest={schema:'samedaydesk.public-acquisition.receiving.v1',draft:true,productionHosted:false,hostedAcquisitionVerified:false,
    deploymentReadback:'untested',primaryOrigin:'https://neomorphic.io',primaryRouteRemainsAvailable:true,allowedOriginalHosts:['neomorphic.io'],
    runtimeDownloadFallback:false,privateGit:'unavailable',paidLaunch:false,measuredSavings:false,independentDemand:false,sourceQualification:'unknown',
    note:'Isolated synthetic cold candidate; originalUrl is a path convention, not verified production hosting.',assets};
  writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  loadPublicAcquisition({manifestPath:path.join(out,'manifest.json'),bytesRoot:path.join(out,'bytes')});
  process.stdout.write(JSON.stringify({sourceCommit,archiveSha256:bytesDigest(bytes),members:inventory.length,sourceTreeDigest:provenance.sourceTreeDigest})+'\n');
} finally {rmSync(stage,{recursive:true,force:true});}
