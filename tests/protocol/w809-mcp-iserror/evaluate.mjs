import { CODES, SDS } from "./constants.mjs";
import {
  claimsDemandCharge,
  classifyToolsCallObservation,
  classifyToolsListObservation,
} from "./classify.mjs";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function violation(code, message, extra = {}) {
  return { code, message, ...extra };
}

function observationOf(fixture) {
  return isRecord(fixture?.observation) ? fixture.observation : fixture;
}

function requestOf(fixture) {
  return isRecord(fixture?.request) ? fixture.request : {};
}

function claimsOf(fixture) {
  return isRecord(fixture?.claims) ? fixture.claims : {};
}

function countersOf(fixture) {
  return isRecord(fixture?.counters) ? fixture.counters : {};
}

function kindOf(fixture) {
  return fixture?.kind || fixture?.method || null;
}

function isToolsList(fixture) {
  const kind = kindOf(fixture);
  return kind === "mcp-tools-list-unpaid" || kind === "tools/list" || fixture?.method === "tools/list";
}

function pinMismatch(classified) {
  const violations = [];
  if (classified.amount && classified.amount !== SDS.amountAtomic) {
    violations.push(violation(
      CODES.AMOUNT_MISMATCH,
      `accepts[].amount ${JSON.stringify(classified.amount)} does not match SDS extract ${SDS.amountAtomic}`,
      { expected: SDS.amountAtomic, actual: classified.amount },
    ));
  }
  if (classified.asset && classified.asset !== SDS.asset) {
    violations.push(violation(
      CODES.ASSET_MISMATCH,
      `accepts[].asset ${classified.asset} is not SDS extract USDC ${SDS.asset}`,
      { expected: SDS.asset, actual: classified.asset },
    ));
  }
  if (classified.payTo && classified.payTo !== SDS.payTo) {
    violations.push(violation(
      CODES.PIN_MISMATCH,
      `accepts[].payTo ${classified.payTo} does not match SDS payTo`,
      { expected: SDS.payTo, actual: classified.payTo },
    ));
  }
  if (classified.network && classified.network !== SDS.network) {
    violations.push(violation(
      CODES.PIN_MISMATCH,
      `accepts[].network ${classified.network} does not match SDS ${SDS.network}`,
      { expected: SDS.network, actual: classified.network },
    ));
  }
  if (classified.x402Version != null && classified.x402Version !== SDS.x402Version) {
    violations.push(violation(
      CODES.PIN_MISMATCH,
      `x402Version ${classified.x402Version} does not match SDS ${SDS.x402Version}`,
      { expected: SDS.x402Version, actual: classified.x402Version },
    ));
  }
  if (classified.eip712Name && classified.eip712Name !== SDS.eip712Name) {
    violations.push(violation(
      CODES.PIN_MISMATCH,
      `accepts[].extra.name ${JSON.stringify(classified.eip712Name)} is not SDS EIP-712 ${SDS.eip712Name}`,
      { expected: SDS.eip712Name, actual: classified.eip712Name },
    ));
  }
  if (classified.eip712Version && classified.eip712Version !== SDS.eip712Version) {
    violations.push(violation(
      CODES.PIN_MISMATCH,
      `accepts[].extra.version ${JSON.stringify(classified.eip712Version)} is not SDS EIP-712 ${SDS.eip712Version}`,
      { expected: SDS.eip712Version, actual: classified.eip712Version },
    ));
  }
  return violations;
}

