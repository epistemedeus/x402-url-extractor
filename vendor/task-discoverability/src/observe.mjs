import { parseCount } from "./counts.mjs";
import {
  assessInput,
  assessPayment,
  isPlainObject,
  reportedCalls,
  requestConstructible,
  sourceClock,
} from "./construct.mjs";
import {
  BASELINE,
  CHECKED_READERS,
  CONSUMER,
  FROZEN_QUERY,
  FROZEN_SERVICE,
  KNOWN_CALLS,
  ROOT_REPLAY,
  SCHEMA,
  SOURCE,
} from "./pins.mjs";

const REQUEST_KEYS = ["query", "type", "payTo", "scheme", "network", "extensions", "limit", "offset", "cursor"];

function unknownCounts() {
  return {
    partialResults: "unknown",
    partialResultsMeaning: "source did not supply partialResults",
    matchSetTruncated: "unknown",
    declaredReturnedCount: "unknown",
    inspectedCount: "unknown",
    uninspectedCount: "unknown",
    countConflict: false,
    measuredZero: false,
    promotedUninspectedRows: false,
    unboundedCatalogMembership: "unknown",
    observedCountIsCatalogMembership: false,
    paginationPresent: false,
    cursor: null,
    rowsBeyondThisResponse: "unknown",
    catalogRemainder: "unknown",
    reportedPageTotal: "unknown",
  };
}

function parseUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return { url: null, path: null, requested: {}, queryText: null, parse: "absent" };
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { url: value, path: null, requested: {}, queryText: null, parse: "invalid" };
  }
  const requested = {};
  for (const key of REQUEST_KEYS) {
    if (parsed.searchParams.has(key)) requested[key] = parsed.searchParams.get(key);
  }
  return {
    url: value,
    path: parsed.pathname,
    requested,
    queryText: parsed.searchParams.get("query"),
    parse: "ok",
  };
}

function routeKind(path) {
  if (typeof path === "string" && path.endsWith("/discovery/search")) return "search";
  if (typeof path === "string" && path.endsWith("/discovery/resources")) return "list";
  return "unknown";
}

function selectRows(call) {
  if (Array.isArray(call.resources)) return { rows: call.resources, storage: "body" };
  if (Array.isArray(call.items)) return { rows: call.items, storage: "body" };
  if (Array.isArray(call.top)) return { rows: call.top, storage: "retained-projection" };
  return { rows: null, storage: "absent" };
}

function measuredCount(value) {
  if (value === undefined || value === null) return { state: "unknown", value: null };
  const parsed = parseCount(value);
  if (parsed.state === "measured") return { state: "measured", value: parsed.value };
  return { state: "invalid", value: null, reason: parsed.reason };
}

function partialOf(value) {
  if (value === true) {
    return {
      partialResults: true,
      partialResultsMeaning: "facilitator marked this response truncated",
      matchSetTruncated: true,
    };
  }
  if (value === false) {
    return {
      partialResults: false,
      partialResultsMeaning: "facilitator marked this response not truncated",
      matchSetTruncated: false,
    };
  }
  return {
    partialResults: "unknown",
    partialResultsMeaning: "source did not supply partialResults",
    matchSetTruncated: "unknown",
  };
}

function transportOf(call) {
  const allow = typeof call.allow === "string" ? call.allow : null;
  if (call.timedOut === true || call.error === "timeout" || call.reason === "timeout") {
    return { state: "unavailable", reason: "timeout", httpStatus: call.status ?? null, allow, credentialSent: false };
  }
  if (typeof call.status !== "number") {
    return { state: "unavailable", reason: "status-absent", httpStatus: null, allow, credentialSent: false };
  }
  if (call.status >= 200 && call.status < 300) {
    return { state: "supported", reason: null, httpStatus: call.status, allow, credentialSent: false };
  }
  if (call.status >= 400 && call.status < 500) {
    return { state: "refused", reason: `http-${call.status}`, httpStatus: call.status, allow, credentialSent: false };
  }
  return { state: "unavailable", reason: `http-${call.status}`, httpStatus: call.status, allow, credentialSent: false };
}

