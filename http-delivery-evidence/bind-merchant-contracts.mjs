import { extractBatchOutputSchema } from "../extract-batch.mjs";
import { extractMcpOutputSchema, readMcpOutputSchema } from "../extract.mjs";
import { lockfilePinDeltaOutputSchema } from "../lockfile-pin-delta.mjs";
import { morphoPositionOutputSchema } from "../morpho-position.mjs";
import { sellerIntegrityAuditOutputSchema } from "../seller-integrity-audit.mjs";
import { bindOwningContracts, resetOwningContracts } from "./contract.mjs";

let bound = false;

/** Bind live same-repo HTTP success contracts. Production truth is these exports, not generated JSON. */
export function bindMerchantHttpDeliveryContracts() {
  if (bound) return;
  bindOwningContracts({
    extractSuccessParse: (value) => extractMcpOutputSchema.safeParse(value),
    readSuccessParse: (value) => readMcpOutputSchema.safeParse(value),
    batchHttpParse: () => extractBatchOutputSchema(),
    lockfileHttpParse: () => lockfilePinDeltaOutputSchema(),
    sellerIntegrityHttpParse: () => sellerIntegrityAuditOutputSchema(),
    morphoPositionHttpParse: () => morphoPositionOutputSchema(),
  });
  bound = true;
}

export function resetMerchantHttpDeliveryContracts() {
  bound = false;
  resetOwningContracts();
}
