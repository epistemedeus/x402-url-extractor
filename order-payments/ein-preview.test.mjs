import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import { payOrder } from "./agent.mjs";
import { mountOrderPayments, SITE_ORIGINS } from "./http.mjs";
import { prepareRefund } from "./refund-admin.mjs";
import { previewChain } from "./preview-chain.mjs";
import { createCommerceTrust } from "../commerce-trust.mjs";

const root=process.env.EIN_PREVIEW_SOURCE, project="demo-ein-order-rail";
const local=server=>"http://127.0.0.1:"+server.address().port;
test("emitted EIN filing, pre-claim agent payment and original verified human fulfillment",{
  skip:!root || process.env.FIRESTORE_EMULATOR_HOST!=="127.0.0.1:58393",timeout:110000
},async t=>{
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,"127.0.0.1:59393");
  const require=createRequire(resolve(root,"artifacts/api-server/package.json"));
  const admin=require("firebase-admin"),{getFirestore}=require("firebase-admin/firestore");
  const account={project_id:project,client_email:"firebase-adminsdk@"+project+".iam.gserviceaccount.com",
    private_key:generateKeyPairSync("rsa",{modulusLength:2048,privateKeyEncoding:{type:"pkcs8",format:"pem"}}).privateKey};
  const access=admin.initializeApp({projectId:project,credential:admin.credential.cert(account)},"fixture");
  const db=getFirestore(access,"ein-llc-e");t.after(async()=>{await db.terminate();await access.delete();});
  const ownerUid="preview-owner", email="preview@example.test";
  await access.auth().createUser({uid:ownerUid,email,emailVerified:true});
  const custom=await access.auth().createCustomToken(ownerUid);
  const login=await fetch("http://"+process.env.FIREBASE_AUTH_EMULATOR_HOST+"/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fixture",
    {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:custom,returnSecureToken:true})});
  const identity=(await login.json()).idToken;assert.ok(identity);
  const portProbe=createServer().listen(0,"127.0.0.1");await once(portProbe,"listening");const port=portProbe.address().port;
  await new Promise(r=>portProbe.close(r));
  const token=randomBytes(36).toString("hex"), refund=randomBytes(36).toString("hex");
  const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:"test",PORT:String(port),PUBLIC_URL:SITE_ORIGINS.ein,
    GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_SERVICE_ACCOUNT_KEY:JSON.stringify(account),FIREBASE_FIRESTORE_DATABASE_ID:"ein-llc-e",
    FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST,FIREBASE_AUTH_EMULATOR_HOST:process.env.FIREBASE_AUTH_EMULATOR_HOST,
    JWT_SECRET:randomBytes(32).toString("hex"),STRIPE_SECRET_KEY:"sk_test_isolated_fixture",EIN_ONLY_CHECKOUT:"1",EIN_ANNUAL_REPORT_CHECKOUT:"1",
    ALLOW_STRIPE_API_OVERRIDE:"1",STRIPE_API_HOST:"127.0.0.1",STRIPE_API_PORT:"9",STRIPE_API_PROTOCOL:"http",LOG_LEVEL:"error",
    EIN_ORDER_USDC:"1",ORDER_PAYMENTS_EIN_TOKEN:token,ORDER_PAYMENTS_EIN_REFUND_ADMIN:refund,ADMIN_UID:ownerUid};
  const server=spawn(process.execPath,["app.mjs"],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
  let logs="";server.stdout.on("data",c=>logs=(logs+c).slice(-1800));server.stderr.on("data",c=>logs=(logs+c).slice(-1800));
  const exited=once(server,"exit");t.after(async()=>{if(server.exitCode===null && !server.signalCode)server.kill("SIGKILL");await exited;});
  const base="http://127.0.0.1:"+port;
  for(let i=0;i<100;i++) {
    if(server.exitCode!==null)throw Error("EIN entry exited "+server.exitCode+" "+logs.replace(/[\r\n]/g," ").slice(-700));
    if(await fetch(base+"/api/healthz").then(r=>r.ok,()=>false))break;
    await pause(100);
  }
  async function api(path,body,code=200,authorized=true,method="POST") {
    const r=await fetch(base+"/api"+path,{signal:AbortSignal.timeout(30000),method,headers:{"content-type":"application/json",...(authorized && {authorization:"Bearer "+identity})},
      ...(body!==undefined && {body:JSON.stringify(body)})});
    const out=await r.json();assert.equal(r.status,code,path+" "+JSON.stringify({error:out.error,code:out.code}));return out;
  }
  const {publicClient,mine}=previewChain(), payer=privateKeyToAccount("0x"+"5".repeat(64));
  const merchant="0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
  const trust=createCommerceTrust({privateKey:"0x"+"3".repeat(64),network:"eip155:8453"});
  const toSite=(url,init)=>{assert.equal(new URL(url).origin,SITE_ORIGINS.ein);return fetch(base+new URL(url).pathname,init);};
  let settles=0;
  const app=express();mountOrderPayments(app,{merchant,trust,network:"eip155:8453",client:publicClient,fetchImpl:toSite,
    env:{ORDER_PAYMENTS_EIN_TOKEN:token,MPP_SECRET_KEY:token},facilitator:{verify:async()=>({isValid:true}),
      settle:async p=>{settles++;return {success:true,network:"eip155:8453",transaction:mine(p.payload.authorization)};}}});
  const gateway=app.listen(0,"127.0.0.1");await once(gateway,"listening");t.after(()=>new Promise(r=>gateway.close(r)));
  const send=async req=>{const r=await fetch(local(gateway)+new URL(req.url).pathname,{headers:req.headers,redirect:"error"});
    const out=new Response(r.body,{status:r.status,headers:r.headers});Object.defineProperty(out,"url",{value:req.url});return out;};
  const pay=async(resource,cents)=>{const r=await payOrder({resource,amount:String(BigInt(cents)*10000n),account:payer,fetchImpl:send});
    const out=await r.json();assert.equal(r.status,200,JSON.stringify(out));assert.equal(out.state,"paid");return out;};
  const reverse=async paid=>{
    const args={order:paid.order,site:"ein",token:refund,client:publicClient,fetchImpl:toSite};
    const {originalPayment:q}=await prepareRefund(args);assert.equal(q.payer,payer.address);
    const hash=mine({from:merchant,to:payer.address,value:q.amountAtomic},true);
    const canonical={schema:"pilot.merchant-refund.canonical.v1",role:"merchant_refund",order:q.order,site:q.site,operationId:q.operationId,
      originalPayment:q.original,network:q.network,token:q.token,source:q.merchant,recipient:q.payer,amountAtomic:q.amountAtomic,
      status:"success",exactTransferVerified:true,logIndex:0,transactionHash:hash};
    await prepareRefund({...args,canonical});await prepareRefund({...args,canonical});
    const after=await (await send(new Request(q.resource))).json();assert.equal(after.state,"refunded");assert.equal(after.receipt.refund.transaction,hash);
  };
  for(const product of ["ein-only","annual-report"]) {
    const quote=await api("/filings/quote",{product,requestId:randomUUID(),companyName:"Preview Company",state:"Wyoming",
      signerName:"Preview Owner",mailingAddress:"Preview fixture address",detailsConfirmed:true,
      ...(product==="ein-only"?{formedOn:"2026-01-10",activity:"Software",reason:"started_business"}:{stateFileNumber:"123456789",wyomingAssetsCents:0})});
    const start=()=>api("/filings/"+quote.id+"/checkout",{method:"base_usdc"});
    const [a,b]=await Promise.all([start(),start()]);assert.deepEqual(a,b);
    await api("/filings/"+quote.id+"/checkout",{},409);
    const paid=await pay(a.paymentUrl,quote.price.totalCents);
    assert.equal((await db.collection("filing_orders").doc(quote.id).get()).data().status,"paid");
    await reverse(paid);
    assert.equal((await db.collection("filing_orders").doc(quote.id).get()).data().refundedCents,quote.price.totalCents);
  }
  const spec = await api("/agent/v1/openapi.json", undefined, 200, false, "GET");
  assert.equal(spec.paths["/api/agent/v1/applications/{applicationId}/payment"].post.operationId,"openApplicationPayment");
  const facts={goal:"Accept payments",hasUsEntity:"no",hasEin:"no",providerRequiresUsEntity:"yes",providerRequiresEin:"yes",selectedState:"Wyoming",intendedEmail:email};
  const assessed=await api("/agent/v1/assessments",facts,200,false);
  const prepared=await api("/agent/v1/applications",{assessmentId:assessed.assessmentId,intendedEmail:email,operationId:randomUUID(),
    preparation:{goal:facts.goal,existingEntityStatus:"none",jurisdiction:"Wyoming"}},201,false);
  const id=prepared.applicationId,prefix="/agent/v1/applications/"+id;
  await api(prefix+"/payment",{claimToken:"wrong"},404,false);
  const opened=await api(prefix+"/payment",{claimToken:prepared.claimToken},201,false);
  assert.equal(opened.filingAuthorization,false);
  const paid=await pay(opened.paymentUrl,opened.cents);
  const original=db.collection("applications").doc(id);
  const waiting=(await original.get()).data();assert.equal(waiting.uid,null);assert.equal(waiting.status,"provisional");
  assert.equal((await db.collection("orders").get()).size,0);
  await api(prefix+"/claim",{claimToken:prepared.claimToken});
  const intake={applicationId:id,fullName:"Preview Owner",dateOfBirth:"1990-01-01",nationality:"Example",passportNumber:"fixture-id",
    address:{country:"Example",city:"Example",street:"1 Sample Street",postalCode:"00000"},companyName:"Owned Preview",entityType:"LLC",
    stateOfIncorporation:"Wyoming",businessDescription:"Software",email,phone:"5550100",phoneDialCode:"+1",documentUrl:"https://example.test/fake"};
  await api("/checkout/intake",intake,200,true,"PUT");
  const completed=await api("/checkout/prepare-quote",{applicationId:id});
  assert.equal(completed.prepaidReceived,true);assert.equal((await db.collection("orders").get()).size,1);
  assert.equal((await original.get()).data().status,"paid");
  await api("/checkout/create-session",{applicationId:id},409);
  await reverse(paid);
  assert.equal((await db.collection("orders").get()).docs[0].data().status,"refunded");
  assert.equal(settles,3);
  await db.collection("drafts").doc(ownerUid).set({...intake,applicationId:null,stateOfIncorporation:"Delaware"});
  const human = await api("/checkout/usdc",{},201);
  const humanOrder = (await db.collection("applications").where("usdc.id","==",human.order).get()).docs[0];
  assert.equal(humanOrder.data().uid, ownerUid);
  assert.equal(humanOrder.data().quote.totalCents,human.cents);
  assert.equal(humanOrder.data().quote.state,"Delaware");
  await api("/checkout/create-session",{applicationId:humanOrder.id},409);
  const humanPaid=await pay(human.paymentUrl,human.cents);
  assert.equal((await humanOrder.ref.get()).data().status,"paid");
  assert.equal((await db.collection("orders").get()).size,2);
  await reverse(humanPaid);
  assert.equal(settles,4);
  const qaId=randomUUID();
  async function cli(mode) {
    const child=spawn(process.execPath,[join(root,"artifacts/api-server/dist/owner-usdc-qa.mjs"),mode,qaId],{cwd:root,env,
      stdio:["ignore","pipe","pipe"]});let output="";child.stdout.on("data",c=>output+=c);child.stderr.resume();
    const [code]=await once(child,"exit");assert.equal(code,0);return JSON.parse(output.trim().split("\n").at(-1));
  }
  const qa=await cli("--create");assert.deepEqual(await cli("--create"),qa);const marked=await pay(qa.agent,qa.cents);
  assert.equal(marked.classification,"owner_qa");await reverse(marked);
  const received=await cli("--receive");assert.equal(received.siteRoundTripRecorded,true);assert.equal(received.customerRevenue,false);
});