function coverageFor(call, selected, transport) {
  const base = unknownCounts();
  if (transport.state !== "supported") return base;
  if (selected.storage === "absent") {
    return { ...base, promotedUninspectedRows: false };
  }
  const inspectedCount = selected.rows.length;
  const declared = Object.prototype.hasOwnProperty.call(call, "itemCount") && call.itemCount !== null
    ? measuredCount(call.itemCount)
    : { state: "absent", value: null };
  const partial = partialOf(call.partialResults);
  let declaredReturnedCount = "unknown";
  let countState = "unknown";
  let uninspectedCount = "unknown";
  let countConflict = false;
  if (declared.state === "invalid") {
    declaredReturnedCount = "invalid";
    countState = "invalid";
  } else if (selected.storage === "body" && declared.state === "absent") {
    declaredReturnedCount = inspectedCount;
    countState = "measured";
    uninspectedCount = 0;
  } else if (declared.state === "measured") {
    declaredReturnedCount = declared.value;
    countState = "measured";
    if (declared.value !== inspectedCount && selected.storage === "body") {
      countConflict = true;
      uninspectedCount = declared.value > inspectedCount ? declared.value - inspectedCount : "unknown";
    } else if (declared.value < inspectedCount) {
      countConflict = true;
    } else {
      uninspectedCount = declared.value - inspectedCount;
    }
  }
  const pageTotal = isPlainObject(call.pagination) && Object.prototype.hasOwnProperty.call(call.pagination, "total")
    ? measuredCount(call.pagination.total)
    : { state: "unknown", value: null };
  const cursor = isPlainObject(call.pagination) && typeof call.pagination.cursor === "string"
    ? call.pagination.cursor
    : null;
  return {
    ...partial,
    declaredReturnedCount,
    inspectedCount,
    uninspectedCount,
    countState,
    countConflict,
    measuredZero: declaredReturnedCount === 0 && countConflict === false,
    promotedUninspectedRows: false,
    unboundedCatalogMembership: "unknown",
    observedCountIsCatalogMembership: false,
    paginationPresent: isPlainObject(call.pagination),
    cursor,
    rowsBeyondThisResponse: partial.partialResults === false ? "not-indicated" : "unknown",
    catalogRemainder: "unknown",
    reportedPageTotal: pageTotal.state === "measured"
      ? pageTotal.value
      : pageTotal.state === "invalid" ? "invalid" : "unknown",
  };
}

function limitHonor(requested, coverage) {
  const limit = requested.limit === undefined || requested.limit === null
    ? { state: "unknown" }
    : measuredCount(requested.limit);
  const returned = coverage.declaredReturnedCount;
  if (limit.state !== "measured" || typeof returned !== "number") return "unknown";
  if (returned > limit.value) return false;
  return "unknown";
}

function assessRow(item, index, observedAt, staleAfterMs) {
  const input = assessInput(item);
  const payment = assessPayment(item);
  const clock = sourceClock(
    isPlainObject(item) ? item.lastUpdated : undefined,
    observedAt,
    staleAfterMs,
  );
  const resource = isPlainObject(item) && typeof item.resource === "string" ? item.resource : null;
  return {
    responseOrder: index + 1,
    resource,
    scoreIgnored: isPlainObject(item) && "score" in item ? item.score : null,
    retention: input.retention,
    method: input.method,
    input,
    output: input.output,
    payment,
    reportedCalls: reportedCalls(item),
    queryVisibility: "in-this-response",
    sourceClock: clock,
    requestConstructible: requestConstructible(input, payment),
    constructedRequest: input.applicationConstructible === true ? {
      method: input.method,
      query: input.constructedQuery || null,
      body: input.constructedBody || null,
      bodyType: input.bodyType,
      invoked: false,
      paid: false,
    } : null,
    invoked: false,
    paid: false,
  };
}

