import {
  createPublicClient,
  decodeEventLog,
  fallback,
  getAddress,
  http,
  parseAbiItem,
} from "viem";
import { base } from "viem/chains";
import { z } from "zod";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ATOMIC_AMOUNT_PATTERN = /^[1-9][0-9]{0,20}$/;
const MAX_ATOMIC_AMOUNT = 1_000_000_000_000_000n;
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const DEFAULT_RPC_URLS = (process.env.MORPHO_BASE_RPC_URLS || "https://mainnet.base.org,https://base-rpc.publicnode.com")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export class SettlementProofError extends Error {
  constructor(message, { code = "invalid_settlement_request" } = {}) {
    super(message);
    this.name = "SettlementProofError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new SettlementProofError(message, { code });
}

function displayUsdc(amountAtomic) {
  const padded = String(amountAtomic).padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function normalizeSettlementProofInput(input = {}) {
  const transactionHash = String(input?.transactionHash || input?.tx || input?.hash || "").trim().toLowerCase();
  if (!TRANSACTION_HASH_PATTERN.test(transactionHash)) {
    fail("transactionHash must be a 32-byte 0x-prefixed transaction hash", "invalid_transaction_hash");
  }

  let recipient;
  try {
    recipient = getAddress(String(input?.recipient || input?.payTo || "").trim());
  } catch {
    fail("recipient must be a valid EVM address", "invalid_recipient");
  }

  const amountAtomic = String(input?.amountAtomic || input?.amount || "").trim();
  if (!ATOMIC_AMOUNT_PATTERN.test(amountAtomic) || BigInt(amountAtomic) > MAX_ATOMIC_AMOUNT) {
    fail("amountAtomic must be a positive canonical-USDC atomic amount at most 1000000000000000", "invalid_amount");
  }

  let payer = null;
  if (input?.payer !== undefined && input?.payer !== null && String(input.payer).trim()) {
    try {
      payer = getAddress(String(input.payer).trim());
    } catch {
      fail("payer must be a valid EVM address when provided", "invalid_payer");
    }
  }

  return { transactionHash, recipient, amountAtomic, payer };
}

function decodeUsdcTransfers(receipt) {
  return (receipt?.logs || []).flatMap((log) => {
    if (String(log?.address || "").toLowerCase() !== BASE_USDC.toLowerCase()) return [];
    try {
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (decoded.eventName !== "Transfer") return [];
      return [{
        from: getAddress(decoded.args.from),
        to: getAddress(decoded.args.to),
        amountAtomic: BigInt(decoded.args.value),
      }];
    } catch {
      return [];
    }
  });
}

function finding(code, message) {
  return { severity: "error", code, message };
}

function defaultClient(rpcUrls = DEFAULT_RPC_URLS) {
  return createPublicClient({
    chain: base,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 10_000 }))),
  });
}

