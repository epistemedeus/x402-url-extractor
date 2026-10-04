import {
  EXTRACT_TEXT_EXCERPT_CHARS,
  EXTRACT_TEXT_EXCERPT_MAX_CHARS,
  READ_MARKDOWN_MAX_CHARS,
} from "../../../extract-capture.mjs";

/**
 * Decide whether an already-held extract record satisfies a named task.
 * Never fetches, pays, or classifies schema-pass as buyer usefulness.
 */

const READ_ROUTE = "/read";
const UNAVAILABLE_CODES = new Set([
  "timeout",
  "fetch_error",
  "redirect_error",
  "ssrf_blocked",
  "invalid_response",
  "unsupported_encoding",
  "invalid_excerpt_limit",
]);

function action(id, statement, route = null) {
  return Object.freeze({
    id,
    route,
    executed: false,
    purchaseAuthorized: false,
    statement,
  });
}

function finish(value) {
  return Object.freeze({
    predicate: value.predicate,
    satisfied: value.satisfied,
    reason: value.reason,
    delivery: value.delivery,
    nextAction: value.nextAction,
  });
}

function normalizePredicate(task) {
  if (task == null) return null;
  if (typeof task === "string") return normalizePredicate({ kind: task });
  if (typeof task !== "object" || Array.isArray(task)) {
    return { invalid: true };
  }
  const kind = task.kind || task.predicate;
  if (!["metadata", "excerpt", "markdown"].includes(kind)) return { invalid: true };
  let requiredChars = null;
  if (task.requiredChars !== undefined && task.requiredChars !== null) {
    if (!Number.isInteger(task.requiredChars) || task.requiredChars < 1) return { invalid: true };
    requiredChars = task.requiredChars;
  }
  return { kind, requiredChars };
}

function errorCode(body) {
  if (body?.error && typeof body.error === "object" && typeof body.error.code === "string") return body.error.code;
  if (typeof body?.error === "string") return body.error;
  return null;
}

function hasMetadata(body) {
  if (typeof body?.title === "string" && body.title.trim()) return true;
  if (typeof body?.description === "string" && body.description.trim()) return true;
  if (Array.isArray(body?.jsonLd) && body.jsonLd.length > 0) return true;
  if (body?.openGraph && typeof body.openGraph === "object" && Object.keys(body.openGraph).length > 0) return true;
  return false;
}

