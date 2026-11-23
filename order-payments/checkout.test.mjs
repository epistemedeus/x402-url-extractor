import test from "node:test";
import assert from "node:assert/strict";
import { Mppx, evm } from "mppx/client";
import { encodeEventTopics, encodeAbiParameters, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Receipt } from "mppx";
import { decodePaymentResponseHeader, decodePaymentRequiredHeader } from "@x402/core/http";
import { BASE_USDC } from "../settlement-proof.mjs";
import { verifyRefundSource } from "./refund.mjs";
import { payOrder } from "./agent.mjs";
import { checkoutOrder } from "./checkout.mjs";
import { amountForCents, reconcileOrder } from "./reconcile.mjs";

// Public, valueless viem fixture. No provider connection or real wallet.
const payer = privateKeyToAccount("0x" + "1".repeat(64));
const other = privateKeyToAccount("0x" + "2".repeat(64));
const merchant = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const tx = "0x" + "3".repeat(64), blockHash = "0x" + "4".repeat(64);
const used = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

function fixture(id = "2fb2b696-27fb-4839-8bce-0cb4c9e3e69a") {
  const now = Date.now(), resource = "https://agents.samedaydesk.com/order-payments/sds/" + id;
  const row = { id, resource, cents: 49900, version: "care/49900", state: "waiting", created: now - 60000, expires: now + 300000 };
  const calls = { verify: 0, settle: 0, paid: 0 };
  let logs = [], finalized = 99n;
  const owner = {
    async load() { return structuredClone(row); },
    async anchor(block) { return row.startBlock ??= block; },
    async arm(attempt) {
      if (row.state !== "waiting") return false;
      row.state = "seen"; row.attempt = structuredClone(attempt); return true;
    },
    async submitted(_, result) { if (result.headers) row.receiptHeaders = result.headers; if (result.transaction) row.transaction = result.transaction; if (result.reason) row.providerReason = row.reason = result.reason; },
    async observe(_, result) {
      if (row.state !== "seen") return structuredClone(row);
      row.state = result.state;
      if (result.state === "paid") calls.paid++;
      if (result.evidence) row.receipt = result.evidence;
      if (result.reason) row.reason = result.reason;
      if (result.nextBlock) row.attempt.nextBlock = result.nextBlock;
      return structuredClone(row);
    },
  };
  const block = { hash: blockHash, number: 100n, timestamp: BigInt(Math.floor(now / 1000)) };
  const receipt = () => ({ from: other.address, status: "success", transactionHash: tx, blockHash, blockNumber: 100n, logs });
  const client = {
    async getChainId() { return 8453; },
    async getBlock(args) { return args.blockTag === "finalized" ? { ...block, number: finalized } : block; },
    async getTransactionReceipt() { return receipt(); },
    async getLogs({ fromBlock, toBlock }) { return fromBlock <= 100n && toBlock >= 100n ? logs.slice(0, 1) : []; },
  };
  function mine({ payer: from, nonce }, value = amountForCents(row.cents), token = BASE_USDC) {
    const make = (topics, data, address, logIndex) => ({ topics, data, address, logIndex,
      transactionHash: tx, blockNumber: 100n, blockHash, removed: false });
    logs = [make(encodeEventTopics({ abi: [used], args: { authorizer: from, nonce } }), "0x", BASE_USDC, 0),
      make(encodeEventTopics({ abi: [transfer], args: { from, to: merchant } }),
        encodeAbiParameters([{ type: "uint256" }], [BigInt(value)]), token, 1)];
    finalized = 100n;
  }
  const facilitator = {
    async verify() { calls.verify++; return { isValid: true }; },
    async settle() { calls.settle++; mine(row.attempt); return { success: true, transaction: tx, network: "eip155:8453" }; },
  };
  const call = headers => checkoutOrder({ request: new Request(resource, { headers }), owner, client, facilitator,
    merchant, secretKey: "isolated valueless challenge fixture material" });
  return { row, calls, owner, client, facilitator, call, mine, block };
}

