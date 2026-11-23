import { createHash } from "node:crypto";
import { getAddress, decodeEventLog, encodeFunctionData, erc20Abi } from "viem";
import { Types } from "mppx/evm";
import { BASE_USDC } from "../settlement-proof.mjs";
import { reconcileAuthorization } from "./reconcile.mjs";

const word = /^0x[0-9a-f]{64}$/i;
export function refundTerms(receipt, merchant, startBlock, now = Date.now()) {
  const from = getAddress(merchant);
  if (!word.test(receipt?.transaction) || !word.test(receipt?.blockHash) ||
      !Number.isSafeInteger(receipt?.transferLogIndex) || receipt.transferLogIndex < 0 ||
      getAddress(receipt.asset) !== getAddress(BASE_USDC) || getAddress(receipt.recipient) !== from ||
      !/^[1-9][0-9]{0,15}$/.test(receipt.amount) || !/^(0|[1-9][0-9]{0,19})$/.test(startBlock)) {
    throw Error("missing attributable original transfer");
  }
  const to = getAddress(receipt.payer);
  if (from === to) throw Error("self-transfer cannot establish an owned refund");
  const original = `8453:${receipt.transaction.toLowerCase()}:${receipt.transferLogIndex}`;
  const nonce = "0x" + createHash("sha256").update("order-refund/v1/" + original).digest("hex");
  const created = Math.floor(now / 1000) * 1000;
  const expires = created + 300000;
  const authorization = { from, to, value: receipt.amount, validAfter: "0", validBefore: String(expires / 1000), nonce };
  return { state: "refund_pending", original, created, expires, nextBlock: String(startBlock),
    typedData: { domain: Types.authorizationDomain({ authorization: { name: "USD Coin", version: "2" },
      chainId: 8453, currency: BASE_USDC }), types: Types.authorizationTypes,
      primaryType: "TransferWithAuthorization", message: authorization } };
}

export async function reconcileRefund(client, receipt, refund, merchant) {
  if (refund.request?.schema === "pilot.merchant-refund.order.v1") {
    if (!refund.transaction) return { state:"seen" };
    return reconcileDirectRefund(client,refund,merchant);
  }
  const expected = refundTerms(receipt, merchant, refund.nextBlock, refund.created);
  if (expected.original !== refund.original || expected.expires !== refund.expires ||
      expected.typedData.message.nonce !== refund.typedData?.message?.nonce) throw Error("refund identity changed");
  return reconcileAuthorization({ client, quote: { version: expected.original, created: expected.created, expires: expected.expires },
    attempt: { version: expected.original, nextBlock: refund.nextBlock, payer: merchant, nonce: expected.typedData.message.nonce },
    merchant: expected.typedData.message.to, amount: receipt.amount });
}

// Re-read the original effect before releasing a protected signing request. An
// amount mismatch can be returned only in the amount actually received.
export async function verifyRefundSource(client, row, merchant, now = Date.now()) {
  const e = row.receipt;
  if (!e || !row.attempt || row.attempt.nonce !== e.nonce ||
      getAddress(row.attempt.payer) !== getAddress(e.payer) || !/^(0|[1-9][0-9]{0,19})$/.test(e.block)) {
    throw Error("original order debit is not attributable");
  }
  const proof = await reconcileAuthorization({ client, quote: { version:row.attempt.version,created:0,expires:now + 1 },
    attempt:{ version:row.attempt.version,payer:row.attempt.payer,nonce:row.attempt.nonce,nextBlock:e.block },
    merchant, amount:e.amount, window:1n });
  if (proof.state !== "paid" || ["transaction","blockHash","logIndex","transferLogIndex","nonce","amount","timestamp","block"]
      .some(key=>proof.evidence[key] !== e[key]) || getAddress(proof.evidence.recipient) !== getAddress(e.recipient) ||
      getAddress(proof.evidence.asset) !== getAddress(e.asset)) throw Error("original finalized debit could not be received");
  return proof.evidence;
}

export function directRefundTerms(row,site,merchant) {
  const e=row.receipt, original=`8453:${e.transaction.toLowerCase()}:${e.transferLogIndex}`;
  const operationId="merchant-refund-"+createHash("sha256").update(original).digest("hex");
  const request={ schema:"pilot.merchant-refund.order.v1",site,order:row.id,resource:row.resource,
    network:"eip155:8453",token:BASE_USDC,merchant:getAddress(merchant),payer:getAddress(e.payer),amountAtomic:e.amount,
    original,operationId,transaction:e.transaction,blockHash:e.blockHash,block:e.block,logIndex:e.logIndex,
    transferLogIndex:e.transferLogIndex,nonce:e.nonce };
  return { state:"refund_pending",original,request };
}

async function reconcileDirectRefund(client,refund,merchant) {
  const q=refund.request,hash=refund.transaction;
  if (!word.test(hash) || await client.getChainId()!==8453) throw Error("invalid direct refund binding");
  const [tx,r,head]=await Promise.all([client.getTransaction({hash}),client.getTransactionReceipt({hash}),client.getBlock({blockTag:"finalized"})]);
  if (head.number<r.blockNumber) return {state:"seen"};
  const block=await client.getBlock({blockNumber:r.blockNumber});
  if (r.transactionHash.toLowerCase()!==hash.toLowerCase() || tx.hash.toLowerCase()!==hash.toLowerCase() ||
      block.hash.toLowerCase()!==r.blockHash.toLowerCase() || tx.blockHash.toLowerCase()!==r.blockHash.toLowerCase() ||
      block.number!==r.blockNumber) throw Error("refund receipt not canonical");
  const from=getAddress(merchant),to=getAddress(q.payer);
  const data=encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[to,BigInt(q.amountAtomic)]});
  if(r.status!=="success" || getAddress(tx.from)!==from || getAddress(tx.to)!==getAddress(BASE_USDC) ||
      tx.input.toLowerCase()!==data.toLowerCase() || tx.value!==0n) return {state:"held",reason:"refund_call_mismatch"};
  const moves=r.logs.filter(log=>!log.removed && getAddress(log.address)===getAddress(BASE_USDC)).flatMap(log=>{
    if (log.transactionHash?.toLowerCase()!==hash.toLowerCase() || log.blockHash?.toLowerCase()!==block.hash.toLowerCase() ||
        log.blockNumber!==r.blockNumber) throw Error("refund log identity mismatch");
    try {
      const evt=decodeEventLog({abi:erc20Abi,data:log.data,topics:log.topics,strict:true});
      return evt.eventName==="Transfer" && getAddress(evt.args.from)===from && getAddress(evt.args.to)===to &&
        evt.args.value===BigInt(q.amountAtomic) ? [log] : [];
    } catch { return []; }
  });
  if (moves.length!==1 || moves[0].logIndex!==refund.transferLogIndex) return {state:"held",reason:"refund_transfer_mismatch"};
  return {state:"paid",evidence:{transaction:hash,payer:from,recipient:to,asset:BASE_USDC,amount:q.amountAtomic,
    operationId:q.operationId,transferLogIndex:moves[0].logIndex,block:String(block.number),blockHash:block.hash,timestamp:String(block.timestamp)}};
}