export function decideExtractTask(body, task = null) {
  const predicate = normalizePredicate(task);
  if (predicate?.invalid) {
    return finish({
      predicate: null,
      satisfied: false,
      reason: "invalid_predicate",
      delivery: "invalid",
      nextAction: action("declare_predicate", "Task predicate must be metadata, excerpt, or markdown. No route was purchased."),
    });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return finish({
      predicate: predicate?.kind ?? null,
      satisfied: false,
      reason: "malformed_output",
      delivery: "invalid",
      nextAction: action("malformed_output", "The response is not a typed extract record. Schema-pass was not established and nothing was repurchased."),
    });
  }

  const capture = body.capture && typeof body.capture === "object" ? body.capture : null;
  const textTruncated = capture?.textTruncated === true || body.truncated === true;
  const bodyTruncated = capture?.bodyTruncated === true;
  const code = errorCode(body);
  const kind = predicate?.kind ?? null;

  if (body.ok === false || UNAVAILABLE_CODES.has(code)) {
    return finish({
      predicate: kind,
      satisfied: false,
      reason: "source_unavailable",
      delivery: "unavailable",
      nextAction: action("source_unavailable", "The source was not captured. This is not missing content inside a successful page, and no other paid route was called."),
    });
  }

  const sourceStatus = Number(body.status);
  if (body.sourceOk === false || (Number.isInteger(sourceStatus) && (sourceStatus < 200 || sourceStatus >= 300))) {
    return finish({
      predicate: kind,
      satisfied: false,
      reason: "source_refused",
      delivery: "source_refused",
      nextAction: action("source_refused", `The source refused the fetch${code ? ` (${code})` : ""}. Refusal is not missing content and is not a reason to buy the same page again.`),
    });
  }

  if (bodyTruncated) {
    return finish({
      predicate: kind,
      satisfied: false,
      reason: "source_body_budget",
      delivery: "partial",
      nextAction: action("source_budget_exhausted", "Capture stopped at the 3 MB body budget. A larger excerpt or /read cannot recover bytes that were not stored. Nothing further was purchased."),
    });
  }

  const text = typeof body.text === "string" ? body.text : "";
  const limit = Number.isInteger(capture?.textExcerptLimitChars) ? capture.textExcerptLimitChars : null;

  if (!predicate) {
    if (textTruncated || !capture) {
      return finish({
        predicate: null,
        satisfied: null,
        reason: textTruncated ? "truncated_partial" : "predicate_not_declared",
        delivery: textTruncated ? "partial" : "fields_present",
        nextAction: action(
          textTruncated ? "declare_predicate_or_use_read" : "declare_predicate",
          textTruncated
            ? `The excerpt is cropped${limit ? ` at ${limit} characters` : ""}. HTTP 200 and a schema-valid record are not task completion. Declare metadata, excerpt, or markdown. A later extract may set textExcerptLimitChars up to ${EXTRACT_TEXT_EXCERPT_MAX_CHARS}, or existing GET /read can supply Markdown up to ${READ_MARKDOWN_MAX_CHARS}. Neither call was made.`
            : "Required fields may be present. No task predicate was declared, so this is not buyer usefulness.",
          textTruncated ? READ_ROUTE : null,
        ),
      });
    }
    return finish({
      predicate: null,
      satisfied: null,
      reason: "predicate_not_declared",
      delivery: "fields_present",
      nextAction: action("declare_predicate", "Capture is labeled and no truncation mark is set. No task predicate was declared, so this is not buyer usefulness."),
    });
  }

  if (predicate.kind === "metadata") {
    if (body.sourceOk === true && hasMetadata(body)) {
      return finish({
        predicate: "metadata",
        satisfied: true,
        reason: textTruncated ? "metadata_sufficient_text_cropped" : "metadata_sufficient",
        delivery: "metadata_sufficient",
        nextAction: action("sufficient", "Structured metadata satisfies the metadata predicate. Cropped body text does not fail this predicate, and no second route was purchased."),
      });
    }
    return finish({
      predicate: "metadata",
      satisfied: false,
      reason: "metadata_missing",
      delivery: "partial",
      nextAction: action("insufficient_metadata", "The metadata predicate is not met. Do not treat the HTTP record as success."),
    });
  }

  if (predicate.kind === "markdown") {
    const withinRead = predicate.requiredChars == null || predicate.requiredChars <= READ_MARKDOWN_MAX_CHARS;
    return finish({
      predicate: "markdown",
      satisfied: false,
      reason: withinRead ? "extract_is_not_markdown" : "bound_exceeds_product",
      delivery: "partial",
      nextAction: action(
        withinRead ? "use_existing_read" : "bound_exceeds_product",
        withinRead
          ? `This predicate needs Markdown. Existing GET /read returns at most ${READ_MARKDOWN_MAX_CHARS} characters from the same no-JS capture and was not called.`
          : `Required content exceeds the ${READ_MARKDOWN_MAX_CHARS}-character Markdown bound. Neither extract nor /read promises that text.`,
        withinRead ? READ_ROUTE : null,
      ),
    });
  }

  if (!capture) {
    return finish({
      predicate: "excerpt",
      satisfied: null,
      reason: "capture_not_labeled",
      delivery: "partial",
      nextAction: action("require_capture", "Excerpt completeness is unlabeled. Do not treat schema-pass as task completion."),
    });
  }

  const required = predicate.requiredChars;
  const withinBudget = body.sourceOk === true
    && (required == null ? !textTruncated : text.length >= required);
  if (withinBudget) {
    return finish({
      predicate: "excerpt",
      satisfied: true,
      reason: textTruncated ? "bounded_excerpt_sufficient_text_cropped" : "excerpt_within_budget",
      delivery: "excerpt_sufficient",
      nextAction: action("sufficient", `Text fits the ${limit ?? EXTRACT_TEXT_EXCERPT_CHARS}-character excerpt budget.`),
    });
  }
  if (textTruncated) {
    const canRaise = (limit ?? EXTRACT_TEXT_EXCERPT_CHARS) < EXTRACT_TEXT_EXCERPT_MAX_CHARS
      && (required == null || required <= EXTRACT_TEXT_EXCERPT_MAX_CHARS);
    return finish({
      predicate: "excerpt",
      satisfied: false,
      reason: canRaise ? "excerpt_short" : "bound_exceeds_product",
      delivery: "partial",
      nextAction: action(
        canRaise ? "raise_excerpt_budget" : "bound_exceeds_product",
        canRaise
          ? `Text is cropped at ${limit ?? EXTRACT_TEXT_EXCERPT_CHARS} characters. A later GET /extract may set textExcerptLimitChars up to ${EXTRACT_TEXT_EXCERPT_MAX_CHARS} before payment. GET /read remains the Markdown route. This result purchased neither.`
          : `Required content exceeds the ${EXTRACT_TEXT_EXCERPT_MAX_CHARS}-character excerpt ceiling.`,
        canRaise ? "/extract" : null,
      ),
    });
  }
  return finish({
    predicate: "excerpt",
    satisfied: false,
    reason: "source_shorter_than_required",
    delivery: "partial",
    nextAction: action("source_shorter_than_required", "The captured source is shorter than requiredChars and was not cropped. Buying the same URL again will not add text."),
  });
}
