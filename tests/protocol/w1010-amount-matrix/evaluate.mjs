import {
  CODES,
  EXTRACT_AMOUNT_ATOMIC,
  FORBIDDEN_INVENTED,
  MATRIX,
  PAYMENT_REQUEST_HEADER_NAMES,
  PAYMENT_RESPONSE_SETTLEMENT_HEADER_NAMES,
  SCAN_AMOUNT_ATOMIC,
  SCHEMA_REPORT,
  SDS,
  WAVE,
} from "./constants.mjs";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

export function amountsEqual(left, right) {
  return typeof left === "string" && typeof right === "string" && left === right;
}

function inventedHits(value, acc = []) {
  if (Array.isArray(value)) {
    for (const item of value) inventedHits(item, acc);
    return acc;
  }
  if (!value || typeof value !== "object") return acc;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_INVENTED.includes(key) && !acc.includes(key)) acc.push(key);
    inventedHits(child, acc);
  }
  return acc;
}

function headerMap(headers) {
  const out = {};
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return out;
  for (const [key, value] of Object.entries(headers)) {
    out[String(key).trim().toLowerCase()] = value;
  }
  return out;
}

function paymentHeaderHits(headers, names, { authorization = false } = {}) {
  const map = headerMap(headers);
  const hits = [];
  for (const name of names) {
    if (Object.hasOwn(map, name)) hits.push(name);
  }
  if (authorization) {
    const value = String(map.authorization || "").trim();
    if (/^payment\s+/i.test(value)) hits.push("authorization");
  }
  return hits;
}