function duplicateReport(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.resource) continue;
    if (!groups.has(row.resource)) groups.set(row.resource, []);
    groups.get(row.resource).push(row);
  }
  const duplicates = [];
  for (const [resource, group] of groups) {
    if (group.length < 2) continue;
    const fields = new Set();
    const first = JSON.stringify(group[0].payment.identities);
    const firstAmount = group[0].payment.amount;
    const firstNetwork = group[0].payment.network;
    const firstMethod = group[0].method;
    for (const other of group.slice(1)) {
      if (other.payment.amount !== firstAmount) fields.add("amount");
      if (other.payment.network !== firstNetwork) fields.add("network");
      if (other.method !== firstMethod) fields.add("method");
      if (JSON.stringify(other.payment.identities) !== first) fields.add("payment");
    }
    duplicates.push({
      resource,
      responseOrders: group.map((row) => row.responseOrder),
      contradictory: fields.size > 0,
      fields: [...fields],
    });
  }
  return duplicates;
}

function exactService(rows, serviceUrl, coverage, transport) {
  if (transport.state !== "supported" || coverage.inspectedCount === "unknown") {
    return {
      url: serviceUrl,
      inInspectedRows: "unknown",
      ranks: [],
      inUninspectedRemainder: "unknown",
      catalogMembership: "unknown",
      requestConstructibleFromThisResponse: "unknown",
      queryVisibility: "unknown",
    };
  }
  const matches = rows.filter((row) => row.resource === serviceUrl);
  const contradictory = duplicateReport(rows).some((row) => row.resource === serviceUrl && row.contradictory);
  const constructible = matches.some((row) => row.requestConstructible) && !contradictory;
  let remainder = false;
  if (matches.length === 0) {
    if (coverage.uninspectedCount === "unknown" || coverage.uninspectedCount > 0) remainder = "unknown";
    else remainder = false;
  }
  return {
    url: serviceUrl,
    inInspectedRows: matches.length > 0,
    ranks: matches.map((row) => row.responseOrder),
    inUninspectedRemainder: remainder,
    catalogMembership: "unknown",
    requestConstructibleFromThisResponse: matches.length > 0 ? constructible : false,
    queryVisibility: matches.length > 0 ? "in-this-response" : "not-in-inspected-rows",
  };
}

function frozenExtraction(queryText, serviceUrl) {
  return queryText === FROZEN_QUERY && serviceUrl === FROZEN_SERVICE;
}

function nextAction(exact, coverage, transport, frozen, hostDescriptor, oursCount) {
  if (transport.state !== "supported") {
    return `This query is ${transport.state}. Encounter and request construction stay unknown until a supported body is supplied.`;
  }
  if (exact.inInspectedRows === true && exact.requestConstructibleFromThisResponse === true) {
    return `The exact service is at response order ${exact.ranks.join(", ")}. A structured request can be written from the supplied schema. Writing that request does not invoke, pay, or attest a useful result.`;
  }
  if (exact.inInspectedRows === true) {
    return `The exact service is at response order ${exact.ranks.join(", ")}. The supplied fields leave the application request or the payment identity short of a single constructed request.`;
  }
  if (frozen) {
    const host = hostDescriptor
      && hostDescriptor.llmsStatus === 200
      && hostDescriptor.openapiStatus === 200
      ? "The same receipt already records llms.txt and openapi.json at HTTP 200."
      : "When the host is already known, use the published host descriptor.";
    return `The exact service is absent from the ${coverage.inspectedCount} inspected rows. The collector declared ${coverage.declaredReturnedCount} returned rows and ours count ${oursCount}. ${coverage.uninspectedCount} rows were not retained, so encounter in that remainder is unknown. This response does not supply a constructible SameDayDesk request. Catalog membership stays unknown, and retrieval terms, response order, and provider indexing all remain open explanations. ${host} Leave price, payee, and payment authority unchanged.`;
  }
  if (typeof coverage.uninspectedCount === "number" && coverage.uninspectedCount > 0) {
    return `The exact service is absent from the ${coverage.inspectedCount} inspected rows. ${coverage.uninspectedCount} declared rows were not retained, so encounter in that remainder is unknown. Catalog membership stays unknown.`;
  }
  return `The exact service is absent from this inspected response of ${coverage.inspectedCount}. Catalog membership stays unknown.`;
}

