import { parseContract } from "./contract.mjs";
import { executePrepared, prepareDelivery, publicSummary, validateLater, verifyReceipt } from "./consumer.mjs";
import { readJsonFile, reserveReceipt, completeReceipt } from "./receipt-file.mjs";
import { assert, digest } from "./value.mjs";
import { serviceOrigin } from "./transport.mjs";

// Public caller entry: one private receipt file is the recovery identity.
// An existing operation is inspected; its HTTP request is never resent.
export async function runCallerDelivery({ contract: raw, origin, receipt, prior = null }, options = {}) {
  const contract = parseContract(raw);
  if (prior) verifyReceipt(prior);
  const checkedOrigin = serviceOrigin(origin, options);
  try {
    const existing = verifyReceipt(await readJsonFile(receipt));
    assert(existing.contractDigest === digest(contract) && existing.origin === checkedOrigin, "receipt_scope_conflict");
    return { ...publicSummary(existing), recoveredExistingReceipt: true };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const prepared = prepareDelivery(contract, checkedOrigin, options);
  const reservation = await reserveReceipt(receipt, prepared);
  if (!reservation.acquired) return { ...publicSummary(reservation.receipt), recoveredExistingReceipt: true };
  let current; let comparison;
  if (prior) {
    comparison = await validateLater(prior, contract, checkedOrigin, { ...options, prepared });
    current = comparison.current;
  } else current = await executePrepared(prepared, options);
  await completeReceipt(receipt, prepared, current);
  return { ...publicSummary(current), evaluationScope: "fresh_readback", currentValidationPerformed: true,
    ...(comparison ? { relation: comparison.relation, priorMayApply: false, rightsInherited: false, settlementInherited: false } : {}) };
}
