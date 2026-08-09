import { createHash, createHmac } from "node:crypto";
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  decodeEventLog,
  fallback,
  getAddress,
  http,
  parseAbiItem,
} from "viem";
import { base } from "viem/chains";

import { normalizeCommercePayerClasses } from "./commerce-events.mjs";

const SCHEMA_VERSION = "samedaydesk.commerce-settlement-reconciliation.v1";
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function parseLines(contents) {
  let invalidLines = 0;
  const records = String(contents || "").split("\n").filter(Boolean).flatMap((line) => {
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed] : [];
    } catch {
      invalidLines += 1;
      return [];
    }
  });
  return { invalidLines, records };
}

function payerClassByActor(secret, payerClasses) {
  return new Map([...normalizeCommercePayerClasses(payerClasses)].map(([address, paymentClass]) => [
    createHmac("sha256", secret).update(`payer:${address}`).digest("hex").slice(0, 24),
    paymentClass,
  ]));
}

function issue(code, subject) {
  return { code, subjectHash: `sha256:${sha256(subject).slice(0, 24)}` };
}

function decodeIncomingTransfers(receipt, { asset, treasury }) {
  return (receipt?.logs || []).flatMap((log) => {
    if (String(log?.address || "").toLowerCase() !== asset.toLowerCase()) return [];
    try {
      const decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics, strict: true });
      if (decoded.eventName !== "Transfer") return [];
      const to = getAddress(decoded.args.to);
      if (to !== treasury) return [];
      return [{
        from: getAddress(decoded.args.from),
        amountAtomic: BigInt(decoded.args.value),
      }];
    } catch {
      return [];
    }
  });
}

function addAmount(bucket, key, amount) {
  if (!bucket[key]) bucket[key] = { settlements: 0, amountAtomic: "0" };
  bucket[key].settlements += 1;
  bucket[key].amountAtomic = (BigInt(bucket[key].amountAtomic) + amount).toString();
}

export function summarizeCommerceSettlementLedger(contents) {
  const parsed = parseLines(contents);
  const byClass = Object.create(null);
  const byRoute = Object.create(null);
  const references = new Set();
  let reconciledSettlements = 0;
  let amountAtomic = 0n;
  for (const record of parsed.records) {
    if (record?.schemaVersion !== SCHEMA_VERSION || record?.state !== "reconciled") continue;
    if (!TRANSACTION_HASH_PATTERN.test(String(record.settlementReference || ""))) continue;
    if (!/^\d+$/.test(String(record.amountAtomic || ""))) continue;
    const reference = String(record.settlementReference).toLowerCase();
    if (references.has(reference)) continue;
    references.add(reference);
    const amount = BigInt(record.amountAtomic);
    reconciledSettlements += 1;
    amountAtomic += amount;
    addAmount(byClass, String(record.paymentClass || "unclassified"), amount);
    addAmount(byRoute, String(record.route || "/:unknown"), amount);
  }
  return {
    schemaVersion: "samedaydesk.commerce-settlement-summary.v1",
    reconciledSettlements,
    distinctSettlementReferences: references.size,
    amountAtomic: amountAtomic.toString(),
    byClass,
    byRoute,
    invalidLines: parsed.invalidLines,
  };
}

