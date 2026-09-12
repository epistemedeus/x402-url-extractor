import { extractBatchOutputSchema } from "../extract-batch.mjs";
import { extractMcpOutputSchema, readMcpOutputSchema } from "../extract.mjs";
import { lockfilePinDeltaOutputSchema } from "../lockfile-pin-delta.mjs";
import { isVendorBudgetImpactEnabled } from "../vendor-budget-impact-config.mjs";
const { vendorBudgetImpactOutputSchema } = isVendorBudgetImpactEnabled()
  ? await import("../vendor-budget-impact.mjs") : {};
import { bindOwningContracts, resetOwningContracts } from "./contract.mjs";

let bound = false;

/** Bind live same-repo HTTP success contracts. Production truth is these exports, not generated JSON. */
export function bindMerchantHttpDeliveryContracts({ vendorBudgetSchema = vendorBudgetImpactOutputSchema } = {}) {
  if (bound) return;
  bindOwningContracts({
    extractSuccessParse: (value) => extractMcpOutputSchema.safeParse(value),
    readSuccessParse: (value) => readMcpOutputSchema.safeParse(value),
    batchHttpParse: () => extractBatchOutputSchema(),
    lockfileHttpParse: () => lockfilePinDeltaOutputSchema(),
    vendorBudgetHttpParse: vendorBudgetSchema ? () => vendorBudgetSchema() : undefined,
  });
  bound = true;
}

export function resetMerchantHttpDeliveryContracts() {
  bound = false;
  resetOwningContracts();
}
