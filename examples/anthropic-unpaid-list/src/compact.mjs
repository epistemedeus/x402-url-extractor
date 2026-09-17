function firstExactAccept(accepts) {
  if (!Array.isArray(accepts)) return null;
  return accepts.find((entry) => entry?.scheme === "exact") || accepts[0] || null;
}

export function compactOffer(challenge) {
  if (!challenge || typeof challenge !== "object") return null;
  if (challenge.x402Version == null || !Array.isArray(challenge.accepts)) return null;
  const accept = firstExactAccept(challenge.accepts);
  return Object.freeze({
    x402Version: challenge.x402Version,
    resourceUrl: challenge.resource?.url ?? null,
    scheme: accept?.scheme ?? null,
    network: accept?.network ?? null,
    amount: accept?.amount ?? null,
    asset: accept?.asset ?? null,
    payTo: accept?.payTo ?? null,
    note: "Live unpaid 402 terms. Not authorization to pay.",
  });
}

export function compactWellKnownExtractItems(body) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const out = [];
  for (const item of items) {
    const resource = item?.resource && typeof item.resource === "object" ? item.resource : {};
    const route = resource.routeTemplate;
    if (route !== "/extract" && route !== "/extract/batch") continue;
    const accept = firstExactAccept(item.accepts);
    out.push(Object.freeze({
      routeTemplate: route,
      url: resource.url ?? null,
      method: item.request?.method ?? null,
      amount: accept?.amount ?? null,
      network: accept?.network ?? null,
    }));
  }
  return Object.freeze(out);
}

export function compactExtractActions(body) {
  const actions = Array.isArray(body?.actions) ? body.actions : [];
  return Object.freeze(actions
    .filter((action) => action?.route === "/extract" || action?.route === "/extract/batch")
    .map((action) => Object.freeze({
      name: action.name ?? null,
      method: action.method ?? null,
      route: action.route,
      priceAtomicUsdc: action.priceAtomicUsdc ?? null,
    })));
}

export function compactOpenApiExtract(body) {
  const paths = body?.paths && typeof body.paths === "object" ? body.paths : {};
  const extract = paths["/extract"]?.get ? { method: "GET", path: "/extract", operationId: paths["/extract"].get.operationId ?? null } : null;
  const batch = paths["/extract/batch"]?.post
    ? { method: "POST", path: "/extract/batch", operationId: paths["/extract/batch"].post.operationId ?? null }
    : null;
  return Object.freeze({
    title: body?.info?.title ?? null,
    version: body?.info?.version ?? null,
    operations: Object.freeze([extract, batch].filter(Boolean)),
  });
}

export function compactMcpTools(tools) {
  const names = Array.isArray(tools)
    ? Object.freeze(tools.map((tool) => tool?.name).filter((name) => typeof name === "string"))
    : Object.freeze([]);
  return Object.freeze({
    names,
    extractPresent: names.includes("extract"),
    extractBatchPresent: names.includes("extract_batch"),
    toolCount: names.length,
  });
}

export function parseMcpPayload(text) {
  const dataLines = String(text || "").split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const raw = dataLines.length ? dataLines.at(-1).slice(6) : text;
  return JSON.parse(raw);
}
