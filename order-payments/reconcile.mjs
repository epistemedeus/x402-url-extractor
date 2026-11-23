import { decodeEventLog, getAddress, parseAbiItem } from "viem";
import { BASE_USDC, settlementProof } from "../settlement-proof.mjs";

const used = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
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

// Only the owner supplies the admitted payer, nonce and scan start. No client-supplied hash is needed.
// One bounded finalized range per read. The owner may persist nextBlock for the next read.
export async function reconcileOrder({ client, quote, attempt, merchant, window = 1500n }) {
  const amount = amountForCents(quote.cents);
  const payer = getAddress(attempt.payer);
  const recipient = getAddress(merchant);
  if (!word.test(attempt.nonce) || !uint.test(attempt.nextBlock) || window < 1n || window > 2000n ||
      !Number.isSafeInteger(quote.expires) || !Number.isSafeInteger(quote.created) ||
      quote.created >= quote.expires) throw Error("invalid order recovery bounds");
  if (await client.getChainId() !== 8453) throw Error("expected Base chain");
  const finalized = await client.getBlock({ blockTag: "finalized" });
  const start = BigInt(attempt.nextBlock);
  if (start > finalized.number) return { state: "seen" };
  const end = start + window - 1n < finalized.number ? start + window - 1n : finalized.number;
  const logs = await client.getLogs({ address: BASE_USDC, event: used, args: { authorizer: payer, nonce: attempt.nonce },
    fromBlock: start, toBlock: end, strict: true });
  if (!logs.length) return { state: "seen", nextBlock: String(end + 1n) };
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
  if (at < BigInt(quote.created) || at >= BigInt(quote.expires) || quote.version !== attempt.version) {
    return { state: "held", reason: "quote_changed_or_expired", evidence };
  }
  return { state: "paid", evidence };
}
