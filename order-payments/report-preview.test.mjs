import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import { payOrder } from "./agent.mjs";
import { mountOrderPayments, SITE_ORIGINS } from "./http.mjs";
import { prepareRefund } from "./refund-admin.mjs";
import { previewChain } from "./preview-chain.mjs";

const neo = process.env.NEO_REPORT_PREVIEW_SOURCE, sds = process.env.SDS_PREVIEW_SOURCE;
const local = server => "http://127.0.0.1:" + server.address().port;
const load = (dir,file) => import(pathToFileURL(resolve(dir,file)));
test("a SameDayDesk report settles through the independent gateway client and its original Neomorphic delivery", {
  skip: !(neo && sds && process.env.HOUSE_TEST_PG_SOCKET?.startsWith("/"))
}, async t => {
  const {openStore,migrate} = await load(neo,"services/house/src/store.mjs");
  const {houseSigningKey} = await load(neo,"services/house/src/tabs.mjs");
  const {createApp} = await load(neo,"services/house/src/server.mjs");
  const {reportOrderRail} = await load(neo,"services/house/src/report-order-rail.mjs");
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
  const reports=reportOrderRail({live:false,linkId:"plink_report",stripe:{},token,admin});
  const house=createApp({pool,origin:SITE_ORIGINS.neo,enableIntake:true,deskPayments:{reportOrders:reports},
    signingKey:houseSigningKey(generateKeyPairSync("ed25519").privateKey,new Date())});
  async function listen(server) {
    server.listen(0,"127.0.0.1");await once(server,"listening");
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    return local(server);
  }
  const houseUrl=await listen(house);
  process.env.SDS_PRIVATE_PREVIEW="1";process.env.SDS_REPORT_ORDER_USDC="1";
  process.env.SDS_TEST_REPORT_ORDER_ENDPOINT=houseUrl+"/v1/desk/report-orders";
  const {createSdsApp}=await load(sds,"server/app.js");
  const site=createSdsApp({care:null}).listen(0,"127.0.0.1");await once(site,"listening");t.after(()=>new Promise(r=>site.close(r)));
  const entry=local(site)+"/api/checkout/seller-conformance";
  assert.match(await (await fetch(entry)).text(),/Pay with USDC on Base/);
  const body={order:randomUUID(),method:"base_usdc",publicOrigin:"https://example.com",getRoute:"/one",email:"buyer@example.test",authorized:true};
  const start=()=>fetch(entry+"/order",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());
  const [order,duplicate]=await Promise.all([start(),start()]);assert.deepEqual(order,duplicate);
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
  const res=await payOrder({resource:order.paymentUrl,amount:"490000000",account:payer,fetchImpl:transport});
  assert.equal(res.status,200);assert.equal((await res.json()).state,"paid");assert.equal(settlements,1);
  assert.equal((await pool.query("select 1 from house_intake where state='paid' and body#>>'{payment,receipt,payer}'=$1",[payer.address])).rowCount,1);
  const {originalPayment:q}=await prepareRefund({site:"neo",order:order.order,token:admin,client:publicClient,fetchImpl:owner});
  const transactionHash=mine({from:merchant,to:q.payer,value:q.amountAtomic},true);
  const canonical={schema:"pilot.merchant-refund.canonical.v1",role:"merchant_refund",site:"neo",order:q.order,operationId:q.operationId,
    originalPayment:q.original,network:q.network,token:q.token,source:q.merchant,recipient:q.payer,transactionHash,logIndex:0,
    amountAtomic:q.amountAtomic,status:"success",exactTransferVerified:true};
  await prepareRefund({site:"neo",order:order.order,token:admin,client:publicClient,fetchImpl:owner,canonical});
  const final=await (await transport(new Request(order.paymentUrl))).json();
  assert.equal(final.state,"refunded");assert.equal(final.receipt.refund.transaction,transactionHash);
  assert.equal((await pool.query("select 1 from house_desk_mail")).rowCount,1);
});