function sharedBoundaryViolations(classified, request, claims, counters) {
  const violations = [];
  if (classified.invented?.length) {
    violations.push(violation(
      CODES.INVENTED_RECEIPT_FIELD,
      `invented receipt field without live schema: ${classified.invented.join(",")}`,
      { invented: classified.invented },
    ));
  }
  if (classified.paymentSignatureSent || request.paymentSignatureSent === true) {
    violations.push(violation(
      CODES.PAYMENT_SIGNATURE_SENT,
      "PAYMENT-SIGNATURE / x402/payment was sent; this suite is unpaid only",
    ));
  }
  if (Number(counters.handler) > 0) {
    violations.push(violation(CODES.HANDLER_RAN_UNPAID, "unpaid MCP hop ran the paid handler"));
  }
  if (Number(counters.verify) > 0) {
    violations.push(violation(CODES.VERIFY_ON_UNPAID, "unpaid MCP hop called facilitator verify"));
  }
  if (Number(counters.settle) > 0) {
    violations.push(violation(CODES.SETTLE_ON_UNPAID, "unpaid MCP hop called facilitator settle"));
  }
  if (classified.hasPaymentRequiredHeader) {
    violations.push(violation(
      CODES.PAYMENT_REQUIRED_HEADER,
      "Payment-Required header is not the MCP unpaid tools/call isError challenge",
    ));
  }
  if (claimsDemandCharge(claims)) {
    violations.push(violation(
      CODES.HTTP_200_ISERROR_CLASSIFIED_AS_CHARGED,
      "tools/call HTTP 200 isError is unpaid, not charged/paid delivery/successProven",
      {
        claims: {
          charged: claims.charged ?? null,
          paidDelivery: claims.paidDelivery ?? null,
          successProven: claims.successProven ?? null,
          settlement: claims.settlement ?? claims.settled ?? null,
        },
      },
    ));
  }
  return violations;
}

function kindCode(kind) {
  switch (kind) {
    case "http_402":
      return CODES.HTTP_402_NOT_MCP_ISERROR;
    case "jsonrpc_error_not_iserror":
      return CODES.JSONRPC_ERROR_NOT_ISERROR;
    case "snake_is_error":
      return CODES.SNAKE_IS_ERROR;
    case "iserror_not_true":
      return CODES.ISERROR_NOT_TRUE;
    case "iserror_mixed_with_delivery":
      return CODES.ISERROR_MIXED_WITH_DELIVERY;
    case "paid_delivery":
      return CODES.HTTP_200_ISERROR_CLASSIFIED_AS_CHARGED;
    case "payment_required_header":
      return CODES.PAYMENT_REQUIRED_HEADER;
    default:
      return CODES.MALFORMED_FIXTURE;
  }
}

export function evaluateToolsList(fixture = {}) {
  const observation = observationOf(fixture);
  const request = requestOf(fixture);
  const claims = claimsOf(fixture);
  const counters = countersOf(fixture);
  const classified = classifyToolsListObservation(observation, request);
  const violations = [
    ...sharedBoundaryViolations(classified, request, claims, counters),
    ...pinMismatch(classified),
  ];

  if (!isRecord(fixture) || !observation) {
    violations.push(violation(CODES.MALFORMED_FIXTURE, "tools/list fixture is missing"));
  }
  if (classified.httpStatus !== 200) {
    violations.push(violation(
      CODES.TOOLS_LIST_NOT_UNPAID,
      `tools/list HTTP ${classified.httpStatus} is not unpaid discovery`,
    ));
  }
  if (classified.extractPresent !== true || classified.paymentRequired !== true) {
    violations.push(violation(
      CODES.TOOLS_LIST_NOT_UNPAID,
      "tools/list must advertise extract._meta.x402.paymentRequired=true",
    ));
  }
  if (!classified.amount) {
    violations.push(violation(CODES.AMOUNT_MISMATCH, "tools/list extract accepts[].amount is missing"));
  }

  const primary = violations[0];
  return {
    ok: violations.length === 0,
    code: violations.length === 0 ? CODES.UNPAID_MCP_ISERROR : primary.code,
    id: fixture.id ?? null,
    expect: fixture.expect ?? null,
    rejectCode: fixture.rejectCode ?? null,
    method: "tools/list",
    classified,
    violations,
    claimsRejected: claimsDemandCharge(claims)
      && violations.some((item) => item.code === CODES.HTTP_200_ISERROR_CLASSIFIED_AS_CHARGED),
  };
}

