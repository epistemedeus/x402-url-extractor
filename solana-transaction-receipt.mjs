const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const UINT64_MAX = (1n << 64n) - 1n;
const CANONICAL_SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_RPC_URLS = (process.env.SOLANA_TRANSACTION_RECEIPT_RPC_URLS || "https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com")
  .split(",").map((value) => value.trim()).filter(Boolean);
const MAX_RPC_BYTES = 1024 * 1024;

export class SolanaTransactionReceiptError extends Error {
  constructor(message, { code = "invalid_solana_transaction_receipt_request" } = {}) {
    super(message);
    this.name = "SolanaTransactionReceiptError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new SolanaTransactionReceiptError(message, { code });
}

function decodeBase58(value) {
  if (!BASE58.test(value)) return null;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const character of value) {
    const index = alphabet.indexOf(character);
    if (index < 0) return null;
    number = (number * 58n) + BigInt(index);
  }
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 0xffn));
    number >>= 8n;
  }
  bytes.reverse();
  let zeroes = 0;
  while (zeroes < value.length && value[zeroes] === "1") zeroes += 1;
  return Uint8Array.from([...new Array(zeroes).fill(0), ...bytes]);
}

function publicKey(value, field, { optional = false } = {}) {
  const text = String(value || "").trim();
  if (!text && optional) return null;
  if (!text || decodeBase58(text)?.length !== 32) fail(`${field} must be a 32-byte base58 Solana public key`, `invalid_${field}`);
  return text;
}

function signature(value) {
  const text = String(value || "").trim();
  if (!text || decodeBase58(text)?.length !== 64) {
    fail("signature must be a 64-byte base58 Solana transaction signature", "invalid_signature");
  }
  return text;
}

function atomicAmount(value) {
  const text = String(value || "").trim();
  if (!/^[1-9][0-9]{0,19}$/.test(text)) fail("amountAtomic must be a positive unsigned integer", "invalid_amount");
  const amount = BigInt(text);
  if (amount > UINT64_MAX) fail("amountAtomic exceeds the SPL-token uint64 range", "invalid_amount");
  return text;
}

export function normalizeSolanaTransactionReceiptInput(input = {}) {
  const normalized = {
    signature: signature(input.signature || input.transactionSignature || input.tx),
    mint: publicKey(input.mint || CANONICAL_SOLANA_USDC, "mint"),
    recipient: publicKey(input.recipient, "recipient", { optional: true }),
    amountAtomic: input.amountAtomic == null || String(input.amountAtomic).trim() === "" ? null : atomicAmount(input.amountAtomic),
    payer: publicKey(input.payer, "payer", { optional: true }),
  };
  if (normalized.amountAtomic && !normalized.recipient) {
    fail("recipient is required when amountAtomic is supplied", "recipient_required");
  }
  if (normalized.payer && (!normalized.recipient || !normalized.amountAtomic)) {
    fail("payer requires recipient and amountAtomic for an exact settlement claim", "incomplete_settlement_claim");
  }
  return normalized;
}

function normalizeRpcUrls(values) {
  if (!Array.isArray(values) || !values.length) fail("No public Solana RPC URLs are configured", "rpc_unavailable");
  return values.map((value) => {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      fail("Solana RPC URLs must be credential-free HTTPS URLs", "rpc_unavailable");
    }
    return url.toString();
  });
}

async function rpcTransaction(transactionSignature, { fetchImpl, rpcUrls }) {
  let observedNull = false;
  for (const url of normalizeRpcUrls(rpcUrls)) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [transactionSignature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RPC_BYTES) continue;
      const body = JSON.parse(text);
      if (body?.error) continue;
      if (body?.result == null) {
        observedNull = true;
        continue;
      }
      return { state: "found", transaction: body.result };
    } catch {
      // Continue through the bounded public fallback set.
    }
  }
  return { state: observedNull ? "not_found" : "rpc_unavailable", transaction: null };
}

function amountAt(balance) {
  const value = balance?.uiTokenAmount?.amount;
  return typeof value === "string" && /^[0-9]+$/.test(value) ? BigInt(value) : 0n;
}

function aggregateOwnerBalances(balances = []) {
  const totals = new Map();
  for (const balance of balances) {
    const owner = typeof balance?.owner === "string" ? balance.owner : null;
    const mint = typeof balance?.mint === "string" ? balance.mint : null;
    if (!owner || !mint) continue;
    const key = `${owner}\u0000${mint}`;
    const previous = totals.get(key) || { owner, mint, amount: 0n, decimals: balance?.uiTokenAmount?.decimals ?? null };
    previous.amount += amountAt(balance);
    totals.set(key, previous);
  }
  return totals;
}

