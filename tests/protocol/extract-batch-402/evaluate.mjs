import {
  BATCH,
  CODES,
  EXTRACT_GET,
  FORBIDDEN_INVENTED,
  PAID_REQUEST_HEADERS,
  PAID_RESPONSE_HEADERS,
  R6_02_REWRITE_CODES,
  SCHEMA_FIXTURE,
  SCHEMA_REPORT,
} from "./constants.mjs";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function upper(value) {
  return String(value || "").toUpperCase();
}

function headerMap(headers) {
  const map = new Map();
  if (!isRecord(headers)) return map;
  for (const [name, value] of Object.entries(headers)) {
    if (typeof name === "string") map.set(name.toLowerCase(), value);
  }
  return map;
}

function headerValue(headers, name) {
  const value = headerMap(headers).get(String(name).toLowerCase());
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

export function pathnameOf(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith("/") ? url.split("?")[0] : null;
  }
}

function challengeOf(obs) {
  if (isRecord(obs.challenge)) return obs.challenge;
  if (isRecord(obs.body) && Array.isArray(obs.body.accepts)) return obs.body;
  return {};
}

function bazaarInput(challenge) {
  const bazaar = challenge?.extensions?.bazaar;
  const info = isRecord(bazaar) ? bazaar.info : null;
  return isRecord(info) ? info.input : null;
}

function firstAccept(challenge) {
  const accepts = Array.isArray(challenge?.accepts) ? challenge.accepts : [];
  return isRecord(accepts[0]) ? accepts[0] : null;
}

function offerPayloads(challenge) {
  const offers = challenge?.extensions?.["offer-receipt"]?.info?.offers;
  if (!Array.isArray(offers)) return [];
  return offers.map((entry) => (isRecord(entry?.payload) ? entry.payload : null)).filter(Boolean);
}

export function atomicString(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value) ? value : null;
}

function sameAtomic(value, expected) {
  return typeof value === "string" && value === expected;
}

