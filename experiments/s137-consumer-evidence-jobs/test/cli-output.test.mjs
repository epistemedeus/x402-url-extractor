import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const cli=existsSync(join(root,'scripts/cli.mjs'))?join(root,'scripts/cli.mjs'):join(root,'bin/cli.mjs');
test('large piped release brief is complete JSON with a successful exit',()=>{
 const dir=mkdtempSync(join(tmpdir(),'consumer-output-'));
 try{
  const input={clock:'2026-09-10T18:00:00.000Z',evidenceClass:'synthetic',sources:[{id:'notes',kind:'release-notes',plane:'announced',path:'local-notes.json',identity:{role:'claimed',tag:'v1'},payload:{body:'release notes '.repeat(12000)}}]};
  const path=join(dir,'input.json');writeFileSync(path,JSON.stringify(input));
  const result=spawnSync(process.execPath,[cli,'analyze','release-brief','--in',path,'--clock',input.clock],{cwd:dir,encoding:'utf8',maxBuffer:8*1024*1024});
  assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.length>65536);
  const packet=JSON.parse(result.stdout);assert.equal(packet.ok,true);assert.equal(packet.decision,'partial');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
