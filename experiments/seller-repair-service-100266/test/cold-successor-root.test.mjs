import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exp=join(import.meta.dirname,"..");
const archive=join(exp,"candidate/seller-repair-external-consumer-0.4.1.tar.gz");
async function run(argv,cwd){
  return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,argv,{cwd,env:{PATH:process.env.PATH,HOME:cwd}});
    let out="",err=""; const timer=setTimeout(()=>p.kill("SIGKILL"),15000);
    p.stdout.on("data",b=>{out+=b;if(out.length>131072)p.kill("SIGKILL");});
    p.stderr.on("data",b=>{err+=b;if(err.length>16384)p.kill("SIGKILL");});
    p.once("error",reject);p.once("close",status=>{clearTimeout(timer);resolve({status,out,err});});p.stdin.end();
  });
}
test("0.4.1 stripped successor executes supplied tasks, useful negatives and later changed input",{timeout:60000},async()=>{
  const bytes=await readFile(archive);
  assert.equal(bytes.length,40891);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),"64dbe1ee7f69dd40ebf71741eed92f1f3f893c44af8eadf18b71c0fac82227b8");
  const dir=await mkdtemp(join(tmpdir(),"root-cold041-"));
  const tar=await new Promise((resolve,reject)=>{
    const p=spawn("tar",["-xzf",archive,"-C",dir]);p.once("error",reject);p.once("close",resolve);
  });assert.equal(tar,0);
  const cli=join(dir,"package/bin/caller-deliver.mjs");
  let hits=0;
  const server=createServer((req,res)=>{
    hits++;assert.equal(req.headers["payment-signature"],undefined);
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify(req.url==="/v1/gamma"?{note:"still-up"}:{status:"ready"}));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const baseUrl="http://127.0.0.1:"+server.address().port;
  const request=(name)=>({schema:"samedaydesk.seller-repair-caller-request.v1",callerId:"caller-"+name,
    task:"Check whether GET /v1/"+name+" returns the supplied status field.",origin:"https://widget.example",
    operation:"GET /v1/"+name,sdk:"node-https@22",runtime:"node/22.22.2",expect:{path:"status",value:"ready"},
    limits:{probes:4,bodyBytes:4096,deadlineMs:1000,totalBodyBytes:16384,totalResponseMs:4000,redirects:0,outputBytes:65536},
    question:"useful_output",paidIntent:false,probeConsent:{class:"loopback",confirmed:true,baseUrl}});
  try{
    for(const name of ["alpha","beta","gamma"]){
      const file=join(dir,name+".json");await writeFile(file,JSON.stringify(request(name)));
      const r=await run([cli,"deliver","--request",file,"--out",join(dir,name)],dir);
      assert.equal(r.status,0,r.err||r.out);const body=JSON.parse(r.out);
      assert.equal(body.operationId,"GET /v1/"+name);
      assert.equal(body.classification.useful,name!=="gamma");
      assert.equal(body.paymentSent,false);assert.equal(body.fixtureTransport,false);
      if(name==="gamma")assert.equal(body.classification.reason,"missing_field_not_paid_demand");
    }
    assert.ok(hits>=3);
    const changed={...request("gamma"),callerId:"caller-alpha"};
    await writeFile(join(dir,"later.json"),JSON.stringify(changed));
    const later=await run([cli,"later","--artifact",join(dir,"alpha/regression.json"),"--caller",join(dir,"later.json")],dir);
    assert.equal(later.status,0,later.err||later.out);const lb=JSON.parse(later.out);
    assert.equal(lb.executed,true);assert.equal(lb.predicateApplies,false);
    assert.equal(lb.reason,"stale_applicability");assert.equal(lb.receipt.classification.useful,false);
    for(const [name,decision] of [["method-gedx402-3511","mismatch"],["method-operator-3657","compatible"]]){
      const input=await readFile(join(exp,"cases",name+".json"));const file=join(dir,name+".json");
      await writeFile(file,input);const r=await run([cli,"deliver","--request",file],dir);
      assert.equal(r.status,0,r.err||r.out);const b=JSON.parse(r.out);
      assert.equal(b.methodCompatibility.decision,decision);
      assert.equal(b.methodCompatibility.independentlyExecuted,false);
      assert.equal(b.methodCompatibility.safeToPay,false);assert.equal(b.paymentSent,false);
    }
    const absent=await run([cli,"deliver"],dir);
    assert.equal(absent.status,2);assert.equal(JSON.parse(absent.out).executed,false);
  } finally {
    server.closeAllConnections();await new Promise(r=>server.close(r));
    await rm(dir,{recursive:true,force:true});
  }
});
