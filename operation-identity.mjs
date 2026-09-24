// One priced-operation identity. Surfaces advertise this object; they do not invent a second price or rail list.

export const BILLING_PER_CALL = "per-call";
export const BILLING_PER_BOUNDED_ATTEMPT = "per-bounded-attempt";
export const ALLOWED_RAILS = Object.freeze(["x402", "mpp"]);
export const BATCH_ROUTE = "/extract/batch";
export const LOCKFILE_ROUTE = "/lockfile-pin-delta";
export const IDENTITY_SURFACES = Object.freeze(["mcp", "manifest", "a2a", "openapi"]);

const ALLOWED_BILLING = new Set([BILLING_PER_CALL, BILLING_PER_BOUNDED_ATTEMPT]);

export function operationIdForRoute(route) {
  const id = String(route || "").replace(/^\//, "").replaceAll("/", "_");
  if (!id || id.includes("/") || /\s/.test(id)) {
    throw new Error(`operation identity requires a stable route (${route || "missing"})`);
  }
  return id;
}

export function billingBasisForRoute(route) {
  return route === BATCH_ROUTE ? BILLING_PER_BOUNDED_ATTEMPT : BILLING_PER_CALL;
}

export function supportedRailsForRoute(route) {
  return route === LOCKFILE_ROUTE ? ["x402"] : ["x402", "mpp"];
}

export function operationIdentity({ route, priceAtomic } = {}) {
  const id = operationIdForRoute(route);
  const price = String(priceAtomic ?? "");
  if (!/^[1-9][0-9]*$/.test(price)) {
    throw new Error(`operation identity requires an atomic price for ${route || id}`);
  }
  return {
    id,
    price,
    billingBasis: billingBasisForRoute(route),
    supportedRails: supportedRailsForRoute(route),
  };
}

export function operationIdentityFromAction(action) {
  return operationIdentity({
    route: action?.route,
    priceAtomic: action?.priceAtomicUsdc ?? action?.price ?? action?.amount,
  });
}

function railsKey(rails) {
  return Array.isArray(rails) ? rails.map(String).join(",") : "";
}

export function sameOperationIdentity(left, right) {
  if (!left || !right) return false;
  return left.id === right.id
    && String(left.price) === String(right.price)
    && left.billingBasis === right.billingBasis
    && railsKey(left.supportedRails) === railsKey(right.supportedRails);
}

function isPerSuccessfulCall(value) {
  return /per[ -]successful[ -]call/i.test(String(value || ""));
}

function railProblems(identity) {
  const problems = [];
  const rails = identity?.supportedRails;
  if (!Array.isArray(rails) || rails.length === 0) {
    problems.push("missing-rails");
    return problems;
  }
  if (new Set(rails).size !== rails.length) problems.push("duplicate-rails");
  for (const rail of rails) {
    if (!ALLOWED_RAILS.includes(rail)) problems.push(`invented-rail:${rail}`);
  }
  return problems;
}

/**
 * Compare advertised identities. A surface that omits an operation is not a copy.
 * A surface that lists one must match every other listing of that id, and the
 * listing must obey the route billing and rail rules.
 */
export function identityProblems(entries = []) {
  const problems = [];
  const grouped = new Map();
  for (const entry of entries) {
    const surface = String(entry?.surface || "");
    const identity = entry?.identity;
    if (!IDENTITY_SURFACES.includes(surface)) {
      problems.push(`unknown-surface:${surface || "missing"}`);
      continue;
    }
    if (!identity || typeof identity !== "object") {
      problems.push(`${surface}:missing-identity`);
      continue;
    }
    const id = identity.id == null ? "" : String(identity.id);
    if (!id) {
      problems.push(`${surface}:missing-id`);
      continue;
    }
    const price = identity.price == null ? "" : String(identity.price);
    if (!/^[1-9][0-9]*$/.test(price)) problems.push(`${surface}:${id}:invalid-price`);
    const billingBasis = identity.billingBasis == null ? "" : String(identity.billingBasis);
    if (id === operationIdForRoute(BATCH_ROUTE) && isPerSuccessfulCall(billingBasis)) {
      problems.push(`${surface}:${id}:batch-per-successful-call`);
    }
    if (!ALLOWED_BILLING.has(billingBasis)) problems.push(`${surface}:${id}:invalid-billing-basis`);
    if (id === operationIdForRoute(BATCH_ROUTE) && billingBasis !== BILLING_PER_BOUNDED_ATTEMPT) {
      problems.push(`${surface}:${id}:batch-billing-basis`);
    }
    for (const railProblem of railProblems(identity)) {
      problems.push(`${surface}:${id}:${railProblem}`);
    }
    if (id === operationIdForRoute(LOCKFILE_ROUTE) && railsKey(identity.supportedRails) !== "x402") {
      problems.push(`${surface}:${id}:lockfile-not-x402-only`);
    }
    const record = { id, price, billingBasis, supportedRails: Array.isArray(identity.supportedRails) ? identity.supportedRails.map(String) : [] };
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push({ surface, identity: record });
  }
  for (const [id, group] of grouped) {
    const canonical = group[0].identity;
    for (const item of group.slice(1)) {
      if (!sameOperationIdentity(canonical, item.identity)) {
        problems.push(`${id}:diverged:${group[0].surface}:${item.surface}`);
      }
    }
  }
  return problems;
}

function openApiIdentityEntries(document) {
  const entries = [];
  const paths = document?.paths && typeof document.paths === "object" ? document.paths : {};
  for (const [route, pathItem] of Object.entries(paths)) {
    if (String(route).startsWith("/gateway/")) continue;
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const payment = pathItem[method]?.["x-payment-info"];
      if (!payment) continue;
      entries.push({ surface: "openapi", identity: payment.operation || null });
    }
  }
  return entries;
}

export function entriesFromSurfaces({ mcpTools = [], manifestItems = [], skills = [], openapi = null } = {}) {
  const entries = [];
  for (const tool of mcpTools) {
    const identity = tool?._meta?.samedaydesk?.operation;
    const paid = Boolean(tool?._meta?.x402?.accepts);
    if (paid && !identity) {
      entries.push({ surface: "mcp", identity: null });
      continue;
    }
    if (!identity) continue;
    entries.push({ surface: "mcp", identity });
  }
  for (const item of manifestItems) {
    const route = String(item?.resource?.routeTemplate || "");
    if (route.startsWith("/gateway/")) continue;
    if (!item?.identity) {
      entries.push({ surface: "manifest", identity: null });
      continue;
    }
    entries.push({ surface: "manifest", identity: item.identity });
  }
  for (const skill of skills) {
    const routeSkill = String(skill?.id || "").startsWith("discover-paid-action-");
    if (routeSkill && !skill?.operation) {
      entries.push({ surface: "a2a", identity: null });
      continue;
    }
    if (!skill?.operation) continue;
    entries.push({ surface: "a2a", identity: skill.operation });
  }
  entries.push(...openApiIdentityEntries(openapi));
  return entries;
}

export function identityMap(entries = []) {
  const map = {};
  for (const entry of entries) {
    const id = entry?.identity?.id;
    if (!id) continue;
    if (!map[id]) {
      map[id] = {
        id: String(id),
        price: String(entry.identity.price),
        billingBasis: String(entry.identity.billingBasis),
        supportedRails: Array.isArray(entry.identity.supportedRails) ? [...entry.identity.supportedRails] : [],
        surfaces: [],
      };
    }
    map[id].surfaces.push(entry.surface);
  }
  return map;
}