function readFlags(options) {
  const official = options.officialRead === true;
  return { officialLiveRead: official, networkSent: official, liveQueryIssued: official };
}

function sourceBlock(kind, flags) {
  return {
    repository: SOURCE.repository,
    commit: SOURCE.commit,
    package: SOURCE.package,
    version: SOURCE.version,
    license: SOURCE.license,
    client: SOURCE.client,
    route: { method: SOURCE.method, url: SOURCE.searchUrl },
    listRoute: { method: SOURCE.method, url: SOURCE.listUrl },
    cdpListDocumentedQuery: SOURCE.cdpListDocumentedQuery.slice(),
    sdkSearchQuery: SOURCE.sdkSearchQuery.slice(),
    sdkListQuery: SOURCE.sdkListQuery.slice(),
    filtersAssumedHonored: false,
    scope: "one-supported-provider",
    globalMarket: false,
    observationKind: kind,
    liveQueryIssued: flags.liveQueryIssued,
    officialLiveRead: flags.officialLiveRead,
    networkSent: flags.networkSent,
  };
}

function pinnedRouteMatch(url) {
  if (typeof url !== "string") return false;
  return url === SOURCE.searchUrl
    || url.startsWith(`${SOURCE.searchUrl}?`)
    || url === SOURCE.listUrl
    || url.startsWith(`${SOURCE.listUrl}?`);
}

function oursLabel(call) {
  if (!Object.prototype.hasOwnProperty.call(call, "oursCount") || call.oursCount === null) {
    return { state: "unknown", label: "unknown" };
  }
  const parsed = measuredCount(call.oursCount);
  if (parsed.state === "measured") return { state: "measured", label: parsed.value };
  return { state: "invalid", label: "invalid" };
}

function baselineBlock(queryText, requested, elapsedMs) {
  const sameQuery = queryText === BASELINE.sameCapturedQuery;
  const sameFilters = requested.type === BASELINE.sameCapturedFilters.type
    && requested.limit === BASELINE.sameCapturedFilters.limit;
  return {
    name: BASELINE.name,
    repository: BASELINE.repository,
    commit: BASELINE.commit,
    sameInput: sameQuery && sameFilters,
    sameTask: sameQuery,
    transformReplacesGet: false,
    sourceElapsedMs: typeof elapsedMs === "number" ? elapsedMs : null,
    integrationCost: "unknown",
    attentionCost: "unknown",
    cashCost: "unknown",
    claims: { ...BASELINE.claims },
  };
}

function emptyExact(serviceUrl) {
  return {
    url: serviceUrl,
    inInspectedRows: "unknown",
    ranks: [],
    inUninspectedRemainder: "unknown",
    catalogMembership: "unknown",
    requestConstructibleFromThisResponse: "unknown",
    queryVisibility: "unknown",
  };
}

