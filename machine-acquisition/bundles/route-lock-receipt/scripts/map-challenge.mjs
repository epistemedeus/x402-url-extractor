import { classifyInstant } from "./time.mjs";

const REQUEST_SCHEMA = "route-lock.decision-request.v1";
const MAX_TIMEOUT_SECONDS = 900;

export function decodeBase64Json(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function headerMap(headers) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") continue;
    out[key.toLowerCase()] = value;
  }
  return out;
}

export function relationUrls(linkHeader, relation) {
  if (typeof linkHeader !== "string" || !linkHeader.trim()) return [];
  const wanted = String(relation || "").toLowerCase();
  const urls = [];
  const parts = linkHeader.split(/,(?=\s*<)/);
  for (const part of parts) {
    const match = part.match(/<([^>]+)>/);
    if (!match) continue;
    const relMatch = part.match(/;\s*rel=(?:"([^"]+)"|([^;]+))/i);
    const rel = (relMatch?.[1] || relMatch?.[2] || "").trim();
    const tokens = rel.split(/\s+/).filter(Boolean).map((token) => token.toLowerCase());
    if (!tokens.includes(wanted)) continue;
    urls.push(match[1].trim());
  }
  return urls;
}

export function describedByUrls(linkHeader) {
  return relationUrls(linkHeader, "describedby");
}

export function serviceDescUrls(linkHeader) {
  return relationUrls(linkHeader, "service-desc");
}

function httpsUrl(value) {
  if (typeof value !== "string" || !value.startsWith("https://")) return null;
  if (value.includes(" ") || value.includes("#")) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return url;
}

function sameOrigin(left, right) {
  return Boolean(left && right && left.origin === right.origin);
}

function operationRequiredPaths(document, method, route) {
  const operations = Array.isArray(document?.operations) ? document.operations : [];
  const match = operations.find((operation) => (
    String(operation?.method || "").toUpperCase() === method
    && operation?.path === route
  ));
  const paths = match?.output?.requiredPaths;
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string" || !path.trim())) return null;
  return paths;
}

function isOpenApiDocument(document) {
  return Boolean(
    document
    && typeof document === "object"
    && !Array.isArray(document)
    && typeof document.openapi === "string"
    && document.paths
    && typeof document.paths === "object",
  );
}

function isX402Catalog(document) {
  return Boolean(
    document
    && typeof document === "object"
    && !Array.isArray(document)
    && !isOpenApiDocument(document)
    && typeof document.x402Version === "number"
    && Array.isArray(document.items),
  );
}

const ATOMIC_AMOUNT = /^(?:0|[1-9][0-9]{0,77})$/;

function usableLinkedBody(item) {
  if (!item || item.redirected === true) return null;
  if (item.status !== undefined && item.status !== null && item.status !== 200) return null;
  if (!item.body || typeof item.body !== "object" || Array.isArray(item.body)) return null;
  return item.body;
}

function linkedItems(capture) {
  return [
    ...(Array.isArray(capture?.describedBy) ? capture.describedBy : []),
    ...(Array.isArray(capture?.serviceDescriptions) ? capture.serviceDescriptions : []),
  ];
}

function catalogRecordsFor(document, resourceUrl, method) {
  if (!isX402Catalog(document) || !resourceUrl || !method) return [];
  const records = [];
  for (const item of document.items) {
    if (!item || typeof item !== "object") continue;
    const itemMethod = String(item.request?.method || item.method || "").toUpperCase();
    if (itemMethod !== method) continue;
    const rawUrl = item.resource && typeof item.resource.url === "string" ? item.resource.url : null;
    const url = httpsUrl(rawUrl);
    if (!url || !sameOrigin(url, resourceUrl) || url.pathname !== resourceUrl.pathname) continue;
    const accept = Array.isArray(item.accepts)
      ? item.accepts.find((entry) => entry && typeof entry === "object")
      : null;
    const record = {
      source: "x402-catalog",
      method: itemMethod,
      url: url.toString(),
    };
    if (accept?.scheme === "exact") record.protocol = "x402";
    if (typeof accept?.amount === "string" && ATOMIC_AMOUNT.test(accept.amount)) record.amountAtomic = accept.amount;
    if (typeof accept?.network === "string" && accept.network.trim()) record.network = accept.network;
    if (typeof accept?.asset === "string" && accept.asset.trim()) record.asset = accept.asset;
    if (typeof accept?.payTo === "string" && accept.payTo.trim()) record.recipient = accept.payTo;
    records.push(record);
  }
  return records;
}

