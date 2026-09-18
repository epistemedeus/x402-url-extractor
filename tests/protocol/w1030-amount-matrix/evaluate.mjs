import {
  CODES,
  EXTRACT_AMOUNT_ATOMIC,
  FORBIDDEN_INVENTED,
  MATRIX,
  PAYMENT_REQUEST_HEADER_NAMES,
  SCAN_AMOUNT_ATOMIC,
  SCHEMA_REPORT,
  SDS,
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
  if (!headers || typeof headers !== "object") return out;
  for (const [key, value] of Object.entries(headers)) {
    out[String(key).toLowerCase()] = value;
  }
  return out;
}

function paymentRequestHeaders(headers) {
  const map = headerMap(headers);
  const hits = [];
  for (const name of PAYMENT_REQUEST_HEADER_NAMES) {
    if (map[name]) hits.push(name);
  }
  const authorization = String(map.authorization || "");
  if (/^payment\s+/i.test(authorization)) hits.push("authorization");
  return hits;
}

function exactAccept(accepts) {
  const rows = asList(accepts);
  return rows.find((row) => (
    asRecord(row)
    && row.scheme === SDS.scheme
    && row.network === SDS.network
  )) || rows[0] || null;
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
      wave: "w1030",
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

  let paymentAttempted = fixture.paymentAttempted === true;
  const rows = [];

  for (const route of MATRIX) {
    const httpObs = asRecord(http[route.path]);
    const mcpObs = mcpTool(mcp, route.mcpTool);
    const openapiObs = openapiOperation(openapi, route.path, route.method);
    const known = wellKnownItem(wellKnown, route.path);
    const requestHeaderHits = paymentRequestHeaders(httpObs?.requestHeaders);
    if (requestHeaderHits.length) {
      paymentAttempted = true;
      pushCode(codes, CODES.PAYMENT_ATTEMPTED);
    }

    if (!httpObs) {
      if (claims.treatAbsenceAsDemand === true || claims.absenceIsDemand === true) {
        pushCode(codes, CODES.TREAT_ABSENCE_AS_DEMAND);
      } else {
        pushCode(codes, CODES.ROUTE_ABSENT);
      }
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

    const accepted = exactAccept(httpObs.accepts);
    const httpAmount = accepted?.amount;
    const mcpAmount = exactAccept(mcpObs?._meta?.x402?.accepts)?.amount
      ?? exactAccept(mcpObs?.accepts)?.amount;
    const offerAmount = httpObs.offerReceiptAmount
      ?? httpObs.extensions?.["offer-receipt"]?.info?.offers?.[0]?.payload?.amount;
    const wellKnownAmount = exactAccept(known?.accepts)?.amount;
    const payTo = accepted?.payTo;

    if (payTo && String(payTo).toLowerCase() !== SDS.payTo.toLowerCase()) {
      pushCode(codes, CODES.PAY_TO_MISMATCH);
    }

    if (!mcpObs) {
      pushCode(codes, CODES.AMOUNT_MISMATCH);
      pushCode(codes, CODES.MCP_AMOUNT_MISSING);
    }
    const httpCmp = inspectAmount(httpAmount, route.amountAtomic, codes, "http");
    let mcpCmp = { present: false, value: null, match: false, label: "mcp" };
    if (mcpObs) {
      if (mcpAmount == null) {
        pushCode(codes, CODES.MCP_AMOUNT_MISSING);
        pushCode(codes, CODES.AMOUNT_MISMATCH);
      } else {
        mcpCmp = inspectAmount(mcpAmount, route.amountAtomic, codes, "mcp");
      }
    }
    if (offerAmount != null) inspectAmount(offerAmount, route.amountAtomic, codes, "offer-receipt");
    if (Array.isArray(wellKnown.items) && wellKnown.items.length > 0) {
      if (wellKnownAmount == null) pushCode(codes, CODES.AMOUNT_MISMATCH);
      else inspectAmount(wellKnownAmount, route.amountAtomic, codes, "well-known");
    }

    if (httpCmp.present && mcpCmp.present && !amountsEqual(httpCmp.value, mcpCmp.value)) {
      pushCode(codes, CODES.AMOUNT_MISMATCH);
    }

    const desc = String(openapiObs?.responses?.["402"]?.description || "");
    if (!openapiObs || !desc.includes(route.openapi402Token)) {
      pushCode(codes, CODES.OPENAPI_402_TEXT_MISMATCH);
    }

    const openApiPrice = openapiObs?.["x-payment-info"]?.price?.amount;
    if (openApiPrice != null) {
      if (amountsEqual(String(openApiPrice), route.amountAtomic)) {
        pushCode(codes, CODES.UNIT_CONVERSION);
      }
      if (typeof openApiPrice === "string" && openApiPrice !== route.openapiPriceAmount) {
        pushCode(codes, CODES.OPENAPI_402_TEXT_MISMATCH);
      }
    }

    const copiedExtractOntoScan = route.id === "scan"
      && (
        amountsEqual(httpAmount, EXTRACT_AMOUNT_ATOMIC)
        || amountsEqual(mcpAmount, EXTRACT_AMOUNT_ATOMIC)
        || amountsEqual(wellKnownAmount, EXTRACT_AMOUNT_ATOMIC)
      )
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
      match: httpCmp.match
        && mcpCmp.match
        && status === 402
        && (!payTo || String(payTo).toLowerCase() === SDS.payTo.toLowerCase())
        && !copiedExtractOntoScan,
    });
  }

  if (claims.copyExtractOntoScan === true) {
    pushCode(codes, CODES.COPY_EXTRACT_ONTO_SCAN);
  }
  if (claims.charged === true || claims.paidDelivery === true || claims.successProven === true) {
    pushCode(codes, CODES.PAYMENT_ATTEMPTED);
    paymentAttempted = true;
  }

  const unitsConverted = codes.includes(CODES.UNIT_CONVERSION);
  const ok = codes.length === 0;
  if (ok) codes.push(CODES.OK);

  return {
    schemaVersion: SCHEMA_REPORT,
    wave: "w1030",
    ok,
    decision: ok ? CODES.OK : "refuse",
    codes,
    invented,
    paymentAttempted,
    unitsConverted,
    payTo: SDS.payTo,
    rows,
    boundary: emptyBoundary({ unitsConverted }),
  };
}
