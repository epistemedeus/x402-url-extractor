import { allowedPublicUrl } from "../../../tools/ops/three-site-settlement-join/measure/src/outcome-binding.mjs";
import { projectFunnelBaseline, sha256Text } from "./baseline.mjs";
import { COVERED_DAYS, PUBLIC_ROUTE, RARE_CONTEXT_DAYS } from "./constants.mjs";
import { fail } from "./errors.mjs";

const MAX_BYTES = 512_000;

export function routeForDays(days) {
  const url = allowedPublicUrl(`${PUBLIC_ROUTE}?days=${days}`);
  if (!url) fail("public_aggregate_rejected", "only the existing commerce-demand route is readable");
  return url;
}

export async function fetchAggregate(days) {
  const url = routeForDays(days);
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    fail("public_aggregate_unavailable", "the public commerce-demand document was not readable");
  }
  if (!response.ok) fail("public_aggregate_unavailable", "the public commerce-demand document was not readable");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) fail("public_aggregate_rejected", "the public document is outside the read bound");
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    fail("public_aggregate_unavailable", "the public commerce-demand document was not JSON");
  }
  return {
    document,
    meta: {
      url,
      sha256: sha256Text(text),
      bytes: Buffer.byteLength(text),
      acquiredAt: new Date().toISOString(),
      httpStatus: response.status,
    },
  };
}

export async function readProductionBaseline(provenance = {}) {
  const covered = await fetchAggregate(COVERED_DAYS);
  const rare = await fetchAggregate(RARE_CONTEXT_DAYS);
  const baseline = projectFunnelBaseline({
    coveredDocument: covered.document,
    rareDocument: rare.document,
    coveredMeta: covered.meta,
    rareMeta: rare.meta,
    provenance,
  });
  if (baseline.coveredWindow.selected !== true || baseline.coveredWindow.requestedDays !== COVERED_DAYS) {
    fail("uncovered_window", "the recent one-day route did not report a complete window");
  }
  return baseline;
}