function openApiFor(documents, method, route) {
  const candidates = documents.filter((document) => isOpenApiDocument(document));
  const bound = candidates.find((document) => {
    const operation = document.paths?.[route]?.[String(method || "").toLowerCase()];
    return operation && typeof operation === "object";
  });
  return bound || candidates[0] || null;
}

function resolveLink(value, base) {
  if (typeof value !== "string" || !value.trim() || value.includes(" ") || value.includes("\\")) return null;
  let url;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  return url;
}

function challengeDocument(headers, body) {
  const fromHeader = decodeBase64Json(headers["payment-required"] || headers["x-payment-required"]);
  if (fromHeader && typeof fromHeader === "object") {
    return { document: fromHeader, source: "header.payment-required" };
  }
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return { document: body, source: "body" };
  }
  return { document: null, source: null };
}

function firstAccept(document) {
  const accepts = Array.isArray(document?.accepts) ? document.accepts : [];
  const accept = accepts.find((item) => item && typeof item === "object");
  return accept || null;
}

function documentedMethod(document) {
  const candidates = [
    document?.extensions?.bazaar?.info?.input?.method,
    document?.accepts?.[0]?.outputSchema?.input?.method,
  ];
  for (const candidate of candidates) {
    if (candidate === "GET" || candidate === "POST") return candidate;
  }
  return null;
}

function wwwAuthenticateParams(value) {
  if (typeof value !== "string") return {};
  const out = {};
  const pattern = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|([^,\s]+))/g;
  for (const match of value.matchAll(pattern)) {
    out[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
  }
  return out;
}

function copyString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

export function flipRecipient(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const last = value.slice(-1);
  const flipped = (parseInt(last, 16) + 1) % 16;
  return `${value.slice(0, -1)}${flipped.toString(16)}`;
}

function replaceJsonRecipient(document, next) {
  if (!document || typeof document !== "object") return document;
  const copy = structuredClone(document);
  if (Array.isArray(copy.accepts)) {
    for (const accept of copy.accepts) {
      if (accept && typeof accept === "object" && typeof accept.payTo === "string") accept.payTo = next;
    }
  }
  if (typeof copy.recipient === "string") copy.recipient = next;
  if (typeof copy.payTo === "string") copy.payTo = next;
  return copy;
}

