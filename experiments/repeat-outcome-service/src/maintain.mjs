import { readFileSync } from "node:fs";
import { extract, readMarkdown } from "../../../extract.mjs";
import { EXTRACT_TEXT_EXCERPT_CHARS, READ_MARKDOWN_MAX_CHARS } from "../../../extract-excerpt-budget.mjs";
import { comparePageBatches } from "../../../examples/customer-x402/src/page-change/compare.mjs";
import { decidePin, sha256Text } from "./osv-pin.mjs";
import { agreeClaims, claimsFromText } from "./reader-claim.mjs";
import { asSnapshot, failureBatch, monitorFields, successBatch } from "./batch-envelope.mjs";

const COMPARE_LIMITS = Object.freeze({
  maxBytes: 524288,
  maxExcerptBytes: 180,
});

let hookTail = Promise.resolve();

function exclusive(fn) {
  const result = hookTail.then(fn, fn);
  hookTail = result.then(() => undefined, () => undefined);
  return result;
}

function asBytes(pageHtml) {
  if (pageHtml == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(pageHtml)) return pageHtml;
  if (pageHtml instanceof Uint8Array) return Buffer.from(pageHtml);
  return Buffer.from(String(pageHtml), "utf8");
}

async function withPinnedFetch(bytes, status, fn) {
  return exclusive(async () => {
    const previous = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
    globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input) => {
      const requested = String(input);
      let delivered = false;
      return {
        status,
        url: requested,
        headers: {
          get(name) {
            return String(name).toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null;
          },
        },
        body: {
          getReader() {
            return {
              async read() {
                if (delivered) return { done: true };
                delivered = true;
                return { done: false, value: bytes };
              },
              async cancel() {},
            };
          },
        },
      };
    };
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
      else globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = previous;
    }
  });
}

function evidenceAround(text, needle) {
  const source = text || "";
  const at = source.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return null;
  const start = Math.max(0, at - 60);
  return source.slice(start, start + 220);
}

async function readPinnedPage({ pageUrl, pageHtml, pageStatus, fetchError, pin }) {
  if (fetchError) {
    return {
      ok: false,
      attempts: 1,
      failures: 1,
      bodyBytes: 0,
      code: fetchError.code || "fetch_error",
      message: fetchError.message || "pinned fetch failed",
      ignoredClaim: null,
    };
  }
  const bytes = asBytes(pageHtml);
  try {
    const raised = await withPinnedFetch(bytes, pageStatus, () => extract(pageUrl, {
      textExcerptLimitChars: READ_MARKDOWN_MAX_CHARS,
    }));
    if (!raised.sourceOk) {
      return {
        ok: false,
        attempts: 1,
        failures: 1,
        bodyBytes: raised.capture?.bodyBytes ?? bytes.length,
        code: raised.error?.code || "source_not_ok",
        message: raised.error?.message || "source was not ok",
        ignoredClaim: claimsFromText(raised.text, pin),
        ignoredText: raised.text,
        capture: raised.capture,
        status: raised.status,
      };
    }
    const markdown = await withPinnedFetch(bytes, pageStatus, () => readMarkdown(pageUrl, READ_MARKDOWN_MAX_CHARS));
    return {
      ok: true,
      attempts: 2,
      failures: 0,
      bodyBytes: (raised.capture?.bodyBytes ?? 0) + (markdown.capture?.bodyBytes ?? 0),
      extract: raised,
      markdown,
      bytes,
    };
  } catch (error) {
    return {
      ok: false,
      attempts: 1,
      failures: 1,
      bodyBytes: bytes.length,
      code: error?.code || "fetch_error",
      message: error?.message || "reader failed",
      ignoredClaim: null,
    };
  }
}

function blankEffort() {
  return {
    reads: 0,
    readFailures: 0,
    directParses: 0,
    monitorCompares: 0,
    recoveries: 0,
    bodyBytes: 0,
    elapsedMs: 0,
    pricing: null,
    charged: false,
    ledgerWrite: false,
  };
}

