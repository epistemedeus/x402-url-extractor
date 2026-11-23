import { createHash } from "node:crypto";

const word = /^0x[0-9a-f]{64}$/i;
const address = /^0x[0-9a-f]{40}$/i;
const uint = value => typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value);
const asset = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const recipient = "0x8904df3de6dfee6a7c8cc38619d2f17806213cee";
export class OrderRailConflict extends Error {
  constructor() { super("This payment needs review."); this.status = 409; }
}
const conflict = () => new OrderRailConflict();
const same = (s, t) => typeof s === "string" && typeof t === "string" && s.toLowerCase() === t.toLowerCase();

// Both Care and account orders validate the exact message a protected signer will see.
export function checkRefund(q, f) {
  const original = q.receipt, msg = f?.typedData?.message, data = f?.typedData, domain = data?.domain;
  const fields = [["from","address"],["to","address"],["value","uint256"],["validAfter","uint256"],["validBefore","uint256"],["nonce","bytes32"]];
  if (data?.primaryType !== "TransferWithAuthorization" || Object.keys(data.types ?? {}).length !== 1 ||
      JSON.stringify(data.types.TransferWithAuthorization?.map(x => [x.name,x.type])) !== JSON.stringify(fields) ||
      domain?.name !== "USD Coin" || domain.version !== "2" || domain.chainId !== 8453 || !same(domain.verifyingContract,asset) ||
      Object.keys(domain).length !== 4 || Object.keys(msg ?? {}).length !== 6 || msg.validAfter !== "0" ||
      !Number.isSafeInteger(f.expires) || msg.validBefore !== String(f.expires / 1000) ||
      !uint(original?.amount) || BigInt(original.amount) <= 0n || same(original.payer,recipient)) throw conflict();
  if (!["paid","held"].includes(q.state) || !word.test(original?.transaction) || !word.test(original.blockHash) ||
        !Number.isSafeInteger(original.transferLogIndex) || original.transferLogIndex < 0 || !same(original.recipient,recipient) || !same(original.asset,asset) ||
        f?.original !== `8453:${original.transaction.toLowerCase()}:${original.transferLogIndex}` ||
        f.state !== "refund_pending" || !uint(f.nextBlock) || !Number.isSafeInteger(f.created) ||
        f.created > Date.now() + 10000 || f.expires !== f.created + 300000 || f.expires <= Date.now() ||
        !same(msg?.from,recipient) || !same(msg?.to,original.payer) || msg.value !== original.amount ||
        msg.nonce !== "0x" + createHash("sha256").update("order-refund/v1/" + f.original).digest("hex")) throw conflict();
}

export function projectRailChange(q, action, body) {
  if (["load","refund-read"].includes(action)) return { value: q };
  const { attempt: a, result: r } = body, original = q.receipt;
  if (action === "anchor") {
    if (!uint(body.block)) throw conflict();
    return { value: { block: q.startBlock ?? body.block }, ...(!q.startBlock && { patch: { startBlock: body.block } }) };
  }
  if (action === "arm") {
    if (q.state !== "waiting" || q.expires <= Date.now() || q.created > Date.now() || q.version !== a?.version ||
        !word.test(a.nonce) || !address.test(a.payer) || !uint(a.nextBlock) || a.nextBlock !== q.startBlock ||
        !["mpp","x402"].includes(a.protocol)) return { value: { armed: false } };
    return { patch: { state: "seen", attempt: { payer: a.payer, nonce: a.nonce, version: q.version, nextBlock: a.nextBlock, protocol: a.protocol } },
      value: { armed: true } };
  }
  if (action === "refund-reserve") {
    if (q.refund) return { value: { won: false } };
    const f = body.refund;
    checkRefund(q, f);
    return { patch: { refund: f, state: "refund_pending" }, value: { won: true } };
  }
  if (action === "refund-observe") {
    if (!q.refund || q.refund.original !== body.original) throw conflict();
    if (q.state !== "refund_pending") return { value: q };
    const e = r.evidence;
    if (r.state === "paid") {
      if (!word.test(e?.transaction) || !word.test(e.blockHash) || e.nonce !== q.refund.typedData.message.nonce ||
          !same(e.payer,recipient) || !same(e.recipient,original.payer) || !same(e.asset,asset) || e.amount !== original.amount) throw conflict();
      return { patch: { state: "refunded", refund: { ...q.refund, state: "refunded", evidence: e }, receipt: { ...original, refund: e } } };
    }
    if (r.state === "held") return { patch: { state: "held", reason: r.reason, refund: { ...q.refund, state: "held", evidence: e } } };
    if (r.state !== "seen") throw conflict();
    if (!uint(r.nextBlock) || BigInt(r.nextBlock) <= BigInt(q.refund.nextBlock)) return { value: q };
    return { patch: { refund: { ...q.refund, nextBlock: r.nextBlock } } };
  }
  if (!q.attempt || !a || q.attempt.nonce !== a.nonce || q.attempt.payer !== a.payer || q.attempt.version !== a.version) throw conflict();
  if (action === "submitted") {
    if (r.transaction && (!word.test(r.transaction) || q.transaction && q.transaction !== r.transaction)) throw conflict();
    return { patch: { ...(r.transaction && { transaction: r.transaction }), 
      ...(typeof r.reason === "string" && /^[A-Za-z0-9_:-]{1,96}$/.test(r.reason) && { reason: r.reason }) }, value: {} };
  }
  if (action !== "observe") throw conflict();
  if (q.state !== "seen") return { value: q };
  if (r.state === "seen") {
    return uint(r.nextBlock) && BigInt(r.nextBlock) > BigInt(q.attempt.nextBlock)
      ? { patch: { attempt: { ...q.attempt, nextBlock: r.nextBlock } } } : { value: q };
  }
  const e = r.evidence;
  if (r.state === "held") return { patch: { state: "held", reason: r.reason, ...(e && { receipt: e }) } };
  if (r.state !== "paid" || !word.test(e?.transaction) || !word.test(e.blockHash) || e.nonce !== a.nonce || !same(e.payer,a.payer) ||
      !same(e.recipient,recipient) || !same(e.asset,asset) || (!Number.isSafeInteger(e.logIndex) || e.logIndex < 0) || !Number.isSafeInteger(e.transferLogIndex) ||
      e.transferLogIndex <= e.logIndex || !uint(e.timestamp) || !uint(e.block)) throw conflict();
  if (e.amount !== String(BigInt(q.cents)*10000n) || q.version !== a.version || (q.transaction && !same(q.transaction,e.transaction)) ||
      BigInt(e.timestamp) < BigInt(Math.floor(q.created / 1000)) || BigInt(e.timestamp)*1000n >= BigInt(q.expires)) {
    return { patch: { state: "held", reason: "order_changed", receipt: e } };
  }
  return { patch: { state: "paid", reason: null, receipt: e } };
}