export async function reconcileCommerceSettlementEvents(eventContents, ledgerContents, {
  actorSecret,
  asset = BASE_USDC,
  client,
  network = "eip155:8453",
  payerClasses = "",
  settlementEvidenceSince,
  treasury,
  now = () => new Date(),
} = {}) {
  if (typeof actorSecret !== "string" || actorSecret.length < 16) fail("commerce actor secret is required for settlement reconciliation");
  if (network !== "eip155:8453") fail("commerce settlement reconciliation supports Base mainnet only");
  const normalizedAsset = getAddress(asset);
  if (normalizedAsset !== getAddress(BASE_USDC)) fail("commerce settlement reconciliation requires canonical Base USDC");
  const normalizedTreasury = getAddress(treasury);
  const sinceMs = Date.parse(settlementEvidenceSince);
  if (!Number.isFinite(sinceMs)) fail("settlement evidence baseline is required");
  if (!client?.getTransactionReceipt || !client?.getBlock) fail("Base public client is required");

  const events = parseLines(eventContents);
  const existing = parseLines(ledgerContents);
  const existingReferences = new Set(existing.records
    .map((record) => String(record?.settlementReference || "").toLowerCase())
    .filter((reference) => TRANSACTION_HASH_PATTERN.test(reference)));
  const classesByActor = payerClassByActor(actorSecret, payerClasses);
  const grouped = new Map();
  for (const event of events.records) {
    if (event?.result !== "paid_success" || Date.parse(event.ts) < sinceMs) continue;
    const reference = String(event.settlementReference || "").toLowerCase();
    if (!TRANSACTION_HASH_PATTERN.test(reference)) continue;
    if (!grouped.has(reference)) grouped.set(reference, []);
    grouped.get(reference).push(event);
  }

  const issues = [];
  const newRecords = [];
  let alreadyReconciled = 0;
  for (const [reference, matchingEvents] of grouped) {
    if (existingReferences.has(reference)) {
      alreadyReconciled += 1;
      continue;
    }
    if (matchingEvents.length !== 1) {
      issues.push(issue("duplicate_paid_event_reference", reference));
      continue;
    }
    const event = matchingEvents[0];
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: reference });
    } catch {
      issues.push(issue("receipt_unavailable", reference));
      continue;
    }
    if (receipt?.status !== "success") {
      issues.push(issue("transaction_unsuccessful", reference));
      continue;
    }
    const transfers = decodeIncomingTransfers(receipt, { asset: normalizedAsset, treasury: normalizedTreasury });
    if (transfers.length !== 1) {
      issues.push(issue("treasury_transfer_count_mismatch", reference));
      continue;
    }
    const transfer = transfers[0];
    if (transfer.amountAtomic <= 0n) {
      issues.push(issue("transfer_amount_invalid", reference));
      continue;
    }
    if (event.settlementAmountAtomic !== null && event.settlementAmountAtomic !== undefined
      && String(transfer.amountAtomic) !== String(event.settlementAmountAtomic)) {
      issues.push(issue("response_amount_mismatch", reference));
      continue;
    }
    if (event.settlementNetwork && String(event.settlementNetwork).toLowerCase() !== network) {
      issues.push(issue("response_network_mismatch", reference));
      continue;
    }
    if (event.settlementCurrency && String(event.settlementCurrency).toLowerCase() !== normalizedAsset.toLowerCase()) {
      issues.push(issue("response_currency_mismatch", reference));
      continue;
    }
    if (event.settlementProtocol && event.paymentProtocol && event.settlementProtocol !== event.paymentProtocol) {
      issues.push(issue("response_protocol_mismatch", reference));
      continue;
    }
    const observedPaymentActor = createHmac("sha256", actorSecret)
      .update(`payer:${transfer.from.toLowerCase()}`)
      .digest("hex")
      .slice(0, 24);
    if (event.paymentActor && event.paymentActor !== observedPaymentActor) {
      issues.push(issue("payer_continuity_mismatch", reference));
      continue;
    }
    let block;
    try {
      block = await client.getBlock({ blockNumber: receipt.blockNumber });
    } catch {
      issues.push(issue("block_unavailable", reference));
      continue;
    }
    const paymentClass = classesByActor.get(event.paymentActor || observedPaymentActor) || "unclassified";
    newRecords.push({
      schemaVersion: SCHEMA_VERSION,
      reconciliationId: `sddsr_${sha256(`${event.id}|${reference}|${transfer.amountAtomic}`).slice(0, 40)}`,
      reconciledAt: now().toISOString(),
      state: "reconciled",
      sourceEventId: String(event.id || ""),
      sourceEventTimestamp: new Date(event.ts).toISOString(),
      route: String(event.route || "/:unknown"),
      protocol: String(event.paymentProtocol || event.settlementProtocol || "unknown"),
      paymentClass,
      settlementReference: reference,
      network,
      asset: normalizedAsset,
      treasury: normalizedTreasury,
      amountAtomic: transfer.amountAtomic.toString(),
      blockNumber: String(receipt.blockNumber),
      blockTimestamp: new Date(Number(block.timestamp) * 1_000).toISOString(),
      payerContinuity: event.paymentActor ? "matched_request_pseudonym" : "onchain_only",
    });
  }

  return {
    newRecords,
    issues,
    eligibleSettlementReferences: grouped.size,
    alreadyReconciled,
    invalidEventLines: events.invalidLines,
    invalidLedgerLines: existing.invalidLines,
  };
}