async function credential(challenge, protocol, account = payer) {
  const headers = new Headers(challenge.headers);
  if (protocol === "x402") headers.delete("www-authenticate");
  else headers.delete("payment-required");
  const c = Mppx.create({ methods: [evm({ account, networks: [8453], currencies: [evm.assets.base.USDC],
    maxAtomicAmount: "499000000" })], polyfill: false });
  const value = await c.createCredential(new Response(null, { status: 402, headers }));
  return { [protocol === "x402" ? "payment-signature" : "authorization"]: value };
}

for (const protocol of ["mpp", "x402"]) test(protocol + " signed quote, two payers, replay, one receipt", async () => {
  const f = fixture();
  const first = await f.call();
  assert.equal(first.status, 402);
  const req = decodePaymentRequiredHeader(first.headers.get("payment-required"));
  assert.equal(req.accepts[0].amount, "499000000");
  assert.equal(req.resource.url, f.row.resource);
  const headers = await Promise.all([credential(first, protocol), credential(first, protocol, other)]);
  const results = await Promise.all([...headers, headers[0]].map(h => f.call(h)));
  assert.ok(results.some(r => r.status === 200), JSON.stringify(await Promise.all(results.map(r => r.clone().text()))));
  assert.equal(f.calls.settle, 1);
  assert.equal(f.calls.paid, 1);
  const replay = await f.call(headers[0]);
  assert.equal(replay.status, 200);
  if (protocol === "x402") assert.equal(decodePaymentResponseHeader(replay.headers.get("payment-response")).transaction, tx);
  else assert.equal(Receipt.fromResponse(replay).reference, tx);
  assert.equal(f.row.receipt.payer, f.row.attempt.payer);
  assert.equal(f.row.receipt.amount, "499000000");
  assert.equal(f.row.receipt.transaction, tx);
});
test("same amount on another resource is refused before admission", async () => {
  const a = fixture(), b = fixture("260d7901-8aaa-490f-bdfc-97e4bbfab6fa");
  for (const protocol of ["mpp", "x402"]) assert.equal((await b.call(await credential(await a.call(), protocol))).status, 402);
  assert.equal(b.calls.verify, 0);
  assert.equal(b.calls.settle, 0);
});
test("unknown submit, restarted service, finalized receipt and distinct relayer", async () => {
  const f = fixture();
  f.facilitator.settle = async () => { f.calls.settle++; throw Error("transport closed"); };
  const h = await credential(await f.call(), "x402");
  assert.equal((await f.call(h)).status, 202);
  assert.equal((await f.call(h)).status, 202);
  f.mine(f.row.attempt);
  const recovered = await f.call();
  assert.equal(recovered.status, 200);
  assert.equal(decodePaymentResponseHeader(recovered.headers.get("payment-response")).payer, payer.address);
  assert.equal(f.calls.settle, 1);
  assert.equal(f.row.receipt.payer, payer.address);
  assert.notEqual(f.row.receipt.payer, other.address);
});
for (const defect of ["amount", "expired", "changed", "token"]) test("recovery holds " + defect, async () => {
  const f = fixture();
  f.facilitator.settle = async () => { throw Error("unread"); };
  await f.call(await credential(await f.call(), "mpp"));
  f.mine(f.row.attempt, defect === "amount" ? "9" : undefined, defect === "token" ? merchant : undefined);
  if (defect === "expired") f.block.timestamp = BigInt(Math.ceil(f.row.expires / 1000));
  if (defect === "changed") f.row.version += "/2";
  const result = await reconcileOrder({ client: f.client, quote: f.row, attempt: f.row.attempt, merchant });
  assert.equal(result.state, "held");
  assert.equal(result.evidence.transaction, tx);
  assert.equal(f.calls.paid, 0);
});
test("exact cents only", () => {
  for (const val of [0, -1, 3.14, "99", NaN, Infinity, 2 ** 53]) assert.throws(() => amountForCents(val));
  assert.equal(amountForCents(99999999), "999999990000");
});

test("independent @x402/fetch agent completes the same order with one signed request", async () => {
  const f = fixture();
  const response = await payOrder({ resource: f.row.resource, amount: "499000000", account: payer,
    fetchImpl: req => f.call(req.headers) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).receipt.payer, payer.address);
  assert.equal(f.calls.settle, 1);
});

