import { createHash } from "node:crypto";

import {
  authorizeOutcomeBinding,
  buildTaskRefRecord,
  openCausalCommerceEvent,
  sealCausalCommerceEvent,
  stableForwardEventId,
} from "../../../commerce-outcome-binding.mjs";
import { COMMERCE_BINDING_301, PRICE_SCHEMA, SKILLGUARD } from "./pins.mjs";

function digest(text) {
  return createHash("sha256").update(text).digest("hex");
}

// Unpublished price experiment. Cash stays unknown. The free CLI remains the
// direct baseline. A sealed server task ref is the 301 causal seam; a caller
// event id, receipt, or HTTP 200 does not bind the task.
export function proposePrice({ internalToken, taskId, callerEventId = null, receipt = null, measurement = null }) {
  const claim = internalToken
    ? authorizeOutcomeBinding({
      "x-samedaydesk-internal": internalToken,
      "x-samedaydesk-outcome-operation": COMMERCE_BINDING_301.operationId,
      "x-samedaydesk-outcome-cohort": COMMERCE_BINDING_301.cohort,
      "x-samedaydesk-outcome-task": taskId,
    }, internalToken)
    : null;
  const minted = stableForwardEventId(`${COMMERCE_BINDING_301.operationId}\0${taskId}\0price-proposal`);
  const sealed = claim ? sealCausalCommerceEvent(minted, internalToken) : null;
  const opened = sealed ? openCausalCommerceEvent(sealed, internalToken) : null;
  const callerOpened = openCausalCommerceEvent(typeof callerEventId === "string" ? callerEventId : "", internalToken || "");
  const receiptBound = openCausalCommerceEvent(typeof receipt === "string" ? receipt : "", internalToken || "");
  const record = claim && opened ? buildTaskRefRecord({ claim, commerceEventId: opened }) : null;
  return {
    schema: PRICE_SCHEMA,
    published: false,
    skuAdded: false,
    paymentPerformed: false,
    paymentSent: false,
    priceChanged: false,
    recognizedRevenueAtomic: "0",
    cash: "unknown",
    tokens: "unknown",
    profit: "unknown",
    freeBaseline: {
      command: "npx github:epistemedeus/skillguard <local-tree>",
      priceAtomic: "0",
      scannerCommit: SKILLGUARD.commit,
      note: "The direct static CLI is the free alternative. Its exit codes stay 0, 2, and 3.",
    },
    hostedConvenience: {
      proposed: true,
      route: "POST /commerce/scoped-surface-scan",
      priceAtomic: null,
      priceDisplay: "unknown",
      delta: "Bounded inventory intake and a scoped report without installing the scanner.",
      worthPaying: "unknown",
    },
    repairIncrement: {
      proposed: true,
      route: "POST /commerce/scoped-surface-retest",
      separateFromScan: true,
      priceAtomic: null,
      priceDisplay: "unknown",
      delta: "Independent rerun of the same concern on caller-supplied changed bytes, plus an explicitly shared regression.",
    },
    notEstablished: "A free scan existing is not evidence that the hosted or repair delta is worth paying.",
    binding: record ? {
      schemaVersion: record.schemaVersion,
      operationId: record.operationId,
      cohort: record.cohort,
      taskRef: record.taskRef,
      commerceEventId: record.commerceEventId,
      writerId: record.writerId,
      callerEventBound: false,
      callerEventOpened: callerOpened !== null,
      receiptBound: receiptBound !== null,
      sealDigest: digest(sealed),
    } : {
      bound: false,
      callerEventBound: false,
      receiptBound: false,
    },
    unsignedReportIsWork: false,
    http200IsWork: false,
    paidReceiptIsLaterAuthority: false,
    measurement: measurement || {
      wallMs: null,
      cpuUserMicros: null,
      requesterPrepMicros: null,
      contributorPrepMicros: null,
      cash: "unknown",
      tokens: "unknown",
      profit: "unknown",
    },
  };
}