export function observeCall(call, options = {}) {
  const started = Date.now();
  const serviceUrl = typeof options.serviceUrl === "string" ? options.serviceUrl : FROZEN_SERVICE;
  const observedAt = options.observedAt || null;
  const flags = readFlags(options);
  if (!isPlainObject(call)) {
    const transport = { state: "invalid", reason: "call-not-object", httpStatus: null, allow: null, credentialSent: false };
    return {
      schema: SCHEMA,
      kind: "internal-query-assessment",
      authenticBuyerEncounter: false,
      consumer: { ...CONSUMER, authenticBuyerEncounter: false },
      source: sourceBlock("invalid", flags),
      transport,
      query: { text: null, requested: {}, limitRole: SOURCE.searchLimitRole, cursorRole: SOURCE.searchCursorRole },
      clock: { observedAt, freshness: observedAt ? "known" : "unknown" },
      coverage: unknownCounts(),
      rank: { method: "response-order", scoreUsed: false },
      rows: [],
      duplicates: [],
      exactService: emptyExact(serviceUrl),
      provenance: {
        kind: "supplied-body",
        officialLiveRead: flags.officialLiveRead,
        networkSent: flags.networkSent,
        pinnedRouteMatch: false,
      },
      collector: { declaredOursCount: "unknown", reinspectedByThisConsumer: false },
      baseline: baselineBlock(null, {}, null),
      existingReadersCompleteSellerQuestion: false,
      checkedReaders: CHECKED_READERS.map((reader) => ({ id: reader.id, sellerQuestion: false })),
      decision: {
        causality: "unknown",
        localMerchantSchemaDefectFound: false,
        nextAction: nextAction(emptyExact(serviceUrl), unknownCounts(), transport, false, null),
      },
      decodeMs: Date.now() - started,
    };
  }

  if (typeof options.bodyCapBytes === "number" && typeof call.rawBody === "string") {
    const bytes = Buffer.byteLength(call.rawBody);
    if (bytes > options.bodyCapBytes) {
      const transport = {
        state: "bounded",
        reason: "body-cap",
        httpStatus: call.status ?? null,
        allow: null,
        credentialSent: false,
        bytes,
        cap: options.bodyCapBytes,
      };
      const coverage = unknownCounts();
      const exact = emptyExact(serviceUrl);
      return {
        schema: SCHEMA,
        kind: "internal-query-assessment",
        authenticBuyerEncounter: false,
        consumer: { ...CONSUMER, authenticBuyerEncounter: false },
        source: sourceBlock("bounded-body", flags),
        transport,
        query: { text: null, requested: {}, limitRole: SOURCE.searchLimitRole, cursorRole: SOURCE.searchCursorRole },
        clock: { observedAt, freshness: observedAt ? "known" : "unknown" },
        coverage,
        rank: { method: "response-order", scoreUsed: false },
        rows: [],
        duplicates: [],
        exactService: exact,
        provenance: {
          kind: "supplied-body",
          officialLiveRead: flags.officialLiveRead,
          networkSent: flags.networkSent,
          pinnedRouteMatch: false,
        },
        collector: { declaredOursCount: "unknown", reinspectedByThisConsumer: false },
        baseline: baselineBlock(null, {}, null),
        existingReadersCompleteSellerQuestion: false,
        checkedReaders: CHECKED_READERS.map((reader) => ({ id: reader.id, sellerQuestion: false })),
        decision: {
          causality: "unknown",
          localMerchantSchemaDefectFound: false,
          nextAction: "The body exceeded the caller cap. Encounter and request construction stay unknown.",
        },
        decodeMs: Date.now() - started,
      };
    }
  }

  const request = parseUrl(call.url);
  const kind = routeKind(request.path);
  const selected = selectRows(call);
  let transport = transportOf(call);
  if (typeof call.status !== "number" && call.timedOut !== true && call.error !== "timeout" && selected.storage !== "absent") {
    transport = {
      state: "supported",
      reason: "status-not-supplied",
      httpStatus: null,
      allow: null,
      credentialSent: false,
    };
  }
  if (transport.state === "supported" && selected.storage === "absent") {
    transport = {
      ...transport,
      state: "invalid",
      reason: "resource-list-absent",
    };
  }
  const coverage = coverageFor(call, selected, transport);
  const rows = transport.state === "supported" && selected.rows
    ? selected.rows.map((item, index) => assessRow(item, index, observedAt, options.staleAfterMs))
    : [];
  const exact = exactService(rows, serviceUrl, coverage, transport);
  const frozen = frozenExtraction(request.queryText, serviceUrl);
  const ours = oursLabel(call);
  const collectorDeclared = ours.label;
  const decision = {
    causality: frozen ? "unresolved" : "not-this-query",
    openExplanations: frozen ? ["retrieval-terms", "response-order", "provider-index"] : [],
    localMerchantSchemaDefectFound: false,
    nextAction: nextAction(
      exact,
      coverage,
      transport,
      frozen,
      options.hostDescriptor || null,
      collectorDeclared,
    ),
  };
  if (frozen) {
    decision.rootReplay = { ...ROOT_REPLAY };
  }
  return {
    schema: SCHEMA,
    kind: "internal-query-assessment",
    authenticBuyerEncounter: false,
    consumer: { ...CONSUMER, authenticBuyerEncounter: false },
    source: sourceBlock(
      selected.storage === "retained-projection"
        ? "retained-receipt"
        : transport.state === "supported"
          ? flags.officialLiveRead ? "official-get" : "supplied-body"
          : transport.state,
      flags,
    ),
    routeKind: kind,
    transport,
    query: {
      text: request.queryText,
      requested: request.requested,
      effectiveFilters: "unknown",
      limitRole: kind === "search" ? "advisory" : kind === "list" ? "documented-page-size" : "unknown",
      cursorRole: kind === "search" ? "advisory" : "unknown",
      limitHonor: limitHonor(request.requested, coverage),
      documentedCdpListParameters: SOURCE.cdpListDocumentedQuery.slice(),
    },
    clock: {
      observedAt,
      freshness: typeof observedAt === "string" && !Number.isNaN(Date.parse(observedAt)) ? "known" : "unknown",
    },
    coverage,
    rank: { method: "response-order", scoreUsed: false },
    rows,
    duplicates: duplicateReport(rows),
    exactService: exact,
    provenance: {
      kind: flags.officialLiveRead
        ? "official-get"
        : selected.storage === "retained-projection" ? "retained-receipt" : "supplied-body",
      officialLiveRead: flags.officialLiveRead,
      networkSent: flags.networkSent,
      credentialSent: false,
      pinnedRouteMatch: pinnedRouteMatch(call.url),
    },
    collector: {
      declaredOursCount: collectorDeclared,
      countState: ours.state,
      reinspectedByThisConsumer: false,
      declarationIsSchemaInspection: false,
    },
    baseline: baselineBlock(request.queryText, request.requested, call.elapsedMs),
    existingReadersCompleteSellerQuestion: false,
    checkedReaders: CHECKED_READERS.map((reader) => ({
      id: reader.id,
      pin: reader.pin || null,
      sellerQuestion: false,
    })),
    decision,
    decodeMs: Date.now() - started,
  };
}

