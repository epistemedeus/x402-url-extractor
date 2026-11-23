import { decodeEventLog, getAddress, parseAbiItem } from "viem";
import { BASE_USDC, settlementProof } from "../settlement-proof.mjs";

const used = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
const stateMethod = parseAbiItem("function authorizationState(address authorizer, bytes32 nonce) view returns (bool)");
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const word = /^0x[0-9a-f]{64}$/i;
const uint = /^(0|[1-9][0-9]{0,19})$/;
const equal = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

export function amountForCents(cents) {
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000000) throw Error("invalid order cents");
  return String(BigInt(cents) * 10000n);
}

function decode(log, event) {
  try { return decodeEventLog({ abi: [event], topics: log.topics, data: log.data, strict: true }).args; }
  catch { return null; }
}

// A facilitator hash can identify a mismatch for review. Only the separate Circle
// authorization scan can settle an order.
async function otherAssetEvidence(client, transaction, payer, nonce, recipient, head) {
  if (!word.test(transaction)) return null;
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: transaction }); }
  catch (error) {
    if (error.name === "TransactionReceiptNotFoundError") return null;
    throw error;
  }
  if (receipt.blockNumber > head.number || receipt.status !== "success") return null;
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (!equal(receipt.transactionHash, transaction) || !equal(receipt.blockHash, block.hash) ||
      receipt.blockNumber !== block.number) throw Error("provider receipt is not canonical");
  const matches = [];
  for (const [index, log] of receipt.logs.entries()) {
    if (equal(log.address, BASE_USDC)) continue;
    const auth = decode(log, used);
    if (!equal(auth?.authorizer, payer) || !equal(auth?.nonce, nonce)) continue;
    const next = receipt.logs.slice(index + 1).find(item => equal(item.address, log.address));
    const move = next && decode(next, transfer);
    if (!equal(move?.from, payer) || !equal(move?.to, recipient)) continue;
    if ([log, next].some(item => item.removed || !equal(item.blockHash, block.hash) ||
        !equal(item.transactionHash, transaction) || item.blockNumber !== block.number ||
        !Number.isSafeInteger(item.logIndex)) || next.logIndex <= log.logIndex) throw Error("provider log identity mismatch");
    matches.push({ transaction, payer, nonce, recipient, asset: getAddress(log.address),
      amount: String(move.value), logIndex: log.logIndex, transferLogIndex: next.logIndex,
      block: String(block.number), blockHash: block.hash, timestamp: String(block.timestamp) });
  }
  if (!matches.length) return null;
  return matches.length === 1 ? { state: "held", reason: "wrong_asset", evidence: matches[0] }
    : { state: "held", reason: "ambiguous_foreign_transfers" };
}

async function exhaustedRange(client, quote, attempt, payer, recipient, head, nextBlock) {
  const mismatch = await otherAssetEvidence(client, quote.transaction, payer, attempt.nonce, recipient, head);
  if (uint.test(attempt.validBefore) && head.timestamp >= BigInt(attempt.validBefore)) {
    const consumed = await client.readContract({ address: BASE_USDC, abi: [stateMethod], functionName: "authorizationState",
      args: [payer, attempt.nonce], blockNumber: head.number });
    if (typeof consumed !== "boolean") throw Error("authorization status unavailable");
    if (mismatch && !consumed) return mismatch;
    return { state: "held", ...(mismatch?.evidence && { evidence: mismatch.evidence }), reason: consumed ? "consumed_without_matched_transfer" : "authorization_expired_unused" };
  }
  return { state: "seen", nextBlock: String(nextBlock), ...(mismatch && { review: mismatch }) };
}

// Only the owner supplies the admitted payer, nonce and scan start. No client-supplied hash is needed.
// One bounded finalized range per read. The owner may persist nextBlock for the next read.
export async function reconcileOrder({ client, quote, attempt, merchant, window = 1500n }) {
  return reconcileAuthorization({ client, quote, attempt, merchant, amount: amountForCents(quote.cents), window });
}

