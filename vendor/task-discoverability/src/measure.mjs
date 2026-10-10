import { collectBounded } from "./bounded-get.mjs";
import { isPlainObject } from "./construct.mjs";
import { observeCall, observeReceipt } from "./observe.mjs";
import { PACKAGE, SOURCE } from "./pins.mjs";

function serviceUrlOf(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return value;
  } catch {
    return null;
  }
}

function providerBlock() {
  return {
    id: "cdp-x402-discovery",
    scope: "one-supported-provider",
    globalMarket: false,
    repository: SOURCE.repository,
    commit: SOURCE.commit,
    package: SOURCE.package,
    version: SOURCE.version,
    license: SOURCE.license,
    route: { method: SOURCE.method, url: SOURCE.searchUrl },
  };
}

function failure(reason, extra = {}) {
  return {
    schema: PACKAGE.schema,
    ok: false,
    package: { name: PACKAGE.name, version: PACKAGE.version, license: PACKAGE.license },
    provider: providerBlock(),
    reason,
    provenance: {
      kind: "not-collected",
      officialLiveRead: false,
      networkSent: extra.networkSent === true,
      credentialSent: false,
      request: extra.url ? { method: "GET", url: extra.url } : null,
      httpStatus: extra.httpStatus ?? null,
      window: extra.window || null,
    },
    service: null,
    coverage: null,
    rank: null,
    filter: { assumedHonored: false },
    requestConstructibility: { fromThisResponse: false, invoked: false, paid: false },
    rows: [],
    nextAction: extra.nextAction || "Supply one captured discovery response and your service URL, or request one explicit free search.",
    authenticBuyerEncounter: false,
    buyer: "not-supplied",
    use: "unknown",
    revenue: "unknown",
  };
}

function publicRow(row) {
  return {
    responseOrder: row.responseOrder,
    resource: row.resource,
    retention: row.retention,
    method: row.method,
    fieldsAvailable: row.input.fieldsAvailable,
    valueSchemaValid: row.input.valueSchemaValid,
    applicationConstructible: row.input.applicationConstructible,
    gaps: row.input.gaps,
    outputMissing: row.output.missing,
    payment: {
      state: row.payment.state,
      complete: row.payment.complete,
      amount: row.payment.amount,
      amountUnit: row.payment.amountUnit,
      declaredSymbol: row.payment.declaredSymbol,
      moneyAmount: row.payment.moneyAmount,
      moneyUnit: row.payment.moneyUnit,
      network: row.payment.network,
      payTo: row.payment.payTo,
    },
    reportedCalls: row.reportedCalls,
    requestConstructible: row.requestConstructible,
    constructedRequest: row.constructedRequest,
    invoked: false,
    paid: false,
  };
}

export function present(observation, provenance) {
  const search = observation.taskSearch || observation;
  const routeMatch = search.provenance ? search.provenance.pinnedRouteMatch === true : false;
  const readers = observation.existingReadersCompleteSellerQuestion === true
    || search.existingReadersCompleteSellerQuestion === true;
  return {
    schema: PACKAGE.schema,
    ok: search.transport && search.transport.state === "supported",
    package: { name: PACKAGE.name, version: PACKAGE.version, license: PACKAGE.license },
    measurementRule: PACKAGE.measurementRule,
    provider: providerBlock(),
    provenance: {
      ...provenance,
      pinnedRouteMatch: routeMatch,
      credentialSent: false,
    },
    time: {
      observedAt: search.clock ? search.clock.observedAt : null,
      freshness: search.clock ? search.clock.freshness : "unknown",
    },
    service: {
      url: search.exactService.url,
      inInspectedRows: search.exactService.inInspectedRows,
      ranks: search.exactService.ranks,
      inUninspectedRemainder: search.exactService.inUninspectedRemainder,
      catalogMembership: search.exactService.catalogMembership,
      requestConstructible: search.exactService.requestConstructibleFromThisResponse,
      queryVisibility: search.exactService.queryVisibility,
    },
    coverage: {
      declaredReturnedCount: search.coverage.declaredReturnedCount,
      inspectedCount: search.coverage.inspectedCount,
      uninspectedCount: search.coverage.uninspectedCount,
      countState: search.coverage.countState,
      countConflict: search.coverage.countConflict,
      measuredZero: search.coverage.measuredZero,
      partialResults: search.coverage.partialResults,
      reportedPageTotal: search.coverage.reportedPageTotal,
    },
    collector: {
      declaredOursCount: search.collector ? search.collector.declaredOursCount : "unknown",
      countState: search.collector ? search.collector.countState : "unknown",
      globalDemand: "unknown",
    },
    rank: search.rank,
    filter: {
      assumedHonored: false,
      effectiveFilters: search.query.effectiveFilters,
      limitRole: search.query.limitRole,
      limitHonor: search.query.limitHonor,
      documentedCdpListParameters: search.query.documentedCdpListParameters,
      list: observation.listPayToFilter || null,
    },
    requestConstructibility: {
      fromThisResponse: search.exactService.requestConstructibleFromThisResponse,
      invoked: false,
      paid: false,
    },
    rows: search.rows.map(publicRow),
    decision: {
      causality: search.decision ? search.decision.causality : "unknown",
    },
    nextAction: search.decision.nextAction,
    credentialSent: false,
    receiptCredentialSent: observation.receiptCredentialSent === true
      ? true
      : observation.receiptCredentialSent === false
        ? false
        : "unknown",
    readersCompleteSellerQuestion: readers,
    authenticBuyerEncounter: false,
    buyer: "not-supplied",
    use: "unknown",
    revenue: "unknown",
  };
}

