/**
 * Recover a settlement transaction identifier from an already-held HTTP-like
 * response. Does not fetch, pay, sign, broadcast, or contact a facilitator.
 *
 * Evidence classes:
 * - independently_observed: the caller obtained the response in this session
 * - provided_report: reconstructed from a public requester report; this session
 *   did not execute the paid call
 */

const MAX_HEADER_CHARS = 131_072;
const PENDING_MARKER = /^pending:/i;

const V2_HEADER_NAMES = Object.freeze(["payment-response"]);
const V1_HEADER_NAMES = Object.freeze(["x-payment-response"]);
const LEGACY_TX_HEADER_NAMES = Object.freeze(["x-transaction-id"]);

export const EVIDENCE_CLASS = Object.freeze({
  independentlyObserved: "independently_observed",
  providedReport: "provided_report",
});

export function encodePaymentResponseHeader(settlement, { encoding = "base64" } = {}) {
  const json = JSON.stringify(settlement);
  if (encoding === "base64url") return Buffer.from(json, "utf8").toString("base64url");
  if (encoding === "base64") return Buffer.from(json, "utf8").toString("base64");
  throw new Error(`unsupported encoding: ${encoding}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function headerMap(headers) {
  if (!headers) return new Map();
  if (typeof headers.get === "function") {
    const map = new Map();
    const names = typeof headers.keys === "function" ? [...headers.keys()] : [];
    for (const name of names) {
      const value = headers.get(name);
      if (typeof value === "string") map.set(String(name).toLowerCase(), value);
    }
    for (const name of [...V2_HEADER_NAMES, ...V1_HEADER_NAMES, ...LEGACY_TX_HEADER_NAMES]) {
      const value = headers.get(name);
      if (typeof value === "string") map.set(name.toLowerCase(), value);
    }
    return map;
  }
  const map = new Map();
  for (const [name, value] of Object.entries(headers)) {
    const text = Array.isArray(value) ? value[0] : value;
    if (typeof text === "string") map.set(String(name).toLowerCase(), text);
  }
  return map;
}

function decodeHeaderJson(raw) {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "empty" };
  if (raw.length > MAX_HEADER_CHARS) return { ok: false, reason: "oversized" };
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const value = JSON.parse(trimmed);
      return isPlainObject(value) ? { ok: true, value, encoding: "json" } : { ok: false, reason: "not_object" };
    } catch {
      return { ok: false, reason: "malformed_json" };
    }
  }
  for (const encoding of ["base64url", "base64"]) {
    try {
      const text = Buffer.from(trimmed, encoding).toString("utf8");
      if (!text.startsWith("{")) continue;
      const value = JSON.parse(text);
      if (isPlainObject(value)) return { ok: true, value, encoding };
    } catch {
      // try the next encoding
    }
  }
  return { ok: false, reason: "malformed_base64_json" };
}

function usableTxid(value) {
  if (typeof value !== "string") return null;
  const txid = value.trim();
  if (!txid || PENDING_MARKER.test(txid)) return null;
  return txid;
}

function pushCandidate(candidates, { source, locator, txid, settlement, parseError }) {
  candidates.push({
    source,
    locator,
    txid: usableTxid(txid),
    settlement: settlement && isPlainObject(settlement) ? settlement : null,
    parseError: parseError || null,
  });
}

function settlementTxid(settlement) {
  if (!isPlainObject(settlement)) return null;
  return usableTxid(settlement.transaction)
    || usableTxid(settlement.txid)
    || usableTxid(settlement.txHash)
    || usableTxid(settlement.hash);
}

function collectHeaderCandidates(headers) {
  const map = headerMap(headers);
  const candidates = [];
  for (const name of V2_HEADER_NAMES) {
    const raw = map.get(name);
    if (raw === undefined) continue;
    const decoded = decodeHeaderJson(raw);
    if (!decoded.ok) {
      pushCandidate(candidates, { source: "header", locator: name, parseError: decoded.reason });
      continue;
    }
    pushCandidate(candidates, {
      source: "header",
      locator: name,
      txid: settlementTxid(decoded.value),
      settlement: decoded.value,
    });
  }
  for (const name of V1_HEADER_NAMES) {
    const raw = map.get(name);
    if (raw === undefined) continue;
    const decoded = decodeHeaderJson(raw);
    if (!decoded.ok) {
      pushCandidate(candidates, { source: "header", locator: name, parseError: decoded.reason });
      continue;
    }
    pushCandidate(candidates, {
      source: "header",
      locator: name,
      txid: settlementTxid(decoded.value),
      settlement: decoded.value,
    });
  }
  for (const name of LEGACY_TX_HEADER_NAMES) {
    const raw = map.get(name);
    if (raw === undefined) continue;
    pushCandidate(candidates, { source: "header", locator: name, txid: raw });
  }
  return candidates;
}

function collectBodyCandidates(body) {
  const candidates = [];
  if (!isPlainObject(body)) return candidates;
  if (body.txid !== undefined) {
    pushCandidate(candidates, { source: "body", locator: "txid", txid: body.txid });
  }
  if (body.payment_txid !== undefined) {
    pushCandidate(candidates, { source: "body", locator: "payment_txid", txid: body.payment_txid });
  }
  if (isPlainObject(body.payment)) {
    if (body.payment.txid !== undefined) {
      pushCandidate(candidates, { source: "body", locator: "payment.txid", txid: body.payment.txid, settlement: body.payment });
    }
    if (body.payment.transaction !== undefined) {
      pushCandidate(candidates, { source: "body", locator: "payment.transaction", txid: body.payment.transaction, settlement: body.payment });
    }
  }
  return candidates;
}

function collectMcpMetaCandidates(response) {
  const candidates = [];
  const meta = response?.meta
    || response?.result?._meta
    || response?._meta
    || response?.body?._meta;
  if (!isPlainObject(meta)) return candidates;
  const settlement = meta["x402/payment-response"];
  if (settlement === undefined) return candidates;
  if (!isPlainObject(settlement)) {
    pushCandidate(candidates, { source: "mcp_meta", locator: "x402/payment-response", parseError: "not_object" });
    return candidates;
  }
  pushCandidate(candidates, {
    source: "mcp_meta",
    locator: "x402/payment-response",
    txid: settlementTxid(settlement),
    settlement,
  });
  return candidates;
}

function firstString(values) {
  for (const value of values) {
    const txid = usableTxid(value);
    if (txid) return txid;
  }
  return null;
}

export function aibtcMainLookup(response = {}) {
  const body = isPlainObject(response.body) ? response.body : {};
  const headers = headerMap(response.headers);
  return firstString([
    body.txid,
    body.payment_txid,
    headers.get("x-transaction-id"),
  ]);
}

export function aibtcPr667Lookup(response = {}) {
  const body = isPlainObject(response.body) ? response.body : {};
  const headers = headerMap(response.headers);
  const raw = headers.get("payment-response");
  let paymentResponseTxid;
  if (typeof raw === "string") {
    try {
      const settlement = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
      if (typeof settlement?.transaction === "string" && settlement.transaction.length > 0) {
        paymentResponseTxid = settlement.transaction;
      }
    } catch {
      // PR #667 ignores malformed settlement headers
    }
  }
  const paymentBodyTxid = typeof body?.payment?.txid === "string" ? body.payment.txid : undefined;
  return firstString([
    body.txid,
    body.payment_txid,
    paymentResponseTxid,
    paymentBodyTxid,
    headers.get("x-transaction-id"),
  ]);
}

export function meritX402scanV1OnlyLookup(response = {}) {
  const headers = headerMap(response.headers);
  const raw = headers.get("x-payment-response");
  if (typeof raw !== "string") return null;
  const decoded = decodeHeaderJson(raw);
  if (!decoded.ok) return null;
  return settlementTxid(decoded.value);
}

function settlementDecision(candidates, recovered) {
  const settlements = candidates.map((entry) => entry.settlement).filter(isPlainObject);
  const failed = settlements.find((entry) => entry.success === false);
  if (failed && !recovered) return "settlement_failed";
  const pending = settlements.find((entry) => {
    const reason = String(entry.errorReason || entry.status || "").toLowerCase();
    return reason === "settlement_pending" || reason === "pending";
  });
  if (pending && !recovered) return "pending";
  if (!recovered) return "unobservable";
  return "settled";
}

export function recoverSettlementTxid(response = {}, {
  evidenceClass = EVIDENCE_CLASS.independentlyObserved,
} = {}) {
  if (evidenceClass !== EVIDENCE_CLASS.independentlyObserved
    && evidenceClass !== EVIDENCE_CLASS.providedReport) {
    throw new Error("evidenceClass must be independently_observed or provided_report");
  }

  const candidates = [
    ...collectHeaderCandidates(response.headers),
    ...collectBodyCandidates(response.body),
    ...collectMcpMetaCandidates(response),
  ];
  const withTxid = candidates.filter((entry) => typeof entry.txid === "string");
  const unique = [...new Set(withTxid.map((entry) => entry.txid))];
  const conflict = unique.length > 1;
  const recovered = conflict ? null : (unique[0] || null);
  const decision = conflict ? "conflict" : settlementDecision(candidates, recovered);

  return Object.freeze({
    schemaVersion: "s117.settlement-txid.v1",
    evidenceClass,
    decision,
    txid: recovered,
    conflict,
    conflictingTxids: conflict ? unique : [],
    candidates: Object.freeze(candidates.map((entry) => Object.freeze({ ...entry }))),
    lookups: Object.freeze({
      aibtc_main: aibtcMainLookup(response),
      aibtc_pr667: aibtcPr667Lookup(response),
      merit_x402scan_v1_only: meritX402scanV1OnlyLookup(response),
      portable: recovered,
    }),
    notes: Object.freeze({
      aibtc_main_misses_v2_header: aibtcMainLookup(response) === null && recovered !== null,
      aibtc_pr667_misses_v1_header: aibtcPr667Lookup(response) === null
        && meritX402scanV1OnlyLookup(response) !== null,
      merit_v1_only_misses_v2_header: meritX402scanV1OnlyLookup(response) === null
        && headerMap(response.headers).has("payment-response")
        && recovered !== null,
      local_recipe_is_not_upstream_merge: true,
    }),
  });
}
