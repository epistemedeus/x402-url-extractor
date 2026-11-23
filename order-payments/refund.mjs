import { createHash } from "node:crypto";
import { getAddress } from "viem";
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
