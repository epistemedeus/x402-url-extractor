import { createHash } from "node:crypto";
import { LIVE_BATCH_PRODUCT, LIVE_BATCH_SCHEMA_VERSION } from "../../../examples/customer-x402/src/constants.mjs";

const MONITOR_FIELDS = Object.freeze(["title", "description", "headings", "text"]);

export function monitorFields() {
  return MONITOR_FIELDS;
}

function jobIdFor(label, bytes) {
  return createHash("sha256").update(label).update("\0").update(bytes).digest("hex");
}

function envelope(body, { pageUrl, status, bytes, error, capture, fetchedAt, bodySha256, httpStatus }) {
  const failed = status !== "success";
  return {
    ok: !failed,
    product: LIVE_BATCH_PRODUCT,
    schemaVersion: LIVE_BATCH_SCHEMA_VERSION,
    quote: {
      amountAtomic: "0",
      displayUsdc: "0",
      meaning: "Laboratory batch envelope required by the existing monitor. This prototype does not price or charge.",
    },
    jobId: jobIdFor(failed ? `failure:${error?.code ?? "read"}` : "success", bytes),
    jobStatus: failed ? "completed_with_unknown" : "completed",
    stopReason: failed ? (error?.code ?? "read_failed") : null,
    partial: failed,
    sources: [
      {
        id: "advisory-page",
        source: pageUrl,
        status,
        data: body,
        notes: [],
        error,
        provenance: {
          transport: "pinned-fixture",
          networkSent: false,
          officialLiveRead: false,
          finalUrl: pageUrl,
          httpStatus: Number.isInteger(httpStatus) ? httpStatus : null,
          fetchedAt: fetchedAt ?? null,
          bodySha256,
          capture: capture ?? null,
        },
      },
    ],
    accounting: {
      requests: 1,
      bytes: bytes.length,
      wallMs: null,
      retries: 0,
      succeeded: failed ? 0 : 1,
      partial: 0,
      failed: failed ? 1 : 0,
      unknown: 0,
      skippedDuplicate: 0,
    },
    costInputs: {
      admittedBodyBytes: bytes.length,
      requests: 1,
      wallMs: null,
      hostingCosts: "unknown",
      modelCosts: "none",
      monetaryMargin: null,
    },
    charged: false,
    boundary: {
      guaranteedUrlSuccess: false,
      introductoryPrice: false,
      sourceFetchBeforeAuthorization: false,
      automaticRetries: false,
      laboratory: true,
      livePricing: false,
    },
  };
}

export function successBatch({ extract, pageUrl, bytes, bodySha256 }) {
  return envelope(
    {
      title: extract.title,
      description: extract.description,
      headings: extract.headings,
      text: extract.text,
    },
    {
      pageUrl,
      status: "success",
      bytes,
      error: null,
      capture: extract.capture,
      fetchedAt: extract.fetchedAt,
      bodySha256,
      httpStatus: extract.status,
    },
  );
}

export function failureBatch({ pageUrl, bytes, code, message, httpStatus = null }) {
  return envelope(null, {
    pageUrl,
    status: "failure",
    bytes,
    error: { code, message },
    capture: null,
    fetchedAt: null,
    bodySha256: null,
    httpStatus,
  });
}

export function asSnapshot(batch) {
  return { mediaType: "application/json", body: batch, observedAt: null };
}