export function mapDocumentedChallenge(capture) {
  const headers = headerMap(capture?.headers);
  const requestUrl = httpsUrl(capture?.requestUrl);
  const absentEvidence = [];
  const fieldSources = [];
  const assigned = ["subject.id"];
  const body = capture?.body && typeof capture.body === "object" ? capture.body : null;
  const challenge = challengeDocument(headers, body);
  const document = challenge.document;
  const accept = firstAccept(document);
  const resourceUrl = httpsUrl(document?.resource?.url) || requestUrl;
  const method = documentedMethod(document) || (requestUrl ? "GET" : null);
  if (documentedMethod(document)) fieldSources.push({ to: "subject.method", from: `${challenge.source}.method` });
  else if (method) {
    fieldSources.push({ to: "subject.method", from: "client-request-method" });
    assigned.push("subject.method");
  }

  if (!document) absentEvidence.push("payment_challenge_document");
  if (!accept) absentEvidence.push("accept_terms");
  if (!resourceUrl) absentEvidence.push("resource_url");

  if (requestUrl && resourceUrl && requestUrl.origin !== resourceUrl.origin) {
    absentEvidence.push("resource_origin_differs_from_request");
  }
  const linkBase = requestUrl ? requestUrl.toString() : null;
  const acceptLink = (value) => {
    const url = resolveLink(value, linkBase);
    if (!url || !requestUrl || url.origin !== requestUrl.origin) return null;
    return url;
  };
  const describedBy = Array.isArray(capture?.describedBy) ? capture.describedBy : [];
  const linked = describedByUrls(headers.link);
  let describedByDocument = null;
  let describedByUrl = null;
  if (linked.length === 0) absentEvidence.push("describedby_link");
  else {
    const chosen = linked.map(acceptLink).find(Boolean);
    if (!chosen) absentEvidence.push("describedby_same_origin");
    else {
      describedByUrl = chosen.toString();
      const fetched = describedBy.find((item) => item?.url === describedByUrl);
      const fetchedBody = usableLinkedBody(fetched);
      if (!fetchedBody) absentEvidence.push("describedby_document");
      else describedByDocument = fetchedBody;
    }
  }

  const serviceLinks = serviceDescUrls(headers.link);
  const sameOriginService = serviceLinks.map(acceptLink).filter(Boolean);
  if (serviceLinks.length && sameOriginService.length === 0) absentEvidence.push("service_desc_origin_mismatch");
  const allowedUrls = new Set([
    ...(describedByUrl ? [describedByUrl] : []),
    ...sameOriginService.map((url) => url.toString()),
  ]);
  const linkedBodies = linkedItems(capture)
    .filter((item) => allowedUrls.has(item?.url))
    .map((item) => usableLinkedBody(item))
    .filter(Boolean);
  const openApiDocument = openApiFor(linkedBodies, method, resourceUrl?.pathname)
    || [body, document].find((item) => isOpenApiDocument(item))
    || null;
  if (!openApiDocument) absentEvidence.push("openapi_document");
  const catalogRecords = linkedBodies.flatMap((item) => catalogRecordsFor(item, resourceUrl, method));
  if (!catalogRecords.length) absentEvidence.push("catalog_records");

  let observedAt = null;
  let observedAtState = "unknown";
  let observedAtSource = null;
  if (typeof headers.date === "string") {
    const classified = classifyInstant(headers.date);
    if (classified.state === "known") {
      observedAt = classified.iso;
      observedAtState = "known";
      observedAtSource = "header.date";
      fieldSources.push({ to: "subject.runtime.observedAt", from: "header.date" });
    } else {
      observedAtState = "malformed";
      absentEvidence.push("observed_at_malformed");
    }
  } else if (capture?.observedAtFallback) {
    const classified = classifyInstant(capture.observedAtFallback);
    if (classified.state === "known") {
      observedAt = classified.iso;
      observedAtState = "known";
      observedAtSource = "client-observation-clock";
      fieldSources.push({ to: "subject.runtime.observedAt", from: "client-observation-clock" });
      assigned.push("subject.runtime.observedAt");
    } else {
      observedAtState = "malformed";
      absentEvidence.push("observed_at_malformed");
    }
  } else absentEvidence.push("observed_at");

  const amountAtomic = copyString(accept?.amount);
  const network = copyString(accept?.network);
  const asset = copyString(accept?.asset);
  const recipient = copyString(accept?.payTo);
  const scheme = copyString(accept?.scheme);
  if (amountAtomic) fieldSources.push({ to: "terms.amountAtomic", from: `${challenge.source}.accepts[0].amount` });
  else absentEvidence.push("amount");
  if (network) fieldSources.push({ to: "terms.network", from: `${challenge.source}.accepts[0].network` });
  else absentEvidence.push("network");
  if (asset) fieldSources.push({ to: "terms.asset", from: `${challenge.source}.accepts[0].asset` });
  else absentEvidence.push("asset");
  if (recipient) fieldSources.push({ to: "terms.recipient", from: `${challenge.source}.accepts[0].payTo` });
  else absentEvidence.push("recipient");

  const authenticate = wwwAuthenticateParams(headers["www-authenticate"]);
  const mppRequest = decodeBase64Json(authenticate.request);
  let expiresAt = null;
  let expiry = "unknown";
  if (Object.prototype.hasOwnProperty.call(authenticate, "expires")) {
    const classified = classifyInstant(authenticate.expires);
    if (classified.state === "known") {
      expiresAt = classified.iso;
      expiry = "known";
      fieldSources.push({ to: "terms.expiresAt", from: "header.www-authenticate.expires" });
    } else expiry = "malformed";
  }

  const timeoutSeconds = Number(accept?.maxTimeoutSeconds);
  const validityWindowMs = Number.isInteger(timeoutSeconds)
    && timeoutSeconds >= 1
    && timeoutSeconds <= MAX_TIMEOUT_SECONDS
    ? timeoutSeconds * 1000
    : null;
  if (validityWindowMs) fieldSources.push({ to: "validityWindowMs", from: `${challenge.source}.accepts[0].maxTimeoutSeconds` });

  const status = Number(capture?.status);
  const runtimeHeaders = {};
  if (headers["payment-required"]) runtimeHeaders["payment-required"] = headers["payment-required"];
  if (headers["www-authenticate"]) runtimeHeaders["www-authenticate"] = headers["www-authenticate"];
  if (!runtimeHeaders["payment-required"] && !runtimeHeaders["www-authenticate"]) {
    absentEvidence.push("runtime_headers");
  }

  const requiredPaths = resourceUrl && method
    ? operationRequiredPaths(describedByDocument, method, resourceUrl.pathname)
    : null;
  if (requiredPaths) {
    fieldSources.push({
      to: "subject.requiredPaths",
      from: "describedby.operations.output.requiredPaths",
    });
  }

  const terms = {
    method,
    url: resourceUrl ? resourceUrl.toString() : null,
    protocol: scheme === "exact" ? "x402" : null,
    amountAtomic,
    network,
    asset,
    recipient,
    expiresAt,
    expiry,
    status: Number.isInteger(status) ? status : null,
    observedAt,
    observedAtState,
    observedAtSource,
  };
  if (scheme === "exact") fieldSources.push({ to: "terms.protocol", from: `${challenge.source}.accepts[0].scheme` });

  let request = null;
  if (method && resourceUrl && Number.isInteger(status)) {
    const subject = {
      id: "unpaid-challenge",
      origin: resourceUrl.origin,
      method,
      route: resourceUrl.pathname,
      invocationUrl: resourceUrl.toString(),
      runtime: {
        status,
        ...(observedAt ? { observedAt } : {}),
        ...(Object.keys(runtimeHeaders).length ? { headers: runtimeHeaders } : {}),
      },
    };
    fieldSources.push({ to: "subject.origin", from: "resource-url" });
    fieldSources.push({ to: "subject.route", from: "resource-url" });
    fieldSources.push({ to: "subject.invocationUrl", from: "resource-url" });
    fieldSources.push({ to: "subject.runtime.status", from: "http-status" });
    if (requiredPaths) subject.requiredPaths = requiredPaths;
    if (catalogRecords.length) {
      subject.catalogs = catalogRecords;
      fieldSources.push({ to: "subject.catalogs", from: "service-desc.x402-catalog" });
    }
    if (openApiDocument) {
      subject.documents = { x402: openApiDocument };
      fieldSources.push({ to: "subject.documents.x402", from: "linked-openapi" });
    }
    const profile = {};
    if (scheme) profile.x402Scheme = scheme;
    if (network) profile.network = network;
    if (typeof authenticate.method === "string" && authenticate.method) profile.mppMethod = authenticate.method;
    if (typeof authenticate.intent === "string" && authenticate.intent) profile.mppIntent = authenticate.intent;
    if (Object.keys(profile).length) {
      subject.profile = profile;
      fieldSources.push({ to: "subject.profile", from: "challenge-and-www-authenticate" });
    }
    request = {
      schemaVersion: REQUEST_SCHEMA,
      ...(observedAt ? { now: observedAt } : {}),
      ...(validityWindowMs ? { validityWindowMs } : {}),
      subject,
    };
  }

  const checklist = buildChecklist(terms);
  return {
    fieldSources,
    absentEvidence: [...new Set(absentEvidence)],
    assigned,
    request,
    checklist,
    terms,
    describedByUrl,
    openApiCopied: Boolean(openApiDocument),
    catalogCopied: catalogRecords.length > 0,
    mppRequest,
    rawHeaders: runtimeHeaders,
  };
}