function claimedTrue(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function exactAccepts(accepts) {
  return asList(accepts).filter((row) => (
    asRecord(row)
    && row.scheme === SDS.scheme
    && row.network === SDS.network
  ));
}

function exactAccept(accepts) {
  return exactAccepts(accepts)[0] || null;
}

function inspectExactAmounts(rows, expected, codes, label) {
  if (!rows.length) {
    return { ...inspectAmount(undefined, expected, codes, label), allMatch: false };
  }
  let first = null;
  let allMatch = true;
  for (const row of rows) {
    const cmp = inspectAmount(row.amount, expected, codes, label);
    if (!first) first = cmp;
    if (!cmp.match) allMatch = false;
  }
  return { ...first, allMatch };
}

function mcpTool(mcp, name) {
  const tools = asList(mcp?.tools);
  return tools.find((tool) => tool?.name === name) || null;
}

function wellKnownItem(wellKnown, path) {
  const items = asList(wellKnown?.items);
  return items.find((item) => item?.resource?.routeTemplate === path) || null;
}

function openapiOperation(openapi, path, method) {
  const verb = String(method || "GET").toLowerCase();
  return asRecord(asRecord(openapi?.paths)?.[path])?.[verb] || null;
}

function pushCode(codes, code) {
  if (!codes.includes(code)) codes.push(code);
}

function inspectAmount(value, expected, codes, label) {
  if (value == null) {
    pushCode(codes, CODES.AMOUNT_MISMATCH);
    return { present: false, value: null, match: false, label };
  }
  if (typeof value !== "string") {
    pushCode(codes, CODES.INVALID_AMOUNT_TYPE);
    pushCode(codes, CODES.UNIT_CONVERSION);
    return { present: true, value, match: false, label };
  }
  if (value.includes(".") || /^0[0-9]/.test(value) || /e/i.test(value)) {
    pushCode(codes, CODES.UNIT_CONVERSION);
  }
  const match = amountsEqual(value, expected);
  if (!match) pushCode(codes, CODES.AMOUNT_MISMATCH);
  return { present: true, value, match, label };
}

export function openapiTokenPresent(description, token) {
  if (typeof description !== "string" || typeof token !== "string" || !token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`).test(description);
}

function acceptTermsOk(accepted, codes, { requireAsset = false } = {}) {
  const row = asRecord(accepted);
  if (!row) {
    pushCode(codes, CODES.ACCEPT_TERMS_MISMATCH);
    return false;
  }
  let ok = true;
  if (row.scheme !== SDS.scheme || row.network !== SDS.network) {
    pushCode(codes, CODES.ACCEPT_TERMS_MISMATCH);
    ok = false;
  }
  if (requireAsset && (row.asset == null || String(row.asset).toLowerCase() !== SDS.asset.toLowerCase())) {
    pushCode(codes, CODES.ACCEPT_TERMS_MISMATCH);
    ok = false;
  } else if (row.asset != null && String(row.asset).toLowerCase() !== SDS.asset.toLowerCase()) {
    pushCode(codes, CODES.ACCEPT_TERMS_MISMATCH);
    ok = false;
  }
  return ok;
}

function payToOk(payTo, codes, { required = false } = {}) {
  if (payTo == null || payTo === "") {
    if (required) {
      pushCode(codes, CODES.PAY_TO_MISMATCH);
      return false;
    }
    return true;
  }
  if (String(payTo).toLowerCase() !== SDS.payTo.toLowerCase()) {
    pushCode(codes, CODES.PAY_TO_MISMATCH);
    return false;
  }
  return true;
}

function emptyBoundary(extra = {}) {
  return {
    paymentSent: false,
    liveListing: false,
    bazaarTrackerLive: false,
    ownerCdp: false,
    unitsConverted: false,
    compareAtomicAsString: true,
    ...extra,
  };
}

export function evaluateAmountMatrix(document) {
  const codes = [];
  const fixture = asRecord(document);
  if (!fixture) {
    return {
      schemaVersion: SCHEMA_REPORT,
      wave: WAVE,
      ok: false,
      decision: "refuse",
      codes: [CODES.MALFORMED_FIXTURE],
      rows: [],
      invented: [],
      paymentAttempted: false,
      unitsConverted: false,
      boundary: emptyBoundary(),
    };
  }

  const invented = inventedHits(fixture);
  if (invented.length) pushCode(codes, CODES.INVENTED_FIELD);

  const claims = asRecord(fixture.claims) || {};
  const observed = asRecord(fixture.observed) || fixture;
  const http = asRecord(observed.http) || {};
  const mcp = asRecord(observed.mcp) || {};
  const openapi = asRecord(observed.openapi) || {};
  const wellKnown = asRecord(observed.wellKnownX402) || asRecord(observed.wellKnown) || {};
  const wellKnownItems = asList(wellKnown.items);
  const wellKnownDeclared = wellKnownItems.length > 0;

  let paymentAttempted = claimedTrue(fixture.paymentAttempted);
  if (paymentAttempted) pushCode(codes, CODES.PAYMENT_ATTEMPTED);
  const rows = [];

  for (const route of MATRIX) {
    const httpObs = asRecord(http[route.path]);
    const mcpObs = mcpTool(mcp, route.mcpTool);
    const openapiObs = openapiOperation(openapi, route.path, route.method);
    const known = wellKnownItem(wellKnown, route.path);
    const requestHeaderHits = paymentHeaderHits(
      httpObs?.requestHeaders,
      PAYMENT_REQUEST_HEADER_NAMES,
      { authorization: true },
    );
    const responseHeaderHits = [
      ...paymentHeaderHits(httpObs?.responseHeaders, PAYMENT_RESPONSE_SETTLEMENT_HEADER_NAMES),
      ...paymentHeaderHits(httpObs?.headers, PAYMENT_RESPONSE_SETTLEMENT_HEADER_NAMES),
    ];
    if (requestHeaderHits.length || responseHeaderHits.length) {
      paymentAttempted = true;
      pushCode(codes, CODES.PAYMENT_ATTEMPTED);
    }

    if (!httpObs) {
      pushCode(codes, CODES.ROUTE_ABSENT);
      rows.push({
        id: route.id,
        path: route.path,
        mcpTool: route.mcpTool,
        expectedAmountAtomic: route.amountAtomic,
        present: false,
        httpStatus: null,
        httpAmount: null,
        mcpAmount: null,
        offerAmount: null,
        wellKnownAmount: null,
        match: false,
      });
      continue;
    }

    const status = httpObs.status;
    if (status !== 402) pushCode(codes, CODES.HTTP_NOT_402);

    const httpExact = exactAccepts(httpObs.accepts);
    const accepted = httpExact[0] || null;
    const httpAmount = accepted?.amount;
    const mcpExact = [
      ...exactAccepts(mcpObs?._meta?.x402?.accepts),
      ...exactAccepts(mcpObs?.accepts),
    ];
    const mcpAccepted = mcpExact[0] || null;
    const mcpAmount = mcpAccepted?.amount;
    const offerAmount = httpObs.offerReceiptAmount
      ?? httpObs.extensions?.["offer-receipt"]?.info?.offers?.[0]?.payload?.amount;
    const wellKnownExact = exactAccepts(known?.accepts);
    const wellKnownAccepted = wellKnownExact[0] || null;
    const wellKnownAmount = wellKnownAccepted?.amount;
    const payTo = accepted?.payTo;

    const httpPayToOk = payToOk(payTo, codes, { required: true });
    const httpTermsOk = acceptTermsOk(accepted, codes, { requireAsset: true });
    if (!mcpObs) {
      pushCode(codes, CODES.MCP_AMOUNT_MISSING);
      pushCode(codes, CODES.AMOUNT_MISMATCH);
    }
    const mcpTermsOk = acceptTermsOk(mcpAccepted, codes, { requireAsset: false });
    const mcpPayToOk = payToOk(mcpAccepted?.payTo, codes, { required: Boolean(asRecord(mcpAccepted)) });

    const httpCmp = inspectExactAmounts(httpExact, route.amountAtomic, codes, "http");
    let mcpCmp = { present: false, value: null, match: false, allMatch: false, label: "mcp" };
    if (mcpObs) {
      if (mcpAmount == null) {
        pushCode(codes, CODES.MCP_AMOUNT_MISSING);
      }
      mcpCmp = inspectExactAmounts(mcpExact, route.amountAtomic, codes, "mcp");
    }
    if (offerAmount != null) inspectAmount(offerAmount, route.amountAtomic, codes, "offer-receipt");
    let wellKnownTermsOk = true;
    let wellKnownPayToOk = true;
    let wellKnownAllMatch = true;
    if (wellKnownDeclared) {
      const wellKnownCmp = inspectExactAmounts(wellKnownExact, route.amountAtomic, codes, "well-known");
      wellKnownAllMatch = wellKnownCmp.allMatch === true;
      if (known) {
        wellKnownTermsOk = acceptTermsOk(wellKnownAccepted, codes, { requireAsset: false });
        wellKnownPayToOk = payToOk(wellKnownAccepted?.payTo, codes, {
          required: Boolean(asRecord(wellKnownAccepted)),
        });
      }
    }

    if (httpCmp.present && mcpCmp.present && !amountsEqual(httpCmp.value, mcpCmp.value)) {
      pushCode(codes, CODES.AMOUNT_MISMATCH);
    }

    const desc = String(openapiObs?.responses?.["402"]?.description || "");
    if (!openapiTokenPresent(desc, route.openapi402Token)) {
      pushCode(codes, CODES.OPENAPI_402_TEXT_MISMATCH);
    }

    const openApiPrice = openapiObs?.["x-payment-info"]?.price?.amount;
    if (openApiPrice != null) {
      if (typeof openApiPrice !== "string") {
        pushCode(codes, CODES.INVALID_AMOUNT_TYPE);
        pushCode(codes, CODES.UNIT_CONVERSION);
      }
      if (amountsEqual(String(openApiPrice), route.amountAtomic)) {
        pushCode(codes, CODES.UNIT_CONVERSION);
      }
      if (String(openApiPrice) !== route.openapiPriceAmount) {
        pushCode(codes, CODES.OPENAPI_402_TEXT_MISMATCH);
      }
    }

    const copiedExtractOntoScan = route.id === "scan"
      && [
        ...httpExact,
        ...mcpExact,
        ...wellKnownExact,
      ].some((row) => amountsEqual(row.amount, EXTRACT_AMOUNT_ATOMIC))
      && !amountsEqual(EXTRACT_AMOUNT_ATOMIC, SCAN_AMOUNT_ATOMIC);
    if (copiedExtractOntoScan) {
      pushCode(codes, CODES.COPY_EXTRACT_ONTO_SCAN);
      pushCode(codes, CODES.AMOUNT_MISMATCH);
    }

    rows.push({
      id: route.id,
      path: route.path,
      mcpTool: route.mcpTool,
      expectedAmountAtomic: route.amountAtomic,
      present: true,
      httpStatus: status ?? null,
      httpAmount: httpAmount ?? null,
      mcpAmount: mcpAmount ?? null,
      offerAmount: offerAmount ?? null,
      wellKnownAmount: wellKnownAmount ?? null,
      payTo: payTo ?? null,
      openapi402Token: route.openapi402Token,
      openapi402Text: desc || null,
      network: accepted?.network ?? null,
      asset: accepted?.asset ?? null,
      match: httpCmp.match
        && httpCmp.allMatch
        && mcpCmp.match
        && mcpCmp.allMatch
        && mcpTermsOk
        && mcpPayToOk
        && status === 402
        && httpTermsOk
        && httpPayToOk
        && wellKnownTermsOk
        && wellKnownPayToOk
        && wellKnownAllMatch
        && !copiedExtractOntoScan,
    });
  }

  if (claimedTrue(claims.copyExtractOntoScan)) {
    pushCode(codes, CODES.COPY_EXTRACT_ONTO_SCAN);
  }
  if (claimedTrue(claims.treatAbsenceAsDemand) || claimedTrue(claims.absenceIsDemand)) {
    pushCode(codes, CODES.TREAT_ABSENCE_AS_DEMAND);
  }
  if (claimedTrue(claims.charged) || claimedTrue(claims.paidDelivery) || claimedTrue(claims.successProven)) {
    pushCode(codes, CODES.PAYMENT_ATTEMPTED);
    paymentAttempted = true;
  }

  const unitsConverted = codes.includes(CODES.UNIT_CONVERSION);
  const ok = codes.length === 0;
  if (ok) codes.push(CODES.OK);

  return {
    schemaVersion: SCHEMA_REPORT,
    wave: WAVE,
    ok,
    decision: ok ? CODES.OK : "refuse",
    codes,
    invented,
    paymentAttempted,
    unitsConverted,
    payTo: SDS.payTo,
    rows,
    boundary: emptyBoundary({
      paymentSent: paymentAttempted,
      unitsConverted,
    }),
  };
}
