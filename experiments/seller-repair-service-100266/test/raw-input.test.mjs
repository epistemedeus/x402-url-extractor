import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readInputText, MAX_RAW_INPUT_BYTES } from "../commercial/read-input.mjs";
test("raw stdin counts cumulative bytes and cleans listeners on refusal",async()=>{
 const stream=new PassThrough(), result=readInputText("-",{stream,maxBytes:32,deadlineMs:100});
 stream.write(Buffer.alloc(20));stream.write(Buffer.alloc(20));
 await assert.rejects(result,/input_too_large/);assert.equal(stream.listenerCount("data"),0);assert.equal(stream.listenerCount("end"),0);stream.destroy();
});
test("unclosed stdin has one intake deadline",async()=>{
 const stream=new PassThrough(), start=Date.now();
 await assert.rejects(readInputText("-",{stream,deadlineMs:30}),/input_deadline_exceeded/);
 assert.ok(Date.now()-start<500);assert.equal(stream.listenerCount("data"),0);stream.destroy();
});
test("bounded supplied stdin is read without a default task",async()=>{
 assert.equal(await readInputText("-",{stream:Readable.from([Buffer.from('{"taskId":'),Buffer.from('"supplied"}')])}),'{"taskId":"supplied"}');
});
test("raw regular file, oversize, symlink and directory remain distinct",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"caller-intake-"));
 try{const file=join(dir,"request.json");await writeFile(file,'{"taskId":"provided"}');
 assert.equal(await readInputText(file),'{"taskId":"provided"}');
 await assert.rejects(readInputText(dir),/input_not_regular_file/);
 await symlink(file,join(dir,"link"));await assert.rejects(readInputText(join(dir,"link")));
 await writeFile(file,Buffer.alloc(MAX_RAW_INPUT_BYTES+1));await assert.rejects(readInputText(file),/input_too_large/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("both caller entrypoints refuse oversized raw stdin before execution",()=>{
 for(const name of ["caller-deliver.mjs","commercial-path.mjs"]){
  const run=spawnSync(process.execPath,[new URL("../bin/"+name,import.meta.url).pathname,"deliver","--request","-"],{input:Buffer.alloc(MAX_RAW_INPUT_BYTES+1,32),encoding:"utf8",timeout:10000,maxBuffer:16384});
  assert.equal(run.status,2,run.stderr);assert.match(run.stderr,/input_too_large/);assert.equal(run.stdout,"");
 }
});
