import { evaluateReceipt, verifyReceipt } from "./consumer.mjs";
import { journalTarget } from "./journal-consumer.mjs";
import { digest } from "./value.mjs";

export function composeDelivery(receipt, journalEvidence = null, { now = Date.now(), cohort = "owner_qa" } = {}) {
  const checked = verifyReceipt(receipt);
  const delivery = evaluateReceipt(checked, { now });
  const applicable = journalEvidence?.binding === "bound"
    && journalEvidence.scopeDigest === digest(journalTarget(checked, { cohort }));
  return {
    schema: "samedaydesk.service-delivery.composition.v1",
    contractDigest: checked.contractDigest, delivery,
    transactionSettlement: { state: applicable ? journalEvidence.settlement : "unknown", authority: applicable ? journalEvidence.authority : "none" },
    schemaDelivery: applicable ? journalEvidence.schemaDelivery : "unknown",
    usefulDelivery: delivery.usefulOutput,
    journalCoverage: applicable ? journalEvidence.coverage : "unknown",
    journalApplicable: applicable, serviceContractFulfilled: delivery.verdict === "fulfilled",
    makeGood: delivery.makeGood, financialAction: "none", paymentPermitted: false,
    requesterUsefulness: "unknown", customerCount: "unknown", revenue: "unknown", savings: "unknown",
  };
}