function pageSummary(call) {
  const request = parseUrl(isPlainObject(call) ? call.url : null);
  const selected = isPlainObject(call) ? selectRows(call) : { rows: null, storage: "absent" };
  const first = selected.rows && selected.rows.length > 0 && isPlainObject(selected.rows[0])
    ? selected.rows[0].resource || null
    : null;
  const totalParsed = isPlainObject(call) && isPlainObject(call.pagination)
    && Object.prototype.hasOwnProperty.call(call.pagination, "total")
    ? measuredCount(call.pagination.total)
    : { state: "unknown" };
  const bytesParsed = isPlainObject(call) && Object.prototype.hasOwnProperty.call(call, "bytes")
    ? measuredCount(call.bytes)
    : { state: "absent" };
  return {
    requested: request.requested,
    firstResource: typeof first === "string" ? first : null,
    total: totalParsed.state === "measured" ? totalParsed.value : totalParsed.state === "invalid" ? "invalid" : "unknown",
    bytes: bytesParsed.state === "measured" ? bytesParsed.value : null,
    rows: selected.rows || [],
    inspectedCount: selected.rows ? selected.rows.length : "unknown",
  };
}

function explicitPayTos(rows) {
  const found = [];
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    if (typeof row.payTo === "string" && row.payTo.trim() !== "") found.push(row.payTo);
    if (!Array.isArray(row.accepts)) continue;
    for (const accept of row.accepts) {
      if (isPlainObject(accept) && typeof accept.payTo === "string" && accept.payTo.trim() !== "") {
        found.push(accept.payTo);
      }
    }
  }
  return found;
}