export async function reconcileAuthorization({ client, quote, attempt, merchant, amount, window = 1500n }) {
  if (!/^[1-9][0-9]{0,15}$/.test(amount)) throw Error("invalid recovery amount");
  const payer = getAddress(attempt.payer);
  const recipient = getAddress(merchant);
  if (!word.test(attempt.nonce) || !uint.test(attempt.nextBlock) || window < 1n || window > 2000n ||
      !Number.isSafeInteger(quote.expires) || !Number.isSafeInteger(quote.created) ||
      quote.created >= quote.expires) throw Error("invalid order recovery bounds");
  if (await client.getChainId() !== 8453) throw Error("expected Base chain");
  const finalized = await client.getBlock({ blockTag: "finalized" });
  const start = BigInt(attempt.nextBlock);
  if (start > finalized.number) {
    // A fresh anchor can be ahead of finality. Its first block has not been scanned.
    if (start > finalized.number + 1n) return { state: "seen" };
    return exhaustedRange(client, quote, attempt, payer, recipient, finalized, start);
  }
  const end = start + window - 1n < finalized.number ? start + window - 1n : finalized.number;
  const logs = await client.getLogs({ address: BASE_USDC, event: used, args: { authorizer: payer, nonce: attempt.nonce },
    fromBlock: start, toBlock: end, strict: true });
  if (!logs.length) return end === finalized.number
    ? exhaustedRange(client, quote, attempt, payer, recipient, finalized, end + 1n)
    : { state: "seen", nextBlock: String(end + 1n) };
  if (logs.length !== 1) return { state: "held", reason: "ambiguous_authorization" };
  const event = logs[0];
  const hash = event.transactionHash;
  if (!word.test(hash) || event.removed || event.blockNumber < start || event.blockNumber > end) throw Error("invalid log provenance");
  const receipt = await client.getTransactionReceipt({ hash });
  const block = await client.getBlock({ blockNumber: event.blockNumber });
  if (receipt.status !== "success" || !equal(receipt.transactionHash, hash) ||
      !equal(receipt.blockHash, block.hash) || !equal(event.blockHash, block.hash) ||
      receipt.blockNumber !== event.blockNumber) throw Error("receipt is not canonical");
  // Circle's EIP-3009 use emits AuthorizationUsed then the corresponding Transfer.
  // Reject ambiguous batches rather than attaching another same-amount transfer to this order.
  const local = receipt.logs.filter((log) => equal(log.address, BASE_USDC));
  const index = local.findIndex((log) => log.logIndex === event.logIndex);
  const auth = index >= 0 && decode(local[index], used);
  if (!auth || !equal(auth.authorizer, payer) || !equal(auth.nonce, attempt.nonce)) throw Error("authorization log mismatch");
  const movement = local[index + 1] && decode(local[index + 1], transfer);
  const evidence = { transaction: hash, logIndex: event.logIndex, nonce: attempt.nonce, payer,
    block: String(block.number), blockHash: block.hash, timestamp: String(block.timestamp), asset: BASE_USDC };
  if (!movement || !equal(movement.from, payer) || !equal(movement.to, recipient)) {
    return { state: "held", reason: "transfer_unmatched", evidence };
  }
  Object.assign(evidence, { amount: String(movement.value), recipient, transferLogIndex: local[index + 1].logIndex });
  if (evidence.amount !== amount) return { state: "held", reason: "amount_changed", evidence };
  const proof = await settlementProof({ transactionHash: hash, recipient, payer, amountAtomic: amount },
    { client: { getTransactionReceipt: async () => receipt, getBlock: async () => block } });
  if (!proof.settlement.verified) return { state: "held", reason: "ambiguous_transfer", evidence };
  const at = block.timestamp * 1000n;
  if (block.timestamp < BigInt(Math.floor(quote.created / 1000)) || at >= BigInt(quote.expires) || quote.version !== attempt.version) {
    return { state: "held", reason: "quote_changed_or_expired", evidence };
  }
  return { state: "paid", evidence };
}