function ownerDeltas(meta) {
  const pre = aggregateOwnerBalances(meta?.preTokenBalances);
  const post = aggregateOwnerBalances(meta?.postTokenBalances);
  const keys = new Set([...pre.keys(), ...post.keys()]);
  return [...keys].map((key) => {
    const before = pre.get(key) || { ...post.get(key), amount: 0n };
    const after = post.get(key) || { ...pre.get(key), amount: 0n };
    return {
      owner: after.owner,
      mint: after.mint,
      amountBeforeAtomic: before.amount.toString(),
      amountAfterAtomic: after.amount.toString(),
      amountDeltaAtomic: (after.amount - before.amount).toString(),
      decimals: after.decimals ?? before.decimals ?? null,
    };
  }).filter((entry) => entry.amountDeltaAtomic !== "0")
    .sort((left, right) => `${left.mint}:${left.owner}`.localeCompare(`${right.mint}:${right.owner}`));
}

function finding(severity, code, message) {
  return { severity, code, message };
}

function emptyResult(request, state, now) {
  const notFound = state === "not_found";
  return {
    ok: notFound,
    product: "samedaydesk-solana-transaction-receipt",
    version: "1.0.0",
    checkedAt: now().toISOString(),
    decision: state,
    request,
    chain: { name: "Solana mainnet", network: "solana:mainnet", canonicalUsdc: CANONICAL_SOLANA_USDC },
    transaction: { signature: request.signature, status: "unavailable" },
    receipt: { found: false, finalized: false, tokenOwnerDeltaCount: 0, canonicalUsdcDeltaCount: 0 },
    tokenOwnerDeltas: [],
    canonicalUsdcOwnerDeltas: [],
    verification: { requested: Boolean(request.recipient), matched: false },
    findings: [finding(notFound ? "info" : "error", state, notFound
      ? "No finalized transaction exists for this signature at check time."
      : "The bounded public Solana RPC set could not return the transaction.")],
    boundary: boundary(),
  };
}

function boundary() {
  return {
    source: "bounded public Solana mainnet finalized transaction RPC",
    rawInstructionsReturned: false,
    rawLogsReturned: false,
    privateLedgerRead: false,
    walletAccessed: false,
    transactionSigned: false,
    transactionBroadcast: false,
    transactionModified: false,
  };
}

export async function solanaTransactionReceipt(input, {
  fetchImpl = fetch,
  now = () => new Date(),
  rpcUrls = DEFAULT_RPC_URLS,
} = {}) {
  const request = normalizeSolanaTransactionReceiptInput(input);
  const fetched = await rpcTransaction(request.signature, { fetchImpl, rpcUrls });
  if (fetched.state !== "found") return emptyResult(request, fetched.state, now);

  const transaction = fetched.transaction;
  const meta = transaction?.meta || {};
  const deltas = ownerDeltas(meta);
  const usdcDeltas = deltas.filter((entry) => entry.mint === CANONICAL_SOLANA_USDC);
  const requested = Boolean(request.recipient);
  const findings = [];
  let matched = false;
  if (requested) {
    const expected = request.amountAtomic == null ? null : BigInt(request.amountAtomic);
    const recipientDelta = deltas.find((entry) => entry.mint === request.mint && entry.owner === request.recipient);
    const recipientAmount = BigInt(recipientDelta?.amountDeltaAtomic || "0");
    const recipientMatches = expected == null ? recipientAmount > 0n : recipientAmount === expected;
    const payerDelta = request.payer
      ? deltas.find((entry) => entry.mint === request.mint && entry.owner === request.payer)
      : null;
    const payerMatches = !request.payer || BigInt(payerDelta?.amountDeltaAtomic || "0") === -expected;
    matched = meta.err == null && recipientMatches && payerMatches;
    if (!recipientMatches) findings.push(finding("error", "recipient_amount_mismatch", "The finalized token-owner delta does not match the requested recipient and amount."));
    if (!payerMatches) findings.push(finding("error", "payer_amount_mismatch", "The finalized token-owner delta does not match the requested payer debit."));
    if (meta.err != null) findings.push(finding("error", "transaction_failed", "The transaction is finalized but execution failed."));
  }

  return {
    ok: true,
    product: "samedaydesk-solana-transaction-receipt",
    version: "1.0.0",
    checkedAt: now().toISOString(),
    decision: requested ? (matched ? "verified" : "not_verified") : "found",
    request,
    chain: { name: "Solana mainnet", network: "solana:mainnet", canonicalUsdc: CANONICAL_SOLANA_USDC },
    transaction: {
      signature: request.signature,
      status: meta.err == null ? "success" : "failed",
      slot: String(transaction.slot ?? ""),
      blockTime: Number.isInteger(transaction.blockTime) ? new Date(transaction.blockTime * 1_000).toISOString() : null,
      feeLamports: String(meta.fee ?? 0),
    },
    receipt: {
      found: true,
      finalized: true,
      tokenOwnerDeltaCount: deltas.length,
      canonicalUsdcDeltaCount: usdcDeltas.length,
    },
    tokenOwnerDeltas: deltas,
    canonicalUsdcOwnerDeltas: usdcDeltas,
    verification: { requested, matched },
    findings,
    boundary: boundary(),
  };
}

export { CANONICAL_SOLANA_USDC, MAX_RPC_BYTES };
