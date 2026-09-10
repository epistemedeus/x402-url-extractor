// Installed-package regression; copied into test/ by the archive builder.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
test('Express first-use example remains announced-only, valid and partial',async()=>{
 const input=JSON.parse(readFileSync(join(root,'examples/release-brief/input.json')));
 const {validateReleaseBriefInput}=await import(pathToFileURL(join(root,'src/release-brief/schema.mjs')));
 const {buildReleaseBrief}=await import(pathToFileURL(join(root,'src/release-brief/transform.mjs')));
 assert.equal(validateReleaseBriefInput(input).ok,true);
 const result=buildReleaseBrief(input);assert.equal(result.ok,true);assert.equal(result.decision,'partial');
 assert.equal(result.brief.announced.items.length,1);assert.equal(result.brief.shipped.items.length,0);assert.equal(result.brief.tested.items.length,0);
});
test('documented family first-use command emits complete JSON and exits successfully',()=>{
 const result=spawnSync(process.execPath,['bin/cli.mjs','analyze','--all','--clock','2026-09-10T12:00:00.000Z','--in-root','examples'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stderr);const family=JSON.parse(result.stdout);
 assert.equal(family.ok,true);assert.equal(family.packets.length,6);
 const release=family.packets.find(p=>p.artifactKind==='release-brief');assert.equal(release.decision,'partial');
});