function suppliedProvenance(kind) {
  return {
    kind,
    officialLiveRead: false,
    networkSent: false,
    credentialSent: false,
    request: null,
    httpStatus: null,
    window: null,
  };
}

export async function measure(input = {}) {
  const serviceUrl = serviceUrlOf(input.serviceUrl);
  if (!serviceUrl) return failure("service-url-invalid");
  const hasBody = input.body !== undefined;
  if (input.collect === true && hasBody) return failure("one-input-required");
  if (input.collect === true) {
    const collected = await collectBounded({
      query: input.query,
      type: input.type,
      payTo: input.payTo,
      scheme: input.scheme,
      network: input.network,
      extensions: input.extensions,
      limit: input.limit,
      cursor: input.cursor,
    }, {
      allowLive: true,
      fetchImpl: input.fetchImpl,
      baseUrl: input.baseUrl,
      timeoutMs: input.timeoutMs,
      maxBytes: input.maxBytes,
    });
    if (collected.state !== "supported") {
      return failure(collected.reason || collected.state, {
        networkSent: collected.networkSent,
        url: collected.url,
        httpStatus: collected.httpStatus,
        window: {
          timeoutMs: collected.timeoutMs,
          maxBytes: collected.maxBytes,
          elapsedMs: collected.elapsedMs,
          redirectsFollowed: collected.redirectsFollowed,
          bodyBound: collected.bodyBound,
          startedAt: collected.startedAt,
          completedAt: collected.completedAt,
        },
        nextAction: `The free search did not return a supported document (${collected.reason || collected.state}). The service was not called and nothing was paid.`,
      });
    }
    const call = {
      ...collected.body,
      url: collected.url,
      status: collected.httpStatus,
      elapsedMs: collected.elapsedMs,
    };
    const observation = observeCall(call, {
      serviceUrl,
      observedAt: collected.completedAt,
      officialRead: true,
    });
    return present(observation, {
      kind: "official-get",
      officialLiveRead: true,
      networkSent: true,
      credentialSent: false,
      request: { method: "GET", url: collected.url },
      httpStatus: collected.httpStatus,
      window: {
        timeoutMs: collected.timeoutMs,
        maxBytes: collected.maxBytes,
        bytes: collected.bytes,
        elapsedMs: collected.elapsedMs,
        redirectsFollowed: collected.redirectsFollowed,
        bodyBound: collected.bodyBound,
        startedAt: collected.startedAt,
        completedAt: collected.completedAt,
      },
    });
  }
  if (!hasBody) return failure("input-required");
  if (!isPlainObject(input.body)) return failure("body-not-object");
  const observation = Array.isArray(input.body.calls)
    ? observeReceipt(input.body, { serviceUrl, observedAt: input.observedAt })
    : observeCall(input.body, { serviceUrl, observedAt: input.observedAt });
  const kind = Array.isArray(input.body.calls) ? "supplied-receipt" : "supplied-body";
  return present(observation, suppliedProvenance(kind));
}