export function observeFilterHonor(baseline, filtered, filterName) {
  const left = pageSummary(baseline);
  const right = pageSummary(filtered);
  const isolated = right.requested[filterName] !== undefined && left.requested[filterName] === undefined;
  const documented = SOURCE.cdpListDocumentedQuery.includes(filterName);
  if (!isolated) {
    return {
      filter: filterName,
      honored: "unknown",
      reason: "filter-not-isolated",
      documentedOnCdpList: documented,
      assumedHonored: false,
    };
  }
  const sameTotal = typeof left.total === "number" && left.total === right.total;
  const sameFirst = left.firstResource !== null && left.firstResource === right.firstResource;
  const sameBytes = left.bytes !== null && left.bytes === right.bytes;
  const bytesConflict = left.bytes !== null && right.bytes !== null && left.bytes !== right.bytes;
  const pageUnchanged = sameTotal && sameFirst && !bytesConflict;
  const compared = []
    .concat(sameTotal ? ["pagination.total"] : [])
    .concat(sameFirst ? ["first-resource"] : [])
    .concat(sameBytes ? ["bytes"] : []);
  const payTos = explicitPayTos(right.rows);
  const filterValue = right.requested[filterName];
  const outside = payTos.filter((value) => value !== filterValue);
  let honored = "unknown";
  let reason = "page-differs-honor-unproven";
  if (pageUnchanged && outside.length > 0) {
    honored = false;
    reason = "returned-identity-outside-filter";
  } else if (pageUnchanged && payTos.length > 0) {
    reason = "page-unchanged-identities-match-filter";
  } else if (pageUnchanged) {
    reason = "page-unchanged-identity-unobserved";
  }
  return {
    filter: filterName,
    honored,
    reason,
    pageUnchanged,
    compared,
    identityContradiction: outside.length > 0,
    documentedOnCdpList: documented,
    assumedHonored: false,
    baselineTotal: left.total,
    filteredTotal: right.total,
    baselineBytes: left.bytes,
    filteredBytes: right.bytes,
    firstResource: pageUnchanged ? left.firstResource : { baseline: left.firstResource, filtered: right.firstResource },
  };
}

function hostDescriptor(receipt) {
  const descriptors = isPlainObject(receipt) && isPlainObject(receipt.publicDescriptors)
    ? receipt.publicDescriptors
    : null;
  if (!descriptors) return null;
  return {
    llmsStatus: descriptors.llms && typeof descriptors.llms.status === "number" ? descriptors.llms.status : "unknown",
    openapiStatus: descriptors.openapi && typeof descriptors.openapi.status === "number" ? descriptors.openapi.status : "unknown",
    extractPathPresent: descriptors.openapi ? descriptors.openapi.extractPathPresent === true : "unknown",
    payToPresent: descriptors.llms ? descriptors.llms.payToPresent === true : "unknown",
  };
}

export function observeReceipt(receipt, options = {}) {
  const calls = isPlainObject(receipt) && Array.isArray(receipt.calls) ? receipt.calls : [];
  const callName = options.callName || KNOWN_CALLS.taskSearch;
  const task = calls.find((call) => call && call.name === callName) || null;
  const list = calls.find((call) => call && call.name === KNOWN_CALLS.verifiedList) || null;
  const payTo = calls.find((call) => call && call.name === KNOWN_CALLS.payToList) || null;
  const observedAt = isPlainObject(receipt) && typeof receipt.observedAt === "string" ? receipt.observedAt : null;
  const descriptor = hostDescriptor(receipt);
  const taskSearch = task
    ? observeCall(task, { ...options, observedAt, hostDescriptor: descriptor })
    : observeCall(null, { ...options, observedAt });
  return {
    schema: SCHEMA,
    kind: "internal-query-assessment",
    authenticBuyerEncounter: false,
    consumer: { ...CONSUMER },
    observedAt,
    receiptCredentialSent: isPlainObject(receipt) && receipt.credentialSent === true
      ? true
      : isPlainObject(receipt) && receipt.credentialSent === false
        ? false
        : "unknown",
    decoderSentCredential: false,
    provenance: {
      kind: "retained-receipt",
      officialLiveRead: taskSearch.provenance ? taskSearch.provenance.officialLiveRead === true : false,
      networkSent: taskSearch.provenance ? taskSearch.provenance.networkSent === true : false,
      credentialSent: false,
      pinnedRouteMatch: taskSearch.provenance ? taskSearch.provenance.pinnedRouteMatch === true : false,
    },
    taskSearch,
    listPayToFilter: list && payTo
      ? observeFilterHonor(list, payTo, "payTo")
      : { filter: "payTo", honored: "unknown", reason: "calls-absent", assumedHonored: false },
    hostDescriptor: descriptor,
    existingReadersCompleteSellerQuestion: false,
  };
}