test("a provider success before finality carries no protocol success receipt", async () => {
  const f = fixture();
  f.facilitator.settle = async () => ({ success: true, transaction: tx, network: "eip155:8453" });
  const response = await f.call(await credential(await f.call(), "mpp"));
  assert.equal(response.status, 202);
  assert.equal(response.headers.has("payment-receipt"), false);
  assert.equal(response.headers.has("payment-response"), false);
});

test("protected refund input requires the original canonical debit independently of the order projection", async () => {
  const f=fixture();
  await f.call(await credential(await f.call(),"x402"));
  assert.equal((await verifyRefundSource(f.client,f.row,merchant)).transaction,tx);
  for (const patch of [{transferLogIndex:5},{transaction:"0x"+"6".repeat(64)},{amount:"1"},{payer:other.address}]) {
    await assert.rejects(verifyRefundSource(f.client,{...f.row,receipt:{...f.row.receipt,...patch}},merchant));
  }
});


test("a facilitator refusal remains visible until the signed authorization expires unused", async () => {
  const f = fixture();
  f.facilitator.verify = async () => { f.calls.verify++; return { isValid: false, invalidReason: "insufficient_funds" }; };
  const h = await credential(await f.call(), "x402");
  const initial = await (await f.call(h)).json();
  assert.equal(initial.state, "seen");
  assert.equal(initial.providerReason, "insufficient_funds");
  assert.match(f.row.attempt.validBefore, /^[1-9][0-9]+$/);
  f.block.timestamp = BigInt(f.row.attempt.validBefore);
  f.client.getBlock = async () => f.block;
  f.client.readContract = async ({ address, functionName, args, blockNumber }) => {
    assert.equal(address, BASE_USDC);
    assert.equal(functionName, "authorizationState");
    assert.deepEqual(args, [payer.address, f.row.attempt.nonce]);
    assert.equal(blockNumber, f.block.number);
    return false;
  };
  const held = await f.call(h);
  assert.equal(held.status, 409);
  assert.deepEqual([f.row.reason, f.row.providerReason], ["authorization_expired_unused", "insufficient_funds"]);
  assert.equal(f.calls.verify, 1);
  assert.equal(f.calls.settle, 0);
  assert.equal(f.calls.paid, 0);
});

test("a foreign-token provider hash shows its actual movement and never grants the order", async () => {
  const f = fixture();
  f.facilitator.settle = async () => {
    f.calls.settle++;
    f.mine(f.row.attempt, "123", other.address);
    return { success: true, transaction: tx, network: "eip155:8453" };
  };
  f.client.getLogs = async () => [];
  const read = f.client.getTransactionReceipt;
  f.client.getTransactionReceipt = async args => {
    const r = await read(args);
    return { ...r, logs: r.logs.map(log => ({ ...log, address: other.address })) };
  };
  const pending = await (await f.call(await credential(await f.call(), "mpp"))).json();
  assert.equal(pending.state, "seen");
  assert.equal(pending.review.reason, "wrong_asset");
  f.block.timestamp = BigInt(f.row.attempt.validBefore);
  f.client.readContract = async () => false;
  const held = await (await f.call()).json();
  assert.deepEqual([held.state, held.reason, held.receipt.asset, held.receipt.amount, held.receipt.payer],
    ["held", "wrong_asset", other.address, "123", payer.address]);
  await assert.rejects(verifyRefundSource(f.client, f.row, merchant));
  assert.equal(f.calls.settle, 1);
  assert.equal(f.calls.paid, 0);
});

test("an unavailable nonce read or an unexplained consumed nonce cannot become a proven nonpayment", async () => {
  const f = fixture();
  f.facilitator.settle = async () => { throw Error("unknown"); };
  await f.call(await credential(await f.call(), "x402"));
  f.block.timestamp = BigInt(f.row.attempt.validBefore);
  f.client.getBlock = async () => f.block;
  f.client.readContract = async () => { throw Error("unavailable"); };
  await assert.rejects(f.call(), /unavailable/);
  assert.equal(f.row.state, "seen");
  f.client.readContract = async () => true;
  assert.equal((await (await f.call()).json()).reason, "consumed_without_matched_transfer");
  assert.equal(f.calls.paid, 0);
});
