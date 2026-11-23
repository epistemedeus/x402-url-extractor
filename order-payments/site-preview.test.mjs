import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createCommerceTrust } from "../commerce-trust.mjs";
import { once } from "node:events";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mountOrderPayments, SITE_ORIGINS } from "./http.mjs";
import { payOrder } from "./agent.mjs";
import { prepareRefund } from "./refund-admin.mjs";
import { previewChain } from "./preview-chain.mjs";
import { BASE_USDC } from "../settlement-proof.mjs";

const siteRoot = process.env.SDS_PREVIEW_SOURCE;
const enrolled = siteRoot && process.env.SDS_PRIVATE_PREVIEW === "1";
const merchant = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const payer = privateKeyToAccount("0x" + "2".repeat(64)); // public deterministic fixture
const origin = server => "http://127.0.0.1:" + server.address().port;

test("SDS wallet and independent agent use the gateway and existing PostgreSQL receipt through refund", { skip: !enrolled }, async t => {
  const { default: pg } = await import(pathToFileURL(createRequire(resolve(siteRoot, "package.json")).resolve("pg")));
  const load = p => import(pathToFileURL(resolve(siteRoot, p)));
  const { createSdsApp } = await load("server/app.js");
  const { openCareStore } = await load("server/lib/care-store.js");
  const { createCareService } = await load("server/lib/care-service.js");
  const { createOwnedOrder,receiveOwnedOrder } = await load("server/scripts/care-usdc-qa.mjs");
  const { careTable } = await load("server/lib/care-database.js");
  const store = openCareStore(), pool = new pg.Pool({ connectionString: process.env.SDS_CARE_DATABASE_URL });
  t.after(async () => { await store.close(); await pool.end(); });
  const token = randomBytes(36).toString("hex"), admin = randomBytes(36).toString("hex");
  process.env.ORDER_PAYMENTS_SDS_TOKEN = token;
  process.env.ORDER_PAYMENTS_SDS_REFUND_ADMIN = admin;
  const stripe = {};
  const care = createCareService({ store, stripe, live: false, secret: token, origin: SITE_ORIGINS.sds, orderPayments: true });
  const site = createSdsApp({ care }).listen(0, "127.0.0.1");
  await once(site, "listening"); t.after(() => new Promise(r => site.close(r)));
  let settles = 0;
  const { publicClient, mine } = previewChain();
  const toSite = (url, init) => {
    assert.equal(new URL(url).origin, SITE_ORIGINS.sds);
    return fetch(origin(site) + new URL(url).pathname, init);
  };
  const app = express();
  const trust=createCommerceTrust({privateKey:"0x"+"3".repeat(64),network:"eip155:8453"});
  mountOrderPayments(app, { merchant, trust, network: "eip155:8453", env: { ORDER_PAYMENTS_SDS_TOKEN: token, MPP_SECRET_KEY: token },
    client: publicClient, fetchImpl: toSite, facilitator: { verify: async () => ({ isValid: true }), settle: async payload => {
      settles++; return { success: true, network: "eip155:8453", transaction: mine(payload.payload.authorization) };
    } } });
  const gateway = app.listen(0, "127.0.0.1");
  await once(gateway, "listening"); t.after(() => new Promise(r => gateway.close(r)));
  const toGateway = async req => {
    const res = await fetch(origin(gateway) + new URL(req.url).pathname, { headers: req.headers, redirect: "error" });
    // The preview socket is loopback. Expose the public request origin to the independent client.
    const response = new Response(res.body, { status: res.status, headers: res.headers });
    Object.defineProperty(response, "url", { value: req.url });
    return response;
  };
  const { default: puppeteer } = await import(pathToFileURL(createRequire(resolve(process.env.PREVIEW_RELEASE_KIT, "package.json")).resolve("puppeteer-core")));
  const browser = await puppeteer.launch({ executablePath: process.env.RELEASE_CHROME || "/usr/bin/google-chrome",
    headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--disable-background-networking"] });
  t.after(() => browser.close());
  for (const mode of ["wallet", "agent"]) {
    const id = randomUUID();
    const qa = await createOwnedOrder(pool, process.env.SDS_CARE_SCHEMA, { id, cents: 1, email: "owner@example.test", live: false, origin: SITE_ORIGINS.sds });
    if (mode === "wallet") {
      const page = await browser.newPage();
      let signs = 0;
      await page.exposeFunction("fixtureRpc", async ({ method, params }) => {
        if (["eth_requestAccounts","eth_accounts"].includes(method)) return [payer.address];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_signTypedData_v4") {
          signs++; const typed = JSON.parse(params[1]); assert.equal(typed.message.value, "10000"); assert.equal(typed.message.to.toLowerCase(), merchant.toLowerCase());
          const signature = await payer.signTypedData(typed);
          assert.equal(await recoverTypedDataAddress({ ...typed, signature }), payer.address); return signature;
        }
        throw Error("unexpected fixture wallet method " + method);
      });
      await page.evaluateOnNewDocument(() => { window.ethereum = { request: arg => window.fixtureRpc(arg) }; });
      await page.setRequestInterception(true);
      page.on("request", async request => {
        if (new URL(request.url()).origin !== "https://agents.samedaydesk.com") return request.abort();
        const response = await toGateway(new Request(request.url(), { headers: request.headers() }));
        await request.respond({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      });
      await page.goto(qa.wallet);
      await page.waitForSelector("#pay:not([hidden])", { timeout: 10000 });
      await page.click("#pay");
      await page.waitForFunction(() => document.querySelector("#state").textContent.startsWith("Paid."), { timeout: 10000 });
      assert.equal(signs, 1); await page.close();
    } else {
      const res = await payOrder({ resource: qa.agent, amount: "10000", account: payer, fetchImpl: toGateway });
      assert.equal(res.status, 200); assert.equal((await res.json()).receipt.payer, payer.address);
    }
    const r = await prepareRefund({ order: qa.paymentReference, site: "sds", token: admin, client: publicClient, fetchImpl: toSite });
    assert.equal(r.action,"reserved_for_controller"); assert.equal(r.originalPayment.payer,payer.address);
    assert.equal(r.originalPayment.amountAtomic,"10000");
    const retry = await prepareRefund({ order: qa.paymentReference, site: "sds", token: admin, client: publicClient, fetchImpl: toSite });
    assert.equal(retry.action, "read_status_only");
    assert.equal((await (await toGateway(new Request(qa.agent))).json()).state,"refund_pending");
    const q=r.originalPayment;
    const transactionHash=mine({from:q.merchant,to:q.payer,value:q.amountAtomic},true);
    const canonical={ schema:"pilot.merchant-refund.canonical.v1",role:"merchant_refund",site:"sds",order:q.order,
      operationId:q.operationId,originalPayment:q.original,network:q.network,token:q.token,source:q.merchant,recipient:q.payer,
      amountAtomic:q.amountAtomic,status:"success",exactTransferVerified:true,logIndex:0,transactionHash };
    await assert.rejects(prepareRefund({order:q.order,site:"sds",token:admin,client:publicClient,fetchImpl:toSite,canonical:{...canonical,recipient:merchant}}));
    const bind=()=>prepareRefund({order:q.order,site:"sds",token:admin,client:publicClient,fetchImpl:toSite,canonical});
    assert.equal((await bind()).action,"read_original_order");
    assert.equal((await bind()).action,"read_original_order");
    const final = await (await toGateway(new Request(qa.agent))).json();
    assert.equal(final.state, "refunded");
    assert.equal(final.receipt.refund.recipient, payer.address);
    assert.notEqual(final.receipt.transaction, final.receipt.refund.transaction);
    assert.equal((await store.order(id)).refunded_cents, 1);
    const events = await pool.query(`select event,test from ${careTable("journey_events")} where order_id=$1`, [id]);
    assert.deepEqual(events.rows.map(r => r.event).sort(), ["checkout_started","payment_refunded","payment_verified"]);
    assert.ok(events.rows.every(r => r.test));
    if (receiveOwnedOrder) {
      const siteReceipt=await receiveOwnedOrder(pool,process.env.SDS_CARE_SCHEMA,id);
      assert.equal(siteReceipt.siteRoundTripRecorded,true);assert.equal(siteReceipt.customerRevenue,false);
      assert.equal(siteReceipt.original,final.receipt.transaction);assert.equal(siteReceipt.refund,transactionHash);
      assert.equal(siteReceipt.receiptRows,1);assert.equal(siteReceipt.receiptAccepted,false);
    }
  }
  assert.equal(settles, 2);
  if (process.env.OWNER_ORDER_PREVIEW_SOURCE) {
    const { runOwnerOrder } = await import(pathToFileURL(resolve(process.env.OWNER_ORDER_PREVIEW_SOURCE,"tools/payment-rail/self-test/owner-order.mjs")));
    const dir=await mkdtemp(resolve(tmpdir(),"owner-order-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
    for(const loseResponse of [false,true]) {
      const input=await createOwnedOrder(pool,process.env.SDS_CARE_SCHEMA,{id:randomUUID(),cents:1,email:"owner@example.test",live:false,origin:SITE_ORIGINS.sds});
      const env={OWNER_CANARY_EXPECTED_AMOUNT_ATOMIC:"10000",OWNER_CANARY_EXPECTED_RECIPIENT:merchant,OWNER_CANARY_EXPECTED_TIMEOUT_SECONDS:"300",
        OWNER_CANARY_EXPECTED_RECEIPT_SIGNER:trust.signerAddress,OWNER_CANARY_ATTEMPT_DIR:dir};
      let walletReads=0,sendCount=0;
      const common={input,env,chain:()=>publicClient,expectedPayer:payer.address,admitSigner:()=>{walletReads++;return payer;},fetchImpl:async(url,init)=>{
        const req=new Request(url,init),r=await toGateway(req);
        if(req.headers.has("payment-signature")) {sendCount++;if(loseResponse)throw Error("lost reply");}
        return r;
      }};
      const preflight=await runOwnerOrder({...common,mode:"--preflight"});assert.equal(walletReads,0);
      assert.equal(preflight.schemaSha256,"79261db44a0547453fdec90fbc191051c6fe5c4528705f7f397c049a7456c7a6");
      await assert.rejects(runOwnerOrder({...common,mode:"--preflight",env:{...env,OWNER_CANARY_EXPECTED_RECEIPT_SIGNER:payer.address}}));
      await assert.rejects(runOwnerOrder({...common,mode:"--execute",env:{...env,OWNER_CANARY_EXPECTED_SCHEMA_SHA256:"0".repeat(64)}}));
      assert.equal(walletReads,0);env.OWNER_CANARY_EXPECTED_SCHEMA_SHA256=preflight.schemaSha256;
      const results=await Promise.allSettled([runOwnerOrder({...common,mode:"--execute"}),runOwnerOrder({...common,mode:"--execute"})]);
      assert.equal(results.filter(r=>r.status==="fulfilled" && r.value.state==="paid").length,loseResponse?0:1,JSON.stringify(results.map(r=>r.value||r.reason.message)));
      assert.equal(walletReads,1);assert.equal(sendCount,1);
      const received=await runOwnerOrder({...common,mode:"--receive"});assert.equal(received.state,"paid");assert.equal(walletReads,1);
      if (!loseResponse) {
        const r=await prepareRefund({order:input.paymentReference,site:"sds",token:admin,client:publicClient,fetchImpl:toSite});
        const q=r.originalPayment,transactionHash=mine({from:q.merchant,to:q.payer,value:q.amountAtomic},true);
        const canonical={schema:"pilot.merchant-refund.canonical.v1",role:"merchant_refund",site:"sds",order:q.order,
          operationId:q.operationId,originalPayment:q.original,network:q.network,token:q.token,source:q.merchant,recipient:q.payer,
          amountAtomic:q.amountAtomic,status:"success",exactTransferVerified:true,logIndex:0,transactionHash};
        await prepareRefund({order:q.order,site:"sds",token:admin,client:publicClient,fetchImpl:toSite,canonical});
        const refunded=await runOwnerOrder({...common,mode:"--receive"});
        assert.equal(refunded.state,"refunded");assert.equal(refunded.refund,transactionHash);
        await assert.rejects(runOwnerOrder({...common,mode:"--receive",chain:()=>({...publicClient,getTransaction:async({hash})=>({
          ...await publicClient.getTransaction({hash}),from:payer.address})})}),/finalized owner transfer/);
        assert.equal(sendCount,1);assert.equal(walletReads,1);
      }
    }
    assert.equal(settles,4);
  }
  if (process.env.HOSTED_ORDER_PREVIEW === "1") {
    const {hostedLinks}=await load("server/lib/hosted-offer-catalog.js");
    const {legacyOffer}=await load("server/lib/legacy-order.js");
    const ids=Object.keys(hostedLinks).filter(id=>legacyOffer(id));
    process.env.SDS_ORDER_USDC="1";
    process.env.SDS_LEGACY_USDC_OFFERS=ids.join(",");
    process.env.SDS_TEST_LEGACY_LINKS=JSON.stringify(Object.fromEntries(ids.map(id=>[id,"test_"+id])));
    stripe.paymentLinks={
      list:async()=>({has_more:false,data:ids.map(id=>({id:"plink_"+id,url:"https://buy.stripe.com/test_"+id,
        livemode:false,active:true,after_completion:{type:"hosted_confirmation"},custom_fields:[]}))}),
      listLineItems:async link=>{const id=link.slice(6);return {has_more:false,data:[{quantity:1,price:{id:"price_"+id,
        currency:"usd",active:true,unit_amount:legacyOffer(id).cents,product:{active:true,id:"prod_"+id,name:legacyOffer(id).title}}}]};}
    };
    const before=settles;
    for(const id of ids) {
      const path=origin(site)+"/api/checkout/hosted/"+id;
      const offer=await (await fetch(path,{headers:{accept:"application/json"}})).json();
      assert.deepEqual(offer.methods,["card","base_usdc"]);
      const body={order:randomUUID(),method:"base_usdc",email:"owner@example.test",target:"https://example.com/project",city:"Palo Alto"};
      const open=async method=>fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,method})});
      const [first,replay]=await Promise.all([open("base_usdc"),open("base_usdc")]);
      assert.equal(first.status,201);assert.equal(replay.status,201);
      const opened=await first.json();assert.deepEqual(await replay.json(),opened);
      assert.equal((await open("card")).status,409);
      const paid=await payOrder({resource:opened.paymentUrl,amount:String(BigInt(offer.cents)*10000n),account:payer,fetchImpl:toGateway});
      assert.equal(paid.status,200);const payment=await paid.json();assert.equal(payment.state,"paid");
      assert.equal(payment.receipt.payer,payer.address);
      assert.equal((await (await toGateway(new Request(opened.paymentUrl))).json()).receipt.transaction,payment.receipt.transaction);
      const mail=await pool.query(`select mail_key from ${careTable("care_mail")} where hosted_order_id=$1`,[opened.order]);
      assert.equal(mail.rowCount,1);
    }
    assert.equal(settles-before,7);
    if(process.env.WATCH_ORDER_PREVIEW==="1") {
      process.env.SDS_SKILL_WATCH_USDC="1";process.env.SDS_TEST_LEGACY_LINKS='{"legacy_skill_watch":"test_watch"}';
      stripe.paymentLinks={list:async()=>({has_more:false,data:[{id:"plink_watch",active:true,livemode:false,url:"https://buy.stripe.com/test_watch"}]}),
        listLineItems:async()=>({has_more:false,data:[{quantity:1,price:{id:"price_watch",active:true,currency:"usd",unit_amount:1200,
          product:{active:true,id:"prod_watch",name:"SkillGuard Watch"},recurring:{interval:"month",interval_count:1}}}]})};
      const path=origin(site)+"/api/checkout/hosted/skillguard-watch",order=randomUUID();
      const html=await (await fetch(path)).text();assert.match(html,/12 USD per month/);assert.ok(html.indexOf("Pay by card")<html.indexOf("Pay with USDC"));
      const opened=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({order,
        method:"base_usdc",repositories:"https://github.com/example/watch",email:"watch@example.test"})});
      assert.equal(opened.status,201);const {paymentUrl}=await opened.json();
      const paid=await payOrder({resource:paymentUrl,amount:"12000000",account:payer,fetchImpl:toGateway});
      assert.equal(paid.status,200);assert.equal((await paid.json()).state,"paid");assert.equal(settles-before,8);
      const periods=await pool.query(`select * from ${careTable("care_periods")} where order_id=$1`,[order]);
      assert.equal(periods.rowCount,1);
      const invoice=await pool.query(`select * from ${careTable("care_orders")} where rail_parent=$1`,[order]);
      assert.equal(invoice.rowCount,1);assert.equal(invoice.rows[0].rail_attempt,null);assert.equal(invoice.rows[0].amount_cents,1200);
    }
  }
});