function acceptState(direct, batch) {
  return {
    accepted: true,
    decision: direct.decision,
    affectingIds: direct.affectingIds,
    recordDigest: direct.recordDigest,
    batch: asSnapshot(batch),
  };
}

export async function maintainCycle({
  pin,
  osvDocument,
  pageUrl,
  pageHtml = null,
  pageStatus = 200,
  pageClass = "primary-capture",
  fetchError = null,
  previous = null,
}) {
  const started = process.hrtime.bigint();
  const effort = blankEffort();
  const direct = decidePin(osvDocument, pin);
  effort.directParses = 1;
  const read = await readPinnedPage({ pageUrl, pageHtml, pageStatus, fetchError, pin });
  effort.reads = read.attempts;
  effort.readFailures = read.failures;
  effort.bodyBytes = read.bodyBytes;

  const bytes = asBytes(pageHtml);
  const bodySha256 = pageHtml == null ? null : sha256Text(bytes);
  let batch;
  let agreement = { state: "unavailable", reasons: [], readerCoversEveryAffectingAdvisory: false, readerAdvisoryIds: [], readerAffectingIdsSeen: [] };
  let reader = null;
  if (read.ok) {
    const raisedClaims = claimsFromText(read.extract.text, pin);
    const defaultClaims = claimsFromText(read.extract.text.slice(0, EXTRACT_TEXT_EXCERPT_CHARS), pin);
    const markdownClaims = claimsFromText(read.markdown.markdown, pin);
    agreement = agreeClaims(raisedClaims, direct, pin);
    batch = successBatch({ extract: read.extract, pageUrl, bytes, bodySha256 });
    reader = {
      surface: "extract+readMarkdown",
      excerptBudgetChars: READ_MARKDOWN_MAX_CHARS,
      defaultExcerptChars: EXTRACT_TEXT_EXCERPT_CHARS,
      textTruncated: read.extract.capture.textTruncated,
      markdownTruncated: read.markdown.truncated,
      defaultExcerptCarriesRange: defaultClaims.hasRange,
      raisedExtractCarriesRange: raisedClaims.hasRange,
      markdownCarriesRange: markdownClaims.hasRange,
      agreement,
      browserAdapterQualifierSeen: read.extract.text.includes("Not affected: Browser adapters"),
      evidence: evidenceAround(read.extract.text, "Affected versions"),
      capture: read.extract.capture,
      markdownCapture: read.markdown.capture,
      bodySha256,
    };
  } else {
    batch = failureBatch({
      pageUrl,
      bytes,
      code: read.code,
      message: read.message,
      httpStatus: read.status ?? null,
    });
    reader = {
      surface: "extract",
      refused: true,
      code: read.code,
      message: read.message,
      httpStatus: read.status ?? null,
      ignoredClaim: read.ignoredClaim,
      ignoredEvidence: evidenceAround(read.ignoredText, "is not affected"),
      capture: read.capture ?? null,
    };
  }

  let monitor = null;
  if (previous?.batch) {
    monitor = await comparePageBatches(previous.batch, asSnapshot(batch), {
      fields: [...monitorFields()],
      allowFreshClaim: false,
      limits: COMPARE_LIMITS,
    });
    effort.monitorCompares = 1;
  }

  const recordChanged = Boolean(previous?.accepted) && previous.recordDigest !== direct.recordDigest;
  const pageContradicts = read.ok && agreement.state === "contradicts";
  const directUsable = direct.sufficient && direct.decision !== "unknown";
  let cycle;
  let decision;
  let affectingIds;
  let decisionSource;
  let recovered = false;
  let acceptedState;

  // A failed page cannot clear the pin. A usable OSV document still decides.
  // Recovery keeps the last accepted decision only when this cycle has no usable
  // document, or when the document is unchanged and the page could not be read.
  if (directUsable && read.ok && pageContradicts) {
    cycle = "semantic_failure";
    decision = direct.decision;
    affectingIds = direct.affectingIds;
    decisionSource = "osv-json";
    acceptedState = acceptState(direct, batch);
  } else if (directUsable && read.ok && !previous?.batch) {
    cycle = "initial";
    decision = direct.decision;
    affectingIds = direct.affectingIds;
    decisionSource = "osv-json";
    acceptedState = acceptState(direct, batch);
  } else if (directUsable && read.ok && (recordChanged || monitor?.verdict === "changed")) {
    cycle = "change";
    decision = direct.decision;
    affectingIds = direct.affectingIds;
    decisionSource = "osv-json";
    acceptedState = acceptState(direct, batch);
  } else if (directUsable && read.ok && monitor?.verdict === "unchanged" && !recordChanged) {
    cycle = "no_change";
    decision = direct.decision;
    affectingIds = direct.affectingIds;
    decisionSource = "osv-json";
    acceptedState = acceptState(direct, batch);
  } else if (directUsable && !read.ok && recordChanged) {
    cycle = "change";
    decision = direct.decision;
    affectingIds = direct.affectingIds;
    decisionSource = "osv-json";
    acceptedState = acceptState(direct, batch);
  } else if (directUsable && !read.ok && previous?.accepted) {
    cycle = "recovery";
    recovered = true;
    effort.recoveries = 1;
    decision = direct.decision;
    affectingIds = direct.affectingIds;
    decisionSource = "osv-json";
    acceptedState = previous;
  } else if (directUsable && !read.ok) {
    cycle = "direct_only";
    decision = direct.decision;
    affectingIds = direct.affectingIds;
    decisionSource = "osv-json";
    // The failed page is not a baseline. A later successful read is the initial page.
    acceptedState = {
      accepted: true,
      decision: direct.decision,
      affectingIds: direct.affectingIds,
      recordDigest: direct.recordDigest,
      batch: null,
    };
  } else if (previous?.accepted) {
    cycle = "recovery";
    recovered = true;
    effort.recoveries = 1;
    decision = previous.decision;
    affectingIds = previous.affectingIds;
    decisionSource = "recovered-last-good";
    acceptedState = previous;
  } else {
    cycle = "incomplete";
    decision = "unknown";
    affectingIds = [];
    decisionSource = "incomplete";
    acceptedState = null;
  }

  if (direct.decision === "affected" && decision === "not_affected") {
    throw new Error("refusing to clear a pin the supplied OSV document marks affected");
  }

  const pageNoChange = monitor?.claims?.noChangeProven === true && monitor?.verdict === "unchanged";
  effort.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const report = {
    schema: "samedaydesk.repeat-outcome.advisory.v0",
    task: "maintained npm advisory decision for one pinned package",
    cycle,
    changeKind: cycle !== "change" ? null : (recordChanged && monitor?.verdict === "changed" ? "record_and_page" : recordChanged ? "record" : "page"),
    decision,
    decisionSource,
    decisionScope: direct.decisionScope,
    recovered,
    fresh: false,
    pin,
    pageClass,
    pageUrl,
    direct: {
      decision: direct.decision,
      sufficient: direct.sufficient,
      reason: direct.reason,
      affectingIds: direct.affectingIds,
      recordDigest: direct.recordDigest,
      advisories: direct.advisories.map((advisory) => ({
        id: advisory.id,
        modified: advisory.modified,
        summary: advisory.summary,
        status: advisory.status,
        reason: advisory.reason,
      })),
    },
    reader,
    monitor: monitor ? {
      schema: monitor.schema,
      verdict: monitor.verdict,
      noChangeProven: monitor.claims?.noChangeProven === true,
      contentUnchangedProven: monitor.claims?.contentUnchangedProven === true,
      fresh: monitor.claims?.fresh === true,
      usefulOutputProven: monitor.claims?.usefulOutputProven === true,
      paymentImpliesUsefulOutput: monitor.claims?.paymentImpliesUsefulOutput === true,
      summary: monitor.summary,
      provenance: monitor.provenance,
    } : null,
    recordChanged,
    pageNoChangeDoesNotDecidePin: pageNoChange && recordChanged,
    noChangeProven: cycle === "no_change" && pageNoChange && !recordChanged,
    productWin: false,
    refusedPageClearance: Boolean(reader?.ignoredClaim?.explicitPinClearance) && decision === "affected",
    pricing: null,
    charged: false,
    effort,
  };
  return { report, acceptedState };
}

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