function addr(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function violation(code, message, extra = {}) {
  return { code, message, ...extra };
}

function requestMethod(obs) {
  return upper(obs.request?.method || obs.method);
}

function resourcePath(obs) {
  const challenge = challengeOf(obs);
  const url = challenge?.resource?.url || obs.request?.url || obs.listing?.resourceUrl || obs.url;
  return pathnameOf(url);
}

function collectInvented(obs) {
  const hits = new Set();
  const bags = [obs.claims, obs.receipt, obs.namedReceiptFields];
  const texts = [];
  for (const bag of bags) {
    if (isRecord(bag)) {
      for (const key of Object.keys(bag)) texts.push(key);
      texts.push(JSON.stringify(bag));
    } else if (Array.isArray(bag)) {
      for (const item of bag) texts.push(String(item));
    }
  }
  if (Array.isArray(obs.receiptFields)) {
    for (const item of obs.receiptFields) texts.push(typeof item === "string" ? item : item?.name || "");
  }
  const blob = texts.join("\n");
  for (const name of FORBIDDEN_INVENTED) {
    if (new RegExp(`\\b${name}\\b`).test(blob)) hits.add(name);
  }
  return [...hits];
}

function paidHop(obs) {
  const reqHeaders = obs.request?.headers || obs.requestHeaders;
  for (const name of PAID_REQUEST_HEADERS) {
    const value = headerValue(reqHeaders, name);
    if (typeof value === "string" && value.length > 0) {
      return { paid: true, reason: `request carries ${name}` };
    }
  }
  const authorization = headerValue(reqHeaders, "authorization");
  if (typeof authorization === "string" && /^\s*Payment\s+/i.test(authorization)) {
    return { paid: true, reason: "request carries Authorization: Payment" };
  }
  const resHeaders = obs.responseHeaders || obs.headers;
  for (const name of PAID_RESPONSE_HEADERS) {
    const value = headerValue(resHeaders, name);
    if (typeof value === "string" && value.length > 0) {
      return { paid: true, reason: `response carries ${name}` };
    }
  }
  if (obs.boundary?.paymentSent === true || obs.paymentSent === true) {
    return { paid: true, reason: "boundary.paymentSent" };
  }
  const meta = obs.request?.params?._meta;
  if (isRecord(meta) && isRecord(meta["x402/payment"])) {
    return { paid: true, reason: "request carries _meta[x402/payment]" };
  }
  return { paid: false };
}

/**
 * GET /extract rewritten as POST (R6-02 unsupported_target).
 * Native POST /extract/batch is not this rewrite.
 */
export function isGetExtractRewrite(obs = {}) {
  if (!isRecord(obs)) return false;
  const listing = isRecord(obs.listing) ? obs.listing : {};
  const seller = isRecord(obs.seller) ? obs.seller : {};
  const challenge = challengeOf(obs);
  const input = bazaarInput(challenge);
  const path = resourcePath(obs);
  const method = requestMethod(obs) || upper(listing.method);
  const sellerMethod = upper(seller.method);
  const bazaarMethod = upper(input?.method);
  const body = isRecord(obs.request?.body) ? obs.request.body : isRecord(input?.body) ? input.body : {};
  const amount = firstAccept(challenge)?.amount ?? listing.amountAtomic ?? obs.claims?.amountAtomic;

  if (listing.rewritesSellerMethod === true) return true;
  if (obs.kind === "method-rewrite" || obs.kind === "get-extract-rewrite") return true;
  if (path === EXTRACT_GET.path && method === "POST") return true;
  if (path === EXTRACT_GET.path && sellerMethod === "GET" && method === "POST") return true;
  if (path === EXTRACT_GET.path && bazaarMethod === "GET" && method === "POST") return true;
  if (path === EXTRACT_GET.path && Object.hasOwn(body, "url") && !Object.hasOwn(body, "urls") && method === "POST") {
    return true;
  }
  if (path === EXTRACT_GET.path && sameAtomic(amount, EXTRACT_GET.amountAtomic) && method === "POST") {
    return true;
  }
  return false;
}

function nativeShape(obs) {
  const challenge = challengeOf(obs);
  const path = resourcePath(obs);
  const method = requestMethod(obs);
  const input = bazaarInput(challenge);
  const accepted = firstAccept(challenge);
  return {
    path,
    method,
    bazaarMethod: upper(input?.method),
    amount: accepted?.amount ?? null,
    resourceUrl: challenge?.resource?.url || obs.request?.url || null,
    hasUrls: Array.isArray(input?.body?.urls) || Array.isArray(obs.request?.body?.urls),
  };
}

function collectedAmounts(obs) {
  const challenge = challengeOf(obs);
  const amounts = [];
  const accepted = firstAccept(challenge);
  if (accepted?.amount != null) amounts.push({ source: "accepts[0].amount", value: accepted.amount });
  for (const payload of offerPayloads(challenge)) {
    if (payload.amount != null) amounts.push({ source: "offer-receipt.payload.amount", value: payload.amount });
  }
  const quote = challenge?.extensions?.bazaar?.info?.output?.example?.quote?.amountAtomic;
  if (quote != null) amounts.push({ source: "bazaar.output.example.quote.amountAtomic", value: quote });
  if (obs.wellKnown?.amount != null) amounts.push({ source: "wellKnown.amount", value: obs.wellKnown.amount });
  const mcpBatch = obs.mcp?.extract_batch?.amount ?? obs.mcp?.amount;
  if (mcpBatch != null) amounts.push({ source: "mcp.extract_batch.amount", value: mcpBatch });
  if (obs.openapi?.atomicAmount != null) amounts.push({ source: "openapi.atomicAmount", value: obs.openapi.atomicAmount });
  return amounts;
}

function claimsRewriteAsExtract(claims) {
  if (!isRecord(claims)) return false;
  const classification = String(claims.classification || claims.classifiedAs || "");
  if (["get_extract_rewrite", "extract_rewrite", "unsupported_target", "get-extract-rewritten-as-post"].includes(classification)) {
    return true;
  }
  if (claims.r6_02_code && R6_02_REWRITE_CODES.includes(String(claims.r6_02_code))) return true;
  if (claims.one_paywall === true && sameAtomic(String(claims.amountAtomic ?? ""), EXTRACT_GET.amountAtomic)) {
    return true;
  }
  if (claims.one_paywall === true && claims.method === "GET" && claims.path === EXTRACT_GET.path) return true;
  return false;
}

function absenceClaimedAsDemand(obs) {
  const claims = isRecord(obs.claims) ? obs.claims : {};
  const emptyCatalog = Array.isArray(obs.catalogSearch?.resources) && obs.catalogSearch.resources.length === 0;
  const missing = obs.wellKnownMissing === true || obs.routeAbsent === true || emptyCatalog;
  const demanded = claims.demand === true
    || claims.treatAbsenceAsDemand === true
    || claims.shouldList === true
    || claims.absenceIsDemand === true;
  return { missing, demanded };
}

function openapiOk(obs) {
  const openapi = obs.openapi;
  if (!isRecord(openapi)) return { present: false, ok: true, reasons: [] };
  const reasons = [];
  const method = String(openapi.method || "").toLowerCase();
  if (method && method !== "post") reasons.push(`openapi method is ${method}, not post`);
  const desc = String(openapi.paymentRequiredDescription || openapi.description402 || "");
  if (desc && !desc.includes("$0.01")) reasons.push("openapi 402 text missing $0.01");
  if (desc && !/introductory flat batch quote/i.test(desc)) {
    reasons.push("openapi 402 text missing introductory flat batch quote");
  }
  if (openapi.path && openapi.path !== BATCH.path) reasons.push(`openapi path ${openapi.path} is not ${BATCH.path}`);
  return { present: true, ok: reasons.length === 0, reasons };
}

function wellKnownOk(obs) {
  const item = obs.wellKnown;
  if (!isRecord(item)) return { present: false, ok: true, reasons: [] };
  const reasons = [];
  if (item.requestMethod && upper(item.requestMethod) !== "POST") {
    reasons.push(`well-known request.method is ${item.requestMethod}, not POST`);
  }
  if (item.routeTemplate && item.routeTemplate !== BATCH.path) {
    reasons.push(`well-known routeTemplate is ${item.routeTemplate}, not ${BATCH.path}`);
  }
  if (item.amount != null && !sameAtomic(item.amount, BATCH.amountAtomic)) {
    reasons.push(`well-known amount ${JSON.stringify(item.amount)} is not ${BATCH.amountAtomic}`);
  }
  return { present: true, ok: reasons.length === 0, reasons };
}

/**
 * Classify one unpaid observation as native POST /extract/batch 402 amount 10000
 * or refuse GET-/extract rewrites, amount copies, invented fields, and paid hops.
 * Never emits R6-02 `unsupported_target` / `one_paywall`.
 */
export function evaluateObservation(obs = {}) {
  const violations = [];
  if (!isRecord(obs)) {
    return {
      ok: false,
      code: CODES.MALFORMED_FIXTURE,
      verdict: "reject",
      id: null,
      violations: [violation(CODES.MALFORMED_FIXTURE, "observation is not an object")],
      rewrite: false,
      emittedR602: [],
    };
  }

  const paid = paidHop(obs);
  if (paid.paid) {
    violations.push(violation(CODES.PAYMENT_SENT, paid.reason));
  }

  const invented = collectInvented(obs);
  if (invented.length) {
    violations.push(violation(
      CODES.INVENTED_RECEIPT_FIELD,
      `invented receipt field without live schema citation: ${invented.join(",")}`,
      { invented },
    ));
  }

  const absence = absenceClaimedAsDemand(obs);
  if (absence.demanded) {
    violations.push(violation(
      CODES.TREAT_ABSENCE_AS_DEMAND,
      "catalog or well-known absence is not buyer demand",
    ));
  }

  const rewrite = isGetExtractRewrite(obs);
  const claims = isRecord(obs.claims) ? obs.claims : {};
  const shape = nativeShape(obs);
  const challenge = challengeOf(obs);
  const accepted = firstAccept(challenge);
  const httpStatus = obs.httpStatus ?? obs.status ?? null;

  if (rewrite) {
    violations.push(violation(
      CODES.NOT_EXTRACT_REWRITE,
      "GET /extract rewritten as POST is not native POST /extract/batch",
      {
        path: shape.path,
        method: shape.method,
        amount: accepted?.amount ?? null,
      },
    ));
  }

  if (!rewrite && claimsRewriteAsExtract(claims)) {
    violations.push(violation(
      CODES.NOT_EXTRACT_REWRITE,
      "native POST /extract/batch must not be classified as GET /extract rewrite or one_paywall 5000",
      { classification: claims.classification || claims.classifiedAs || null, amountAtomic: claims.amountAtomic ?? null },
    ));
  }

  if (!rewrite) {
    if (shape.method && shape.method !== "POST") {
      violations.push(violation(CODES.METHOD_NOT_POST, `request method is ${shape.method}, not POST`));
    }
    if (shape.path && shape.path !== BATCH.path) {
      violations.push(violation(CODES.PATH_NOT_BATCH, `resource path is ${shape.path}, not ${BATCH.path}`));
    }
    if (httpStatus != null && httpStatus !== 402) {
      violations.push(violation(CODES.HTTP_NOT_402, `HTTP ${httpStatus} is not unpaid 402`));
    }
    if (shape.bazaarMethod && shape.bazaarMethod !== "POST") {
      violations.push(violation(
        CODES.BAZAAR_METHOD_NOT_POST,
        `bazaar.info.input.method is ${shape.bazaarMethod}, not POST`,
      ));
    }

    const amounts = collectedAmounts(obs);
    for (const row of amounts) {
      if (!sameAtomic(row.value, BATCH.amountAtomic)) {
        violations.push(violation(
          CODES.AMOUNT_MISMATCH,
          `${row.source}=${JSON.stringify(row.value)} is not native batch ${BATCH.amountAtomic} (string compare, no unit convert)`,
          { source: row.source, actual: row.value, expected: BATCH.amountAtomic },
        ));
      }
    }

    if (accepted) {
      if (accepted.network && accepted.network !== BATCH.network) {
        violations.push(violation(CODES.AMOUNT_MISMATCH, `network ${accepted.network} is not ${BATCH.network}`));
      }
      if (addr(accepted.payTo) && addr(accepted.payTo) !== addr(BATCH.payTo)) {
        violations.push(violation(CODES.AMOUNT_MISMATCH, `payTo ${accepted.payTo} is not the SDS owner`));
      }
    }

    const oa = openapiOk(obs);
    for (const reason of oa.reasons) violations.push(violation(CODES.AMOUNT_MISMATCH, reason));
    const wk = wellKnownOk(obs);
    for (const reason of wk.reasons) {
      const code = /amount/.test(reason) ? CODES.AMOUNT_MISMATCH : CODES.BAZAAR_METHOD_NOT_POST;
      violations.push(violation(code, reason));
    }

    if (isRecord(obs.mcp?.extract) && sameAtomic(obs.mcp.extract.amount, EXTRACT_GET.amountAtomic)
      && sameAtomic(obs.mcp?.extract_batch?.amount ?? obs.mcp?.amount, EXTRACT_GET.amountAtomic)
      && !sameAtomic(obs.mcp?.extract_batch?.amount, BATCH.amountAtomic)) {
      violations.push(violation(
        CODES.AMOUNT_MISMATCH,
        "mcp extract_batch copied GET /extract amount 5000",
      ));
    }
  }

  const emittedR602 = [];
  for (const code of R6_02_REWRITE_CODES) {
    if (violations.some((item) => item.code === code) || obs.code === code || claims.decision === code) {
      emittedR602.push(code);
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of violations) {
    const key = `${item.code}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  const ok = unique.length === 0
    && !rewrite
    && shape.path === BATCH.path
    && (shape.method === "POST" || !shape.method)
    && (httpStatus === 402 || httpStatus == null)
    && (accepted ? sameAtomic(accepted.amount, BATCH.amountAtomic) : collectedAmounts(obs).length > 0 || Boolean(obs.wellKnown || obs.mcp));

  const primary = unique[0];
  return {
    ok,
    code: ok ? CODES.NATIVE : primary?.code || CODES.MALFORMED_FIXTURE,
    verdict: ok ? "native_post_extract_batch" : "reject",
    id: obs.id ?? null,
    expect: obs.expect ?? null,
    rejectCode: obs.rejectCode ?? null,
    rewrite,
    path: shape.path,
    method: shape.method || null,
    bazaarMethod: shape.bazaarMethod || null,
    amount: accepted?.amount ?? collectedAmounts(obs)[0]?.value ?? null,
    httpStatus,
    invented,
    claimsRejected: Boolean(claims.ok === true || claims.one_paywall === true || claimsRewriteAsExtract(claims)) && unique.length > 0,
    emittedR602,
    violations: unique,
    schema: SCHEMA_REPORT,
  };
}

export function classifyFixture(fixture) {
  const evaluated = evaluateObservation(fixture);
  const expect = fixture?.expect;
  if (expect === "pass") {
    const classified = evaluated.ok === true && evaluated.code === CODES.NATIVE && evaluated.emittedR602.length === 0;
    return { ...evaluated, classified, fixtureVerdict: classified ? "pass" : "fail" };
  }
  if (expect === "reject") {
    const codeOk = !fixture.rejectCode
      || evaluated.code === fixture.rejectCode
      || evaluated.violations.some((item) => item.code === fixture.rejectCode);
    const classified = evaluated.ok === false && codeOk && evaluated.emittedR602.length === 0;
    return {
      ...evaluated,
      classified,
      fixtureVerdict: evaluated.ok ? "accepted" : "rejected",
      ok: classified,
    };
  }
  return {
    ...evaluated,
    classified: false,
    fixtureVerdict: "malformed_fixture",
    ok: false,
    code: CODES.MALFORMED_FIXTURE,
  };
}

export function evaluateFixtureCorpus(passFixtures, rejectFixtures) {
  const pass = passFixtures.map((entry) => {
    const classified = classifyFixture(entry.fixture);
    return {
      ...classified,
      id: entry.id,
      path: entry.relativePath,
      resourcePath: classified.path,
      expect: "pass",
    };
  });
  const reject = rejectFixtures.map((entry) => {
    const classified = classifyFixture(entry.fixture);
    return {
      ...classified,
      id: entry.id,
      path: entry.relativePath,
      resourcePath: classified.path,
      expect: "reject",
      rejectCode: entry.rejectCode,
    };
  });
  const rows = [...pass, ...reject];
  const failed = rows.filter((row) => row.classified !== true);
  return {
    schema: SCHEMA_FIXTURE,
    ok: failed.length === 0 && rows.length > 0,
    code: failed[0]?.code ?? "fixtures-match",
    counted: rows.length,
    passed: rows.filter((row) => row.classified).length,
    failed: failed.map((row) => ({
      id: row.id,
      path: row.path,
      expect: row.expect,
      code: row.code,
      fixtureVerdict: row.fixtureVerdict,
      violations: row.violations,
    })),
    rows: rows.map((row) => ({
      id: row.id,
      path: row.path,
      resourcePath: row.resourcePath,
      expect: row.expect,
      classified: row.classified,
      code: row.code,
      rewrite: row.rewrite,
      amount: row.amount,
    })),
  };
}

export function evaluateCold(observation) {
  const evaluated = evaluateObservation(observation);
  return {
    ...evaluated,
    mode: "cold",
    artifact: observation?.artifact || `${BATCH.origin}${BATCH.path}`,
    paymentSent: false,
    quotes: {
      httpStatus: evaluated.httpStatus,
      amount: evaluated.amount,
      bazaarMethod: evaluated.bazaarMethod,
      path: evaluated.path,
      method: evaluated.method,
      openapi402: observation?.openapi?.paymentRequiredDescription ?? null,
      wellKnownMethod: observation?.wellKnown?.requestMethod ?? null,
      mcpExtractBatchAmount: observation?.mcp?.extract_batch?.amount ?? observation?.mcp?.amount ?? null,
    },
  };
}
