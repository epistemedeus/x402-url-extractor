import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { resolve, extname, sep } from "node:path";
import {readFile} from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { previewWalletBrowser,payWithPreviewWallet } from "./preview-wallet.mjs";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import { payOrder } from "./agent.mjs";
import { mountOrderPayments, SITE_ORIGINS } from "./http.mjs";
import { prepareRefund } from "./refund-admin.mjs";
import { previewChain } from "./preview-chain.mjs";

const neo = process.env.NEO_REPORT_PREVIEW_SOURCE, sds = process.env.SDS_PREVIEW_SOURCE;
const local = server => "http://127.0.0.1:" + server.address().port;
const load = (dir,file) => import(pathToFileURL(resolve(dir,file)));
test("Neomorphic mounted subscription month, repair, owner QA and refunds", {skip:!(neo && process.env.HOUSE_TEST_PG_SOCKET?.startsWith("/"))},async t=>{
  const {openStore,migrate} = await load(neo,"services/house/src/store.mjs");
  const {houseSigningKey} = await load(neo,"services/house/src/tabs.mjs");
  const {createApp} = await load(neo,"services/house/src/server.mjs");
  const {createDeskPayments} = await load(neo,"services/house/src/desk-payments.mjs");
  const config={host:process.env.HOUSE_TEST_PG_SOCKET,port:process.env.HOUSE_TEST_PG_PORT,database:"house_test"};
  const adminDb=openStore(config),schema="test_"+randomUUID().replaceAll("-","");
  await adminDb.query("create schema "+schema);
  const pool=openStore({...config,options:"-c search_path="+schema});
  t.after(async()=>{await pool.end();await adminDb.query("drop schema "+schema+" cascade");await adminDb.end();});
  await migrate(pool);
  const token=randomBytes(32).toString("hex"), admin=randomBytes(32).toString("hex");
  const {publicClient,mine}=previewChain();
  const merchant="0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
  const payer=privateKeyToAccount("0x"+"2".repeat(64)); // valueless deterministic fixture

  const {signedHeaders,agentKeyFor}=await load(neo,"services/house/src/request-signature.mjs");
  const key=generateKeyPairSync("ed25519"),origin=SITE_ORIGINS.neo;
  let now=new Date(),cardCreates=0;
  const desk=createDeskPayments({live:false,site:"https://neomorphic.io",stripe:{
    create:async fields=>{cardCreates++;return {id:"cs_fixture",livemode:false,mode:"subscription",currency:"usd",amount_total:10000,
      client_reference_id:fields.client_reference_id,metadata:{neomorphic_desk_order:fields.client_reference_id},status:"open",url:"https://checkout.stripe.com/example"};}
  },secret:token,webhookSecret:"whsec_synthetic_fixture",reportPaymentLink:"plink_report",publicOrderUsdc:true,orderTokens:{token,admin}});
  const house=createApp({pool,origin,enableIntake:true,deskPayments:desk,ownerKey:agentKeyFor(key.publicKey),
    signingKey:houseSigningKey(key.privateKey,new Date()),now:()=>now});
  async function listen(server) {
    server.listen(0,"127.0.0.1");await once(server,"listening");
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    return local(server);
  }
  const houseUrl=await listen(house);
  const owner=(url,init)=>{assert.equal(new URL(url).origin,SITE_ORIGINS.neo);return fetch(houseUrl+new URL(url).pathname,init);};
  let settlements=0;
  const app=express();mountOrderPayments(app,{merchant,network:"eip155:8453",env:{ORDER_PAYMENTS_NEO_TOKEN:token,MPP_SECRET_KEY:token},
    client:publicClient,fetchImpl:owner,facilitator:{verify:async()=>({isValid:true}),settle:async p=>{
      settlements++;return {success:true,network:"eip155:8453",transaction:mine(p.payload.authorization)};
    }}});
  const gateway=app.listen(0,"127.0.0.1");await once(gateway,"listening");t.after(()=>new Promise(r=>gateway.close(r)));
  const transport=async req=>{
    const raw=await fetch(local(gateway)+new URL(req.url).pathname,{headers:req.headers,redirect:"error"});
    const response=new Response(raw.body,{status:raw.status,headers:raw.headers});Object.defineProperty(response,"url",{value:req.url});return response;
  };

  async function site(path,body,options={}) {
    const method=body===undefined ? "GET":"POST",bytes=Buffer.from(body===undefined ? "" : JSON.stringify(body));
    const headers=options.signed ? signedHeaders({url:origin+path,method,body:bytes,privateKey:key.privateKey,
      idempotencyKey:body===undefined ? undefined : "preview-"+randomUUID(),now:now.getTime()}) :
      {"content-type":"application/json",...(options.grant && {authorization:"Bearer "+options.grant})};
    const r=await fetch(houseUrl+path,{method,headers,...(body!==undefined && {body:bytes})});
    const data=await r.json();
    if(options.status) assert.equal(r.status,options.status,path+" "+data.error);
    return {status:r.status,value:data.result};
  }
  async function pay(r,cents) {
    const res=await payOrder({resource:r.paymentUrl,amount:String(BigInt(cents)*10000n),account:payer,fetchImpl:transport});
    const result=await res.json();assert.equal(res.status,200,JSON.stringify(result));assert.equal(result.state,"paid");return result;
  }
  async function reverse(paid) {
    const opts={site:"neo",order:paid.order,token:admin,client:publicClient,fetchImpl:owner};
    const {originalPayment:q}=await prepareRefund(opts);
    assert.equal(q.payer,payer.address);
    const transactionHash=mine({from:merchant,to:q.payer,value:q.amountAtomic},true);
    const canonical={schema:"pilot.merchant-refund.canonical.v1",role:"merchant_refund",site:"neo",order:q.order,operationId:q.operationId,
      originalPayment:q.original,network:q.network,token:q.token,source:q.merchant,recipient:q.payer,transactionHash,logIndex:0,
      amountAtomic:q.amountAtomic,status:"success",exactTransferVerified:true};
    await prepareRefund({...opts,canonical});await prepareRefund({...opts,canonical});
    const final=await(await transport(new Request(q.resource))).json();assert.equal(final.state,"refunded");return final;
  }
  const subPath="/v1/desk/subscriptions", monthly={order:randomUUID(),access:randomUUID(),method:"base_usdc",email:"buyer@example.test"};
  const opened=(await site(subPath,monthly,{status:201})).value;
  assert.deepEqual((await site(subPath,monthly,{status:201})).value,opened);
  await site(subPath,{order:monthly.order},{status:409});
  await site(subPath,{...monthly,access:randomUUID()},{status:409});
  const paid=await pay(opened,10000);
  const grant=new URLSearchParams(new URL(opened.receipt).hash.slice(1)).get("grant");
  const invoicePath=subPath+"/"+monthly.order+"/invoice";
  const original=await site(invoicePath,{},{grant,status:201});
  assert.equal(original.value.paymentReference,opened.paymentReference);
  const receipt=await site(subPath+"/"+monthly.order,undefined,{grant,status:200});
  assert.equal(receipt.value.paidThrough,opened.period.end);
  const real=now;
  now=new Date(opened.period.end);
  const renewals=await Promise.all([site(invoicePath,{},{grant,status:201}),site(invoicePath,{},{grant,status:201})]);
  assert.deepEqual(renewals[0].value,renewals[1].value);assert.notEqual(renewals[0].value.paymentReference,opened.paymentReference);
  assert.equal(renewals[0].value.period.start,opened.period.end);
  assert.equal(settlements,1);assert.equal(cardCreates,0);
  now=real;
  await reverse(paid);
  const race={...monthly,order:randomUUID(),access:randomUUID()};
  const contested=await Promise.all([site(subPath,race),site(subPath,{order:race.order})]);
  assert.deepEqual(contested.map(x=>x.status).sort(),[201,409]);
  const selected=(await pool.query("select * from house_desk_subscriptions where id=$1",[race.order])).rows[0];
  assert.equal(Boolean(selected.session_id),selected.checkout_rail==="stripe");
  assert.equal(Object.keys(selected.usdc_invoices).length,selected.checkout_rail==="usdc" ? 1 : 0);
  const repair=randomUUID(), intake="quote_"+randomUUID();
  await pool.query("insert into house_intake(id,lane,state,body,created_at) values ($1,'quote','quoted',$2,$3)",[intake,{request:{email:monthly.email}},now]);
  await pool.query(`insert into house_desk_repair_links(id,intake_id,recorded_at,live_mode,amount_cents,scope,acceptance_test,terms_digest,payment_link,payment_url)
    values ($1,$2,$3,false,17500,'Repair original workflow','Run original acceptance','original_digest','plink_fixture','https://buy.stripe.com/test_fixture')`,[repair,intake,now]);
  const repairPath="/v1/desk/repair-payments/"+repair;
  const rr=await site(repairPath,{method:"base_usdc"},{status:201});
  await site(repairPath,{method:"card"},{status:409});
  const repaired=await pay(rr.value,17500);
  assert.equal((await pool.query("select state from house_intake where id=$1",[intake])).rows[0].state,"paid");
  await reverse(repaired);
  assert.equal((await pool.query("select state from house_intake where id=$1",[intake])).rows[0].state,"refunded");
  const qa={order:randomUUID(),access:randomUUID(),email:"qa@example.test"},qaPath="/v1/operator/desk/usdc-qa";
  await site(qaPath,qa,{status:401});
  const qs=await site(qaPath,qa,{signed:true,status:201});
  assert.equal(qs.value.classification,"owner_qa");assert.equal(qs.value.agent,qs.value.paymentUrl);
  assert.equal(qs.value.wallet,qs.value.agent+"/wallet");assert.match(qs.value.version,/^[a-f0-9]{64}$/);
  const qp=await pay(qs.value,1);assert.equal(qp.classification,"owner_qa");
  await reverse(qp);
  const recv=await site(qaPath+"/"+qa.order,undefined,{signed:true,status:200});
  assert.equal(recv.value.siteRoundTripRecorded,true);assert.equal(recv.value.customerRevenue,false);
  const walletId={order:randomUUID(),access:randomUUID(),email:"wallet@example.test"};
  const qw=(await site(qaPath,walletId,{signed:true,status:201})).value;
  const browser=await previewWalletBrowser(t);
  await payWithPreviewWallet(browser,qw,payer,merchant,transport);
  const wp=await(await transport(new Request(qw.agent))).json();await reverse(wp);
  assert.equal((await site(qaPath+"/"+walletId.order,undefined,{signed:true,status:200})).value.siteRoundTripRecorded,true);
  assert.equal(settlements,4);
  const staticRoot=resolve(neo,"dist"),siteOrigin="https://neomorphic.io";
  const contentType={".js":"text/javascript",".css":"text/css",".html":"text/html",".json":"application/json",".svg":"image/svg+xml",".woff2":"font/woff2"};
  const browserCalls=[];
  async function pageFor(path){
    const page=await browser.newPage();await page.setRequestInterception(true);
    page.on("request",async req=>{
      try{
        const target=new URL(req.url());
        if(target.origin===siteOrigin){
          const file=resolve(staticRoot,"."+target.pathname+(target.pathname.endsWith("/")?"index.html":""));
          assert.ok(file.startsWith(staticRoot+sep));
          const bytes=await readFile(file);
          return await req.respond({status:200,contentType:contentType[extname(file)] || "application/octet-stream",body:bytes});
        }
        if(target.origin===SITE_ORIGINS.neo){
          const result=await fetch(houseUrl+target.pathname,{method:req.method(),headers:req.headers(),
            ...(req.postData() && {body:req.postData()})});
          if(target.origin===SITE_ORIGINS.neo) browserCalls.push([req.method(),target.pathname,result.status,(await result.clone().json().catch(()=>({}))).error]);
          return await req.respond({status:result.status,headers:Object.fromEntries(result.headers),body:Buffer.from(await result.arrayBuffer())});
        }
        if(target.origin==="https://agents.samedaydesk.com"){
          const result=await transport(new Request(req.url(),{headers:req.headers()}));
          return await req.respond({status:result.status,headers:Object.fromEntries(result.headers),body:Buffer.from(await result.arrayBuffer())});
        }
        return await req.abort();
      }catch {if(!req.isInterceptResolutionHandled())await req.abort();}
    });
    await page.goto(siteOrigin+path,{waitUntil:"domcontentloaded"});return page;
  }
  const deskPage=await pageFor("/desk/subscribe/");
  await deskPage.waitForSelector("[data-usdc]:not([hidden])");
  assert.equal(await deskPage.$eval("[data-buy]",b=>b.hidden),false);
  await deskPage.type("[data-email]","human@example.test");
  await Promise.all([deskPage.waitForNavigation(),deskPage.click("[data-wallet]")]);
  assert.match(deskPage.url(),/^https:\/\/agents\.samedaydesk\.com\/order-payments\/neo\/[a-f0-9-]{36}\/wallet$/);
  await deskPage.close();
  const reportPage=await pageFor("/services/seller-conformance/fixed-scope/?finding=checkout");
  await reportPage.waitForSelector("[data-report-usdc]:not([hidden])");
  await reportPage.click("[data-report-usdc] summary");await reportPage.type("[name=email]","human@example.test");
  await reportPage.type("[name=publicOrigin]","https://example.com");await reportPage.type("[name=getRoute]","/catalog");
  await reportPage.click("[name=authorized]");
  await Promise.all([reportPage.waitForNavigation({timeout:8000}),reportPage.click("[data-report-usdc] button[type=submit]")]).catch(async e=>{
    throw Error(e.message+" "+JSON.stringify(browserCalls)+" "+await reportPage.$eval("[data-report-usdc] [role=status]",el=>el.textContent));
  });
  const reportResource=reportPage.url().replace(/\/wallet$/,"");
  const reportPaid=await pay({paymentUrl:reportResource},49000);
  const attached=await pool.query("select * from house_report_orders where order_id=$1",[reportPaid.order]);
  assert.equal(attached.rows[0].checkout_details.finding,"checkout");assert.equal(attached.rows[0].state,"paid");
  await reverse(reportPaid);await reportPage.close();
  assert.equal(settlements,5);
});