async function readExisting(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function issueCounts(issues) {
  const counts = Object.create(null);
  for (const item of issues || []) counts[item.code] = (counts[item.code] || 0) + 1;
  return counts;
}

export function createCommerceSettlementReconciler({
  actorSecret = process.env.COMMERCE_ACTOR_SECRET || "",
  asset = BASE_USDC,
  client,
  dataDir = process.env.COMMERCE_DATA_DIR || path.join(process.cwd(), "data"),
  eventPaths,
  network = process.env.NETWORK || "eip155:8453",
  payerClasses = process.env.COMMERCE_PAYER_CLASSES || "",
  rpcUrls = (process.env.MORPHO_BASE_RPC_URLS || "https://mainnet.base.org,https://base-rpc.publicnode.com").split(",").map((url) => url.trim()).filter(Boolean),
  settlementEvidenceSince = process.env.COMMERCE_SETTLEMENT_EVIDENCE_SINCE || "",
  treasury = process.env.PAY_TO || "",
} = {}) {
  const ledgerPath = path.join(dataDir, "commerce-settlements.ndjson");
  const paths = eventPaths || [
    path.join(dataDir, "commerce-events.1.ndjson"),
    path.join(dataDir, "commerce-events.ndjson"),
  ];
  const enabled = Boolean(
    actorSecret.length >= 16
    && Number.isFinite(Date.parse(settlementEvidenceSince))
    && /^0x[0-9a-fA-F]{40}$/.test(treasury)
    && network === "eip155:8453"
  );
  const publicClient = client || createPublicClient({
    chain: base,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 10_000 }))),
  });
  let lastRunAt = null;
  let lastError = null;
  let lastIssueCounts = {};
  let lastScan = {
    eligibleSettlementReferences: 0,
    alreadyReconciled: 0,
    reconciledThisRun: 0,
    issueCount: 0,
  };
  let running = Promise.resolve();

  async function status() {
    const ledger = await readExisting(ledgerPath);
    return {
      enabled,
      settlementEvidenceSince: Number.isFinite(Date.parse(settlementEvidenceSince))
        ? new Date(settlementEvidenceSince).toISOString()
        : null,
      lastRunAt,
      lastError,
      issues: lastIssueCounts,
      lastScan,
      ledger: summarizeCommerceSettlementLedger(ledger),
    };
  }

  async function reconcile() {
    if (!enabled) return status();
    running = running.then(async () => {
      try {
        const [eventParts, ledger] = await Promise.all([
          Promise.all(paths.map(readExisting)),
          readExisting(ledgerPath),
        ]);
        const result = await reconcileCommerceSettlementEvents(eventParts.join("\n"), ledger, {
          actorSecret,
          asset,
          client: publicClient,
          network,
          payerClasses,
          settlementEvidenceSince,
          treasury,
        });
        if (result.newRecords.length) {
          await mkdir(dataDir, { recursive: true, mode: 0o700 });
          await appendFile(ledgerPath, `${result.newRecords.map((record) => JSON.stringify(record)).join("\n")}\n`, {
            encoding: "utf8",
            mode: 0o600,
          });
          await chmod(ledgerPath, 0o600).catch(() => {});
        }
        lastRunAt = new Date().toISOString();
        lastError = null;
        lastIssueCounts = issueCounts(result.issues);
        lastScan = {
          eligibleSettlementReferences: result.eligibleSettlementReferences,
          alreadyReconciled: result.alreadyReconciled,
          reconciledThisRun: result.newRecords.length,
          issueCount: result.issues.length,
        };
      } catch (error) {
        lastRunAt = new Date().toISOString();
        console.error(`commerce settlement reconciliation failed: ${String(error?.message || error).slice(0, 200)}`);
        lastError = "reconciliation_failed";
      }
    });
    await running;
    return status();
  }

  function schedule(intervalMs = 60_000) {
    void reconcile();
    const timer = setInterval(() => void reconcile(), Math.max(15_000, Number(intervalMs) || 60_000));
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { enabled, ledgerPath, reconcile, schedule, status };
}

export { BASE_USDC, SCHEMA_VERSION };