export function evaluateToolsCall(fixture = {}) {
  const observation = observationOf(fixture);
  const request = requestOf(fixture);
  const claims = claimsOf(fixture);
  const counters = countersOf(fixture);
  const classified = classifyToolsCallObservation(observation, request);
  const violations = [
    ...sharedBoundaryViolations(classified, request, claims, counters),
  ];

  if (!isRecord(fixture) || !observation) {
    violations.push(violation(CODES.MALFORMED_FIXTURE, "tools/call fixture is missing"));
  }

  if (classified.kind === "http_402") {
    violations.push(violation(
      CODES.HTTP_402_NOT_MCP_ISERROR,
      "MCP tools/call unpaid challenge is HTTP 200 isError, not HTTP 402",
    ));
  }
  if (classified.kind === "jsonrpc_error_not_iserror") {
    violations.push(violation(
      CODES.JSONRPC_ERROR_NOT_ISERROR,
      `MCP unpaid extract is result.isError=true, not JSON-RPC error ${classified.jsonRpcErrorCode}`,
      { jsonRpcErrorCode: classified.jsonRpcErrorCode },
    ));
  }
  if (classified.kind === "snake_is_error") {
    violations.push(violation(
      CODES.SNAKE_IS_ERROR,
      "SDS unpaid MCP wire uses camelCase isError, not snake_case is_error",
    ));
  }
  if (classified.kind === "iserror_not_true") {
    violations.push(violation(
      CODES.ISERROR_NOT_TRUE,
      `unpaid PaymentRequired body must set result.isError===true, got ${JSON.stringify(classified.isErrorValue)}`,
      { isErrorValue: classified.isErrorValue ?? null, isErrorPresent: classified.isErrorPresent },
    ));
  }
  if (classified.kind === "iserror_mixed_with_delivery") {
    violations.push(violation(
      CODES.ISERROR_MIXED_WITH_DELIVERY,
      "isError:true must not carry extract delivery; unpaid challenge is PaymentRequired only",
    ));
  }
  if (classified.kind === "paid_delivery" || classified.charged === true) {
    violations.push(violation(
      CODES.HTTP_200_ISERROR_CLASSIFIED_AS_CHARGED,
      "HTTP 200 without isError payment-required body was treated as paid delivery",
    ));
  }

  if (classified.kind !== "unpaid_mcp_iserror_challenge") {
    if (!violations.some((item) => item.code === kindCode(classified.kind)
      || item.code === CODES.PAYMENT_REQUIRED_HEADER
      || item.code === CODES.INVENTED_RECEIPT_FIELD
      || item.code === CODES.PAYMENT_SIGNATURE_SENT
      || item.code === CODES.HTTP_200_ISERROR_CLASSIFIED_AS_CHARGED
      || item.code === CODES.ASSET_MISMATCH
      || item.code === CODES.PIN_MISMATCH
      || item.code === CODES.VERIFY_ON_UNPAID
      || item.code === CODES.SETTLE_ON_UNPAID
      || item.code === CODES.HANDLER_RAN_UNPAID)) {
      violations.push(violation(
        kindCode(classified.kind),
        `tools/call is ${classified.kind}, not unpaid_mcp_iserror_challenge`,
      ));
    }
  } else {
    if (classified.httpStatus !== 200) {
      violations.push(violation(
        CODES.HTTP_402_NOT_MCP_ISERROR,
        `expected HTTP 200, got ${classified.httpStatus}`,
      ));
    }
    if (classified.isError !== true) {
      violations.push(violation(
        CODES.ISERROR_NOT_TRUE,
        "unpaid tools/call must set result.isError===true",
      ));
    }
    if (classified.hasJsonRpcError) {
      violations.push(violation(
        CODES.JSONRPC_ERROR_NOT_ISERROR,
        "unpaid tools/call must be JSON-RPC result, not error",
      ));
    }
    if (classified.resourceUrl !== SDS.mcpResourceUrl) {
      violations.push(violation(
        CODES.RESOURCE_MISMATCH,
        `resource.url ${JSON.stringify(classified.resourceUrl)} is not ${SDS.mcpResourceUrl}`,
        { expected: SDS.mcpResourceUrl, actual: classified.resourceUrl },
      ));
    }
    if (classified.error && !/payment required to access this tool/i.test(classified.error)) {
      violations.push(violation(
        CODES.MALFORMED_FIXTURE,
        `unpaid error ${JSON.stringify(classified.error)} is not the MCP payment-required tool error`,
      ));
    }
    violations.push(...pinMismatch(classified));
    if (!classified.amount) {
      violations.push(violation(CODES.AMOUNT_MISMATCH, "tools/call accepts[].amount is missing"));
    }
  }

  const primary = violations[0];
  return {
    ok: violations.length === 0,
    code: violations.length === 0 ? CODES.UNPAID_MCP_ISERROR : primary.code,
    id: fixture.id ?? null,
    expect: fixture.expect ?? null,
    rejectCode: fixture.rejectCode ?? null,
    method: "tools/call",
    classified,
    violations,
    claimsRejected: claimsDemandCharge(claims)
      && violations.some((item) => item.code === CODES.HTTP_200_ISERROR_CLASSIFIED_AS_CHARGED),
  };
}