function buildChecklist(terms) {
  if (!terms?.method || !terms.url || !terms.protocol || !terms.amountAtomic || !terms.network || !terms.asset || !terms.recipient) {
    return null;
  }
  if (terms.status !== 402) return null;
  const shared = {
    method: terms.method,
    url: terms.url,
    protocol: terms.protocol,
    amountAtomic: terms.amountAtomic,
    network: terms.network,
    asset: terms.asset,
    recipient: terms.recipient,
    ...(terms.expiresAt ? { expiresAt: terms.expiresAt } : {}),
  };
  return {
    schemaVersion: REQUEST_SCHEMA,
    ...(terms.observedAt ? { now: terms.observedAt } : {}),
    authority: shared,
    current: {
      ...shared,
      ...(terms.observedAt ? { evidence: { observedAt: terms.observedAt } } : {}),
      availability: { status: 402 },
    },
  };
}

export function withChangedRecipient(request, mapped) {
  const next = flipRecipient(mapped?.terms?.recipient);
  if (!request || !next) {
    const error = new Error("documented recipient is absent or not a hex address");
    error.code = "recipient_absent";
    throw error;
  }
  const copy = structuredClone(request);
  if (copy.subject?.runtime?.headers) {
    const headers = copy.subject.runtime.headers;
    const payment = decodeBase64Json(headers["payment-required"]);
    if (payment) headers["payment-required"] = Buffer.from(JSON.stringify(replaceJsonRecipient(payment, next))).toString("base64");
    const params = wwwAuthenticateParams(headers["www-authenticate"]);
    const mpp = decodeBase64Json(params.request);
    if (mpp && headers["www-authenticate"]) {
      const replaced = Buffer.from(JSON.stringify(replaceJsonRecipient(mpp, next))).toString("base64");
      headers["www-authenticate"] = headers["www-authenticate"].replace(params.request, replaced);
    }
  }
  if (copy.current?.recipient) copy.current.recipient = next;
  return { request: copy, recipientChanged: true };
}

