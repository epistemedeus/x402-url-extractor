import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mountOrderPayments, SITE_ORIGINS } from "./http.mjs";
import { payOrder } from "./agent.mjs";
import { prepareRefund } from "./refund-admin.mjs";
import { BASE_USDC } from "../settlement-proof.mjs";

const siteRoot = process.env.SDS_PREVIEW_SOURCE;
const enrolled = siteRoot && process.env.SDS_PRIVATE_PREVIEW === "1";
const merchant = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const payer = privateKeyToAccount("0x" + "2".repeat(64)); // public deterministic fixture
const used = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const origin = server => "http://127.0.0.1:" + server.address().port;

test("SDS wallet and independent agent use the gateway and existing PostgreSQL receipt through refund", { skip: !enrolled }, async t => {
  const { default: pg } = await import(pathToFileURL(createRequire(resolve(siteRoot, "package.json")).resolve("pg")));
  const load = p => import(pathToFileURL(resolve(siteRoot, p)));
  const { createSdsApp } = await load("server/app.js");
  const { openCareStore } = await load("server/lib/care-store.js");
  const { createCareService } = await load("server/lib/care-service.js");
  const { createOwnedOrder } = await load("server/scripts/care-usdc-qa.mjs");
  const { careTable } = await load("server/lib/care-database.js");
  const store = openCareStore(), pool = new pg.Pool({ connectionString: process.env.SDS_CARE_DATABASE_URL });
  t.after(async () => { await store.close(); await pool.end(); });
  const token = randomBytes(36).toString("hex"), admin = randomBytes(36).toString("hex");
  process.env.ORDER_PAYMENTS_SDS_TOKEN = token;
  process.env.ORDER_PAYMENTS_SDS_REFUND_ADMIN = admin;
  const care = createCareService({ store, stripe: {}, live: false, secret: token, origin: SITE_ORIGINS.sds, orderPayments: true });
  const site = createSdsApp({ care }).listen(0, "127.0.0.1");
  await once(site, "listening"); t.after(() => new Promise(r => site.close(r)));
  let blockNo = 3n, settles = 0;
  const receipts = [], blocks = new Map();
  const publicClient = {
    getChainId: async () => 8453,
    getBlock: async ({ blockNumber }) => blocks.get(blockNumber) ?? { number: blockNo, timestamp: BigInt(Math.floor(Date.now()/1000)) },
    getTransactionReceipt: async ({ hash }) => receipts.find(r => r.transactionHash === hash),
    async getLogs({ args, fromBlock, toBlock }) {
      return receipts.filter(r => r.blockNumber >= fromBlock && r.blockNumber <= toBlock && r.payer === args.authorizer && r.nonce === args.nonce)
        .map(r => r.logs[0]);
    },
  };
  function mine(auth) {
    blockNo++;
    const hash = "0x" + blockNo.toString(16).padStart(64,"0");
    const block = { number: blockNo, timestamp: BigInt(Math.floor(Date.now()/1000)), hash };
    blocks.set(blockNo, block);
    const log = (topics,data,logIndex) => ({ address: BASE_USDC, topics, data, logIndex, blockHash: hash, blockNumber: blockNo, transactionHash: hash });
    const logs = [log(encodeEventTopics({ abi: [used], args: { authorizer: auth.from, nonce: auth.nonce } }), "0x", 0),
      log(encodeEventTopics({ abi: [transfer], args: { from: auth.from, to: auth.to } }), encodeAbiParameters([{ type: "uint256" }], [BigInt(auth.value)]), 1)];
    receipts.push({ status: "success", from: "0x" + "5".repeat(40), transactionHash: hash, blockHash: hash, blockNumber: blockNo, payer: auth.from, nonce: auth.nonce, logs });
    return hash;
  }
  const toSite = (url, init) => {
    assert.equal(new URL(url).origin, SITE_ORIGINS.sds);
    return fetch(origin(site) + new URL(url).pathname, init);
  };
  const app = express();
  mountOrderPayments(app, { merchant, network: "eip155:8453", env: { ORDER_PAYMENTS_SDS_TOKEN: token, MPP_SECRET_KEY: token },
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
    assert.equal(r.action, "reserved_for_existing_signer"); assert.equal(r.typedData.message.to, payer.address);
    assert.equal(r.typedData.message.value, "10000");
    const retry = await prepareRefund({ order: qa.paymentReference, site: "sds", token: admin, client: publicClient, fetchImpl: toSite });
    assert.equal(retry.action, "read_status_only");
    mine(r.typedData.message); // controlled chain fixture represents Root's external refund effect
    const final = await (await toGateway(new Request(qa.agent))).json();
    assert.equal(final.state, "refunded");
    assert.equal(final.receipt.refund.recipient, payer.address);
    assert.notEqual(final.receipt.transaction, final.receipt.refund.transaction);
    assert.equal((await store.order(id)).refunded_cents, 1);
    const events = await pool.query(`select event,test from ${careTable("journey_events")} where order_id=$1`, [id]);
    assert.deepEqual(events.rows.map(r => r.event).sort(), ["checkout_started","payment_refunded","payment_verified"]);
    assert.ok(events.rows.every(r => r.test));
  }
  assert.equal(settles, 2);
});