export async function settlementProof(input, {
  client,
  now = () => new Date(),
  rpcUrls = DEFAULT_RPC_URLS,
} = {}) {
  const request = normalizeSettlementProofInput(input);
  const publicClient = client || defaultClient(rpcUrls);
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: request.transactionHash });
  } catch {
    return {
      ok: false,
      product: "samedaydesk-base-usdc-settlement-proof",
      version: "1.0.0",
      checkedAt: now().toISOString(),
      decision: "receipt_unavailable",
      request,
      chain: { id: 8453, name: "Base mainnet", network: "eip155:8453" },
      asset: { address: getAddress(BASE_USDC), symbol: "USDC", decimals: 6 },
      transaction: { hash: request.transactionHash, status: "unavailable" },
      settlement: { verified: false, exactTransferCount: 0, recipientTransferCount: 0 },
      findings: [finding("receipt_unavailable", "The Base transaction receipt was unavailable from the bounded RPC set.")],
      boundary: {
        source: "public Base mainnet receipt and logs",
        privateLedgerRead: false,
        auditedTransactionModified: false,
        walletAccessed: false,
        executionAuthorized: false,
      },
    };
  }

  const transfers = decodeUsdcTransfers(receipt);
  const recipientTransfers = transfers.filter((entry) => entry.to === request.recipient);
  const amountMatches = recipientTransfers.filter((entry) => entry.amountAtomic === BigInt(request.amountAtomic));
  const exactMatches = amountMatches.filter((entry) => !request.payer || entry.from === request.payer);
  const findings = [];

  if (receipt?.status !== "success") {
    findings.push(finding("transaction_unsuccessful", "The transaction receipt is not successful."));
  } else if (recipientTransfers.length === 0) {
    findings.push(finding("recipient_not_paid", "No canonical Base USDC transfer to the expected recipient was found."));
  } else if (amountMatches.length === 0) {
    findings.push(finding("amount_mismatch", "Canonical Base USDC reached the expected recipient, but not in the expected atomic amount."));
  } else if (request.payer && exactMatches.length === 0) {
    findings.push(finding("payer_mismatch", "The recipient and amount match, but the transfer payer does not."));
  } else if (exactMatches.length !== 1) {
    findings.push(finding("ambiguous_exact_transfer", "The transaction contains more than one transfer matching every expected field."));
  }

  let blockTimestamp = null;
  try {
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    blockTimestamp = new Date(Number(block.timestamp) * 1_000).toISOString();
  } catch {
    findings.push(finding("block_unavailable", "The receipt was found, but its Base block timestamp was unavailable."));
  }

  const verified = findings.length === 0 && exactMatches.length === 1;
  const observed = exactMatches.length === 1
    ? {
        payer: exactMatches[0].from,
        recipient: exactMatches[0].to,
        amountAtomic: exactMatches[0].amountAtomic.toString(),
        amountUsdc: displayUsdc(exactMatches[0].amountAtomic),
      }
    : null;

  return {
    ok: true,
    product: "samedaydesk-base-usdc-settlement-proof",
    version: "1.0.0",
    checkedAt: now().toISOString(),
    decision: verified ? "verified" : "not_verified",
    request,
    chain: { id: 8453, name: "Base mainnet", network: "eip155:8453" },
    asset: { address: getAddress(BASE_USDC), symbol: "USDC", decimals: 6 },
    transaction: {
      hash: request.transactionHash,
      status: receipt?.status || "unknown",
      blockNumber: String(receipt?.blockNumber ?? ""),
      blockTimestamp,
    },
    settlement: {
      verified,
      exactTransferCount: exactMatches.length,
      recipientTransferCount: recipientTransfers.length,
      observed,
    },
    findings,
    boundary: {
      source: "public Base mainnet receipt and logs",
      privateLedgerRead: false,
      auditedTransactionModified: false,
      walletAccessed: false,
      executionAuthorized: false,
    },
  };
}

const settlementProofRequestSchema = z.object({
  transactionHash: z.string(),
  recipient: z.string(),
  amountAtomic: z.string(),
  payer: z.string().nullable(),
}).strict();

const settlementProofChainSchema = z.object({
  id: z.literal(8453),
  name: z.literal("Base mainnet"),
  network: z.literal("eip155:8453"),
}).strict();

const settlementProofAssetSchema = z.object({
  address: z.string(),
  symbol: z.literal("USDC"),
  decimals: z.literal(6),
}).strict();

const settlementProofFindingSchema = z.object({
  severity: z.literal("error"),
  code: z.string(),
  message: z.string(),
}).strict();

const settlementProofBoundarySchema = z.object({
  source: z.literal("public Base mainnet receipt and logs"),
  privateLedgerRead: z.literal(false),
  auditedTransactionModified: z.literal(false),
  walletAccessed: z.literal(false),
  executionAuthorized: z.literal(false),
}).strict();

const settlementProofObservedSchema = z.object({
  payer: z.string(),
  recipient: z.string(),
  amountAtomic: z.string(),
  amountUsdc: z.string(),
}).strict();

export const settlementProofMcpOutputSchema = z.object({
  ok: z.boolean(),
  product: z.literal("samedaydesk-base-usdc-settlement-proof"),
  version: z.literal("1.0.0"),
  checkedAt: z.string().datetime(),
  decision: z.enum(["verified", "not_verified", "receipt_unavailable"]),
  request: settlementProofRequestSchema,
  chain: settlementProofChainSchema,
  asset: settlementProofAssetSchema,
  transaction: z.object({
    hash: z.string(),
    status: z.string(),
    blockNumber: z.string().optional(),
    blockTimestamp: z.string().datetime().nullable().optional(),
  }).strict(),
  settlement: z.object({
    verified: z.boolean(),
    exactTransferCount: z.number().int().nonnegative(),
    recipientTransferCount: z.number().int().nonnegative(),
    observed: settlementProofObservedSchema.nullable().optional(),
  }).strict(),
  findings: z.array(settlementProofFindingSchema),
  boundary: settlementProofBoundarySchema,
}).strict();

export { BASE_USDC };