export function withStaleObservation(request) {
  if (!request) {
    const error = new Error("no documented request to mark stale");
    error.code = "request_absent";
    throw error;
  }
  const copy = structuredClone(request);
  const stale = "2020-01-01T00:00:00.000Z";
  if (copy.subject?.runtime) copy.subject.runtime.observedAt = stale;
  if (copy.current) {
    copy.current.evidence = { ...(copy.current.evidence || {}), observedAt: stale };
  }
  if (!copy.now) copy.now = "2026-10-01T00:00:00.000Z";
  return copy;
}

export function projection(mapped, decision) {
  return {
    fieldSources: mapped?.fieldSources || [],
    absentEvidence: mapped?.absentEvidence || [],
    assigned: mapped?.assigned || [],
    openApiCopied: mapped?.openApiCopied === true,
    catalogCopied: mapped?.catalogCopied === true,
    describedByUrl: mapped?.describedByUrl || null,
    termsPresent: {
      method: Boolean(mapped?.terms?.method),
      url: Boolean(mapped?.terms?.url),
      amountAtomic: Boolean(mapped?.terms?.amountAtomic),
      network: Boolean(mapped?.terms?.network),
      asset: Boolean(mapped?.terms?.asset),
      recipient: Boolean(mapped?.terms?.recipient),
      observedAt: Boolean(mapped?.terms?.observedAt),
      observedAtState: mapped?.terms?.observedAtState || "unknown",
      expiry: mapped?.terms?.expiry || "unknown",
      status: mapped?.terms?.status ?? null,
    },
    decision: decision ? {
      schemaVersion: decision.schemaVersion,
      decision: decision.decision,
      code: decision.code,
      reason: decision.reason,
      evidenceFresh: decision.evidence?.fresh ?? null,
      dimensions: Array.isArray(decision.dimensions)
        ? decision.dimensions.map((item) => ({ id: item.id, status: item.status, code: item.code }))
        : [],
    } : null,
  };
}