export function evaluateFixture(fixture = {}) {
  if (!isRecord(fixture)) {
    return {
      ok: false,
      code: CODES.MALFORMED_FIXTURE,
      id: null,
      expect: null,
      rejectCode: null,
      method: null,
      classified: null,
      violations: [violation(CODES.MALFORMED_FIXTURE, "fixture is not an object")],
      claimsRejected: false,
    };
  }
  return isToolsList(fixture) ? evaluateToolsList(fixture) : evaluateToolsCall(fixture);
}

export function classifyFixture(fixture) {
  const evaluated = evaluateFixture(fixture);
  const expect = fixture?.expect;
  if (expect === "pass") {
    return {
      ...evaluated,
      classifiedOk: evaluated.ok,
      verdict: evaluated.ok ? "pass" : "fail",
    };
  }
  if (expect === "reject") {
    const codeOk = !fixture.rejectCode
      || evaluated.code === fixture.rejectCode
      || evaluated.violations.some((item) => item.code === fixture.rejectCode);
    const rejected = evaluated.ok === false && codeOk;
    return {
      ...evaluated,
      classifiedOk: rejected,
      verdict: rejected ? "rejected" : "not-rejected",
    };
  }
  return {
    ...evaluated,
    classifiedOk: evaluated.ok,
    verdict: evaluated.ok ? "pass" : "fail",
  };
}

export function evaluateFixtureCorpus(passEntries, rejectEntries) {
  const rows = [];
  for (const entry of passEntries) {
    const classified = classifyFixture(entry.fixture);
    rows.push({
      id: entry.id,
      path: entry.relativePath,
      expect: "pass",
      ok: classified.verdict === "pass",
      code: classified.code,
      verdict: classified.verdict,
    });
  }
  for (const entry of rejectEntries) {
    const classified = classifyFixture(entry.fixture);
    rows.push({
      id: entry.id,
      path: entry.relativePath,
      expect: "reject",
      rejectCode: entry.rejectCode,
      ok: classified.verdict === "rejected",
      code: classified.code,
      verdict: classified.verdict,
    });
  }
  const failed = rows.filter((row) => !row.ok);
  return {
    ok: failed.length === 0 && rows.length > 0,
    counted: rows.length,
    passed: rows.filter((row) => row.ok).length,
    failed,
    rows,
  };
}

export function evaluateColdSuite({
  toolsList,
  toolsCall,
  counters,
  origin,
  serverInfo,
  productionList = null,
  productionCall = null,
  productionCounters = null,
  productionOrigin = null,
} = {}) {
  const list = evaluateToolsList(toolsList);
  const call = evaluateToolsCall(toolsCall);
  const prodList = productionList ? evaluateToolsList(productionList) : null;
  const prodCall = productionCall ? evaluateToolsCall(productionCall) : null;
  const productionOk = (prodList == null || prodList.ok === true)
    && (prodCall == null || prodCall.ok === true)
    && Number(productionCounters?.settle || 0) === 0
    && Number(productionCounters?.verify || 0) === 0;
  const mountedOk = list.ok === true && call.ok === true
    && Number(counters?.handler || 0) === 0
    && Number(counters?.settle || 0) === 0
    && Number(counters?.verify || 0) === 0;
  const ok = mountedOk && productionOk;
  const failCode = !call.ok ? call.code
    : !list.ok ? list.code
    : prodCall && !prodCall.ok ? prodCall.code
    : prodList && !prodList.ok ? prodList.code
    : CODES.UNPAID_MCP_ISERROR;
  return {
    ok,
    mode: "cold",
    artifact: productionCall ? "mcp-server.mjs+server.js" : "mcp-server.mjs",
    code: ok ? CODES.UNPAID_MCP_ISERROR : failCode,
    origin,
    serverInfo,
    paymentSent: false,
    paymentSignatureSent: false,
    toolsList: list,
    toolsCall: call,
    counters,
    production: productionCall ? {
      origin: productionOrigin,
      toolsList: prodList,
      toolsCall: prodCall,
      counters: productionCounters,
    } : null,
    boundary: {
      paymentSent: false,
      paymentSignatureSent: false,
      liveFacilitator: false,
      published: false,
      ownerCdp: false,
      neoTouched: false,
    },
  };
}
