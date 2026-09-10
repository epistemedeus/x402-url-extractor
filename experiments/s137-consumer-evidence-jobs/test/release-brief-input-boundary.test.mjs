// Portable regression: no fixture files, network, or parent checkout required.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateReleaseBriefInput,validateReleaseBrief} from '../src/release-brief/schema.mjs';
import {buildReleaseBrief,normalizeReleaseBriefInput} from '../src/release-brief/transform.mjs';
const pack=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const cli=existsSync(join(pack,'scripts/cli.mjs'))?join(pack,'scripts/cli.mjs'):join(pack,'bin/cli.mjs');
const repeat=[resolve(pack,'../s178-consumer-repeat-package'),resolve(pack,'../..'),resolve(pack,'..')].find(p=>existsSync(join(p,'bin/s178-cli.mjs')));
const clock='2026-09-10T18:00:00.000Z';
function aligned(){return {clock,evidenceClass:'synthetic',sources:['announced','shipped','tested'].map((plane,i)=>({id:`source-${i}`,plane,kind:['release-notes','git-tag','test-receipt'][i],path:`absent-${i}.json`,identity:{role:i?'observed':'claimed',tag:'v1.2.0'},payload:{}}))};}
const cases=[];
function bad(name,mutate,code,path){let input=aligned();const result=mutate(input);cases.push({name,input:result===undefined?input:result,code,path});}
for(const value of [null,false,7,'',[],{}]) {
 const label=JSON.stringify(value);
 for(const key of ['plane','lane'])bad(`${key}:${label}`,x=>{x.sources[0][key]=value},'invalid_plane',`/sources/0/${key}`);
 bad(`id:${label}`,x=>{x.sources[0].id=value},'invalid_source_id','/sources/0/id');
 bad(`kind:${label}`,x=>{x.sources[0].kind=value},'unknown_source_kind','/sources/0/kind');
 bad(`role:${label}`,x=>{x.sources[0].identity.role=value},'identity_role_mismatch','/sources/0/identity/role');
 if(typeof value!=='string')for(const key of ['tag','version','commitSha'])bad(`${key}:${label}`,x=>{x.sources[0].identity[key]=value},'invalid_identity_field',`/sources/0/identity/${key}`);
 if(value===null||typeof value!=='object'||Array.isArray(value))for(const key of ['identity','payload','fields','doc'])bad(`${key}:${label}`,x=>{x.sources[0][key]=value},`invalid_${key}`,`/sources/0/${key}`);
 bad(`sha:${label}`,x=>{x.sources[0].sha256=value},value===null||value===''?'missing_content_sha256':'invalid_content_sha256','/sources/0/sha256');
 if(value!==null)for(const key of ['path','url'])bad(`${key}:${label}`,x=>{x.sources[0][key]=value},'invalid_locator',`/sources/0/${key}`);
 if(value!==null)bad(`retrievedAt:${label}`,x=>{x.sources[0].retrievedAt=value},value===''?'missing_clock':'invalid_clock','/sources/0/retrievedAt');
 if(value!==null&&typeof value!=='string')bad(`licenseNote:${label}`,x=>{x.sources[0].licenseNote=value},'invalid_license_note','/sources/0/licenseNote');
 bad(`clock:${label}`,x=>{x.clock=value},value===null||value===''?'missing_clock':'invalid_clock','/clock');
 bad(`evidenceClass:${label}`,x=>{x.evidenceClass=value},'invalid_evidence_class','/evidenceClass');
 bad(`schema:${label}`,x=>{x.schema=value},'unexpected_schema','/schema');
 if(!Array.isArray(value))bad(`sources:${label}`,x=>{x.sources=value},'missing_sources','/sources');
 if(value===null||typeof value!=='object'||Array.isArray(value))bad(`source:${label}`,x=>{x.sources[0]=value},typeof value==='object'&&value!==null&&!Array.isArray(value)?null:'invalid_source','/sources/0');
 if(value===null||typeof value!=='object'||Array.isArray(value)) bad(`root:${label}`,()=>value,'invalid_input','');
}
for(const [key,code,path] of [['plane','invalid_plane','/plane'],['kind','unknown_source_kind','/kind'],['role','identity_role_mismatch','/identity/role']])bad(`${key}:bogus`,x=>{if(key==='role')x.sources[0].identity.role='bogus';else x.sources[0][key]='bogus'},code,`/sources/0${path}`);
bad('whitespace id',x=>{x.sources[0].id=' '},'invalid_source_id','/sources/0/id');
bad('duplicate id',x=>{x.sources[1].id=x.sources[0].id},'duplicate_source_id','/sources/1/id');
bad('fields invalid identity',x=>{x.sources[0].fields={identity:null}},'invalid_identity','/sources/0/fields/identity');
bad('doc explicit bad plane',x=>{x.sources[0].doc={plane:'bogus'}},'invalid_plane','/sources/0/doc/plane');
bad('schema source cannot unwrap other input',x=>{x.input=aligned();x.expect={};x.sources=null},'missing_sources','/sources');
function good(name,input,decision='pass'){cases.push({name,input,decision});}
good('explicit caller',aligned());
let convenience=aligned();for(const s of convenience.sources){delete s.kind;delete s.id;delete s.path;delete s.identity.role;}good('omitted kind role id locator',convenience);
let noPlane=aligned();for(const s of noPlane.sources)delete s.plane;good('infer plane from kind',noPlane);
let raw={clock,evidenceClass:'synthetic',announced:{tag:'v1.2.0'},shipped:{tag:'v1.2.0'},tested:{tag:'v1.2.0'}};good('raw lane caller',raw);
good('nested raw lanes',{clock,evidenceClass:'synthetic',lanes:{announced:raw.announced,shipped:raw.shipped,tested:raw.tested}});
for(const key of ['plane','kind','identity','payload','sha256'])cases.push({name:`raw invalid ${key}`,input:{...structuredClone(raw),announced:{...raw.announced,[key]:null}},code:key==='plane'?'invalid_plane':key==='kind'?'unknown_source_kind':key==='sha256'?'missing_content_sha256':`invalid_${key}`,path:`/announced/${key}`});
let optional=aligned();optional.subject=null;for(const s of optional.sources){s.url=null;s.retrievedAt=null;s.licenseNote=null;}good('documented nullable unknowns',optional);
let empty=aligned();for(const s of empty.sources)delete s.identity;good('missing identities remains partial',empty,'partial');
let disjoint=aligned();disjoint.sources[2].identity={role:'observed',commitSha:'a'.repeat(40)};good('disjoint identities',disjoint,'unknown');
let bridge=structuredClone(disjoint);bridge.sources[1].identity.commitSha='a'.repeat(40);good('genuine item bridge',bridge);
let falseBridge=structuredClone(disjoint);falseBridge.sources.push({id:'separate-announcement',plane:'announced',kind:'release-notes',path:'other.json',identity:{role:'claimed',commitSha:'a'.repeat(40)}});good('unrelated announcement cannot bridge',falseBridge,'unknown');
const diagnostics=result=>(result?.issues??[]).map(i=>`${i.code}@${i.instancePath}`);
for(const c of cases)test(`input boundary ${c.name}`,async()=>{
 const checked=validateReleaseBriefInput(c.input),native=buildReleaseBrief(c.input),normalized=normalizeReleaseBriefInput(c.input);
 const invalid=!c.decision;
 assert.equal(checked.ok,!invalid,JSON.stringify(checked));
 if(c.code)assert.ok(diagnostics(checked).includes(`${c.code}@${c.path}`),JSON.stringify(checked));
 assert.equal(native.ok,!invalid,JSON.stringify(native.issues));
 assert.equal(normalized.ok,!invalid,JSON.stringify(normalized.issues));
 assert.equal(native.decision,invalid?'fail':c.decision);
 if(invalid)for(const diagnostic of diagnostics(checked))assert.ok(diagnostics(native).includes(diagnostic),`lost ${diagnostic}`);
 if(native.brief){assert.equal(native.brief.decision,native.decision);assert.equal(validateReleaseBrief(native.brief).ok,true,JSON.stringify(validateReleaseBrief(native.brief)));}
 const dir=mkdtempSync(join(tmpdir(),'release-boundary-'));
 try{
 const inputPath=join(dir,'input.json');writeFileSync(inputPath,JSON.stringify(c.input));
 for(const [runner,args] of [[cli,['analyze','release-brief']],...(repeat?[[join(repeat,'bin/s178-cli.mjs'),['run','release-brief']]]:[])]){
 const proc=spawnSync(process.execPath,[runner,...args,'--in',inputPath,'--clock',clock],{cwd:dir,encoding:'utf8',timeout:10000});
 assert.equal(proc.error,undefined);const result=JSON.parse(proc.stdout);
 assert.equal(result.ok,!invalid,`${runner}: ${proc.stdout}`);assert.equal(result.decision,native.decision,`${runner}: ${proc.stdout}`);
 assert.equal(proc.status,invalid?1:0,proc.stderr);
 if(invalid){const seen=diagnostics(result.validation??result.error??result);for(const diagnostic of diagnostics(checked))assert.ok(seen.includes(diagnostic),`${runner} lost ${diagnostic}: ${proc.stdout}`);}
 }
 if(repeat){const {runJob}=await import(pathToFileURL(join(repeat,'src/run-job.mjs')));const result=await runJob({jobToken:'release-brief',inputPath,clock,mode:'import'});assert.equal(result.ok,!invalid);assert.equal(result.decision,native.decision);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('wrappers preserve supplied invalid clock and evidence class; omitted wrapper clock uses operator clock',()=>{
 const dir=mkdtempSync(join(tmpdir(),'release-wrapper-'));
 try{for(const wrapped of [true,false])for(const [key,value] of [['clock',null],['clock',false],['clock',''],['evidenceClass',null],['clock',undefined]]){
  const input=aligned();if(value===undefined)delete input[key];else input[key]=value;
  const file=join(dir,'case.json');writeFileSync(file,JSON.stringify(wrapped?{schema:'s137.release-brief.synthetic-case.v1',input}:input));
  for(const [runner,args] of [[cli,['analyze','release-brief']],...(repeat?[[join(repeat,'bin/s178-cli.mjs'),['run','release-brief']]]:[])]){
   const proc=spawnSync(process.execPath,[runner,...args,'--in',file,'--clock',clock],{cwd:dir,encoding:'utf8'});
   const result=JSON.parse(proc.stdout);assert.equal(result.ok,value===undefined);assert.equal(result.decision,value===undefined?'pass':'fail');
   if(value!==undefined)assert.ok(diagnostics(result.validation??result.error??result).some(d=>d.endsWith(`@/${key}`)));
  }
 }}finally{rmSync(dir,{recursive:true,force:true});}
});

test('family aggregate retains release input refusal',()=>{
 const dir=mkdtempSync(join(tmpdir(),'release-family-'));
 try{const input=aligned();input.sources[0].plane='bogus';const file=join(dir,'input.json');writeFileSync(file,JSON.stringify(input));
 const proc=spawnSync(process.execPath,[cli,'analyze','--all','--in',file,'--clock',clock],{cwd:dir,encoding:'utf8'});
 const result=JSON.parse(proc.stdout);assert.equal(result.ok,false);assert.notEqual(result.decision,'pass');
 const packet=result.packets.find(p=>p.artifactKind==='release-brief');assert.equal(packet.decision,'fail');assert.ok(diagnostics(packet.validation).includes('invalid_plane@/sources/0/plane'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
