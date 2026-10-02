import { evaluateReceipt, verifyReceipt } from "./consumer.mjs";
import { consumeJournalEvidence, journalTarget } from "./journal-consumer.mjs";
import { digest, keys } from "./value.mjs";

export async function composeDelivery(receipt, options = {}) {
  keys(options, ["journalOwner", "now", "cohort"], []);
  const { journalOwner = null, now = Date.now(), cohort = "owner_qa" } = options;
  if (journalOwner) keys(journalOwner, ["dataDir", "internalToken", "causalEventProof"]);
  const checked = verifyReceipt(receipt);
  const delivery = evaluateReceipt(checked, { now });
  const journalEvidence = journalOwner ? await consumeJournalEvidence(journalTarget(checked, { cohort }), journalOwner) : null;
  const applicable = journalEvidence?.binding === "bound"
    && journalEvidence.scopeDigest === digest(journalTarget(checked, { cohort }));
  return {
    schema: "samedaydesk.service-delivery.composition.v1",
    contractDigest: checked.contractDigest, delivery,
    transactionSettlement: { state: applicable ? journalEvidence.settlement : "unknown", authority: applicable ? journalEvidence.authority : "none" },
    schemaDelivery: applicable ? journalEvidence.schemaDelivery : "unknown",
    schemaDeliveryScope: "retained_journal_record_only", currentUsefulnessFromJournal: "unknown",
    usefulDelivery: delivery.usefulOutput,
    journalCoverage: applicable ? journalEvidence.coverage : "unknown",
    journalCorrectionObserved: applicable ? journalEvidence.correctionObserved : "unknown",
    journalApplicable: applicable, serviceContractFulfilled: delivery.verdict === "fulfilled",
    makeGood: delivery.makeGood, financialAction: "none", paymentPermitted: false,
    requesterUsefulness: "unknown", customerCount: "unknown", revenue: "unknown", savings: "unknown",
  };
}
