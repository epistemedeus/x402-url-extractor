import {
  createPublicClient,
  decodeEventLog,
  fallback,
  getAddress,
  http,
  parseAbiItem,
} from "viem";
import { base, mainnet } from "viem/chains";

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const MAX_DECODED_TRANSFERS = 100;

const NETWORKS = Object.freeze({
  base: Object.freeze({
    chain: base,
    chainId: 8453,
    name: "Base mainnet",
    caip2: "eip155:8453",
    canonicalUsdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpcUrls: (process.env.TRANSACTION_RECEIPT_BASE_RPC_URLS || process.env.MORPHO_BASE_RPC_URLS || "https://mainnet.base.org,https://base-rpc.publicnode.com")
      .split(",").map((value) => value.trim()).filter(Boolean),
  }),
  ethereum: Object.freeze({
    chain: mainnet,
    chainId: 1,
    name: "Ethereum mainnet",
    caip2: "eip155:1",
    canonicalUsdc: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    rpcUrls: (process.env.TRANSACTION_RECEIPT_ETHEREUM_RPC_URLS || "https://ethereum-rpc.publicnode.com,https://cloudflare-eth.com")
      .split(",").map((value) => value.trim()).filter(Boolean),
  }),
});

export class TransactionReceiptError extends Error {
  constructor(message, { code = "invalid_transaction_receipt_request" } = {}) {
    super(message);
    this.name = "TransactionReceiptError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new TransactionReceiptError(message, { code });
}

function safeAddress(value) {
  if (!value) return null;
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

function displayUsdc(amountAtomic) {
  const padded = String(amountAtomic).padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function finding(severity, code, message) {
  return { severity, code, message };
}

export function normalizeTransactionReceiptInput(input = {}) {
  const transactionHash = String(input?.transactionHash || input?.tx || input?.hash || "").trim().toLowerCase();
  if (!TRANSACTION_HASH_PATTERN.test(transactionHash)) {
    fail("transactionHash must be a 32-byte 0x-prefixed transaction hash", "invalid_transaction_hash");
  }
  const network = String(input?.network || "base").trim().toLowerCase();
  if (!Object.hasOwn(NETWORKS, network)) {
    fail("network must be base or ethereum", "unsupported_network");
  }
  return { transactionHash, network };
}

function defaultClient(config, rpcUrls = config.rpcUrls) {
  if (!Array.isArray(rpcUrls) || !rpcUrls.length) fail("No public RPC URLs are configured", "rpc_unavailable");
  return createPublicClient({
    chain: config.chain,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 10_000 }))),
  });
}

function decodeTransfers(receipt, canonicalUsdc) {
  const decoded = [];
  for (const log of receipt?.logs || []) {
    if (decoded.length >= MAX_DECODED_TRANSFERS) break;
    try {
      const event = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (event.eventName !== "Transfer") continue;
      const token = safeAddress(log.address);
      const amountAtomic = BigInt(event.args.value);
      const isCanonicalUsdc = token?.toLowerCase() === canonicalUsdc.toLowerCase();
      decoded.push({
        token,
        from: safeAddress(event.args.from),
        to: safeAddress(event.args.to),
        amountAtomic: amountAtomic.toString(),
        canonicalUsdc: isCanonicalUsdc,
        ...(isCanonicalUsdc ? { amountUsdc: displayUsdc(amountAtomic) } : {}),
        logIndex: log.logIndex === undefined || log.logIndex === null ? null : String(log.logIndex),
      });
    } catch {
      // Non-standard or unrelated logs are intentionally excluded.
    }
  }
  return decoded;
}

function boundary(config) {
  return {
    source: `bounded public ${config.name} receipt and block RPC`,
    rawLogsReturned: false,
    privateLedgerRead: false,
    walletAccessed: false,
    transactionSigned: false,
    transactionBroadcast: false,
    transactionModified: false,
  };
}

export async function transactionReceipt(input, {
  client,
  now = () => new Date(),
  rpcUrls,
} = {}) {
  const request = normalizeTransactionReceiptInput(input);
  const config = NETWORKS[request.network];
  const publicClient = client || defaultClient(config, rpcUrls || config.rpcUrls);
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: request.transactionHash });
  } catch (error) {
    const notFound = /(?:transactionreceipt)?notfound/i.test(String(error?.name || "")) || /could not be found/i.test(String(error?.message || ""));
    return {
      ok: notFound,
      product: "samedaydesk-transaction-receipt",
      version: "1.0.0",
      checkedAt: now().toISOString(),
      decision: notFound ? "not_found" : "rpc_unavailable",
      request,
      chain: { id: config.chainId, name: config.name, network: config.caip2 },
      transaction: { hash: request.transactionHash, status: "unavailable" },
      receipt: { found: false, logCount: 0, decodedTransferCount: 0, transfersTruncated: false },
      transfers: [],
      canonicalUsdcTransfers: [],
      findings: [finding(notFound ? "info" : "error", notFound ? "receipt_not_found" : "rpc_unavailable", notFound
        ? "No mined transaction receipt exists for this hash on the selected network at check time."
        : "The bounded public RPC set could not return a transaction receipt.")],
      boundary: boundary(config),
    };
  }

  const findings = [];
  let blockTimestamp = null;
  try {
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    blockTimestamp = new Date(Number(block.timestamp) * 1_000).toISOString();
  } catch {
    findings.push(finding("warning", "block_timestamp_unavailable", "The receipt was found, but its block timestamp was unavailable from the bounded RPC set."));
  }

  const transfers = decodeTransfers(receipt, config.canonicalUsdc);
  const canonicalUsdcTransfers = transfers.filter((entry) => entry.canonicalUsdc);
  const gasUsed = BigInt(receipt.gasUsed || 0n);
  const effectiveGasPrice = BigInt(receipt.effectiveGasPrice || 0n);
  const logCount = Array.isArray(receipt.logs) ? receipt.logs.length : 0;
  const transfersTruncated = transfers.length >= MAX_DECODED_TRANSFERS && logCount > transfers.length;

  return {
    ok: true,
    product: "samedaydesk-transaction-receipt",
    version: "1.0.0",
    checkedAt: now().toISOString(),
    decision: "found",
    request,
    chain: { id: config.chainId, name: config.name, network: config.caip2 },
    transaction: {
      hash: request.transactionHash,
      status: receipt.status || "unknown",
      blockNumber: String(receipt.blockNumber ?? ""),
      blockHash: receipt.blockHash || null,
      blockTimestamp,
      transactionIndex: receipt.transactionIndex === undefined || receipt.transactionIndex === null ? null : String(receipt.transactionIndex),
      from: safeAddress(receipt.from),
      to: safeAddress(receipt.to),
      contractAddress: safeAddress(receipt.contractAddress),
      type: receipt.type || null,
      gasUsedAtomic: gasUsed.toString(),
      effectiveGasPriceWei: effectiveGasPrice.toString(),
      transactionFeeWei: (gasUsed * effectiveGasPrice).toString(),
    },
    receipt: {
      found: true,
      logCount,
      decodedTransferCount: transfers.length,
      canonicalUsdcTransferCount: canonicalUsdcTransfers.length,
      transfersTruncated,
    },
    transfers,
    canonicalUsdcTransfers,
    findings,
    boundary: boundary(config),
  };
}

export { MAX_DECODED_TRANSFERS, NETWORKS };
