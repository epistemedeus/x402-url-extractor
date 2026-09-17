import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAX_CATALOG_BYTES, MAX_ITEMS, SUPPORTED_X402_VERSION } from "./constants.mjs";
import { fail } from "./errors.mjs";
import { admitPublicHttpsUrl } from "./url-guard.mjs";

const ALLOWED_METHODS = new Set(["GET", "POST"]);

function tokenMatch(haystack, query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

export function readCatalogFile(path, maxBytes = MAX_CATALOG_BYTES) {
  const target = resolve(path);
  let fd;
  try {
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    fail(`catalog cannot be opened without following symlinks: ${error.message}`, "catalog_unreadable", "catalog");
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) fail("catalog must be a regular file", "catalog_unreadable", "catalog");
    if (st.size > maxBytes) fail(`catalog exceeds ${maxBytes} bytes`, "catalog_too_large", "catalog");
    const bytes = readFileSync(fd);
    if (bytes.length > maxBytes) fail(`catalog exceeds ${maxBytes} bytes`, "catalog_too_large", "catalog");
    return parseCatalogJson(bytes.toString("utf8"));
  } finally {
    closeSync(fd);
  }
}

export function parseCatalogJson(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    fail("catalog is not valid JSON", "catalog_malformed");
  }
  return assertCatalogDocument(document);
}

export function assertCatalogDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    fail("catalog must be a JSON object", "catalog_malformed");
  }
  if (document.ok === true && document.title !== undefined && !Array.isArray(document.items)) {
    fail("document looks like a paid extract body, not a well-known x402 catalog", "catalog_malformed");
  }
  if (document.x402Version !== undefined && Number(document.x402Version) !== SUPPORTED_X402_VERSION) {
    fail(`only x402 v${SUPPORTED_X402_VERSION} catalogs are listed`, "unsupported_x402_version");
  }
  if (document.accepts && !Array.isArray(document.items)) {
    fail("document looks like a payment challenge, not a well-known x402 catalog", "catalog_malformed");
  }
  if (!Array.isArray(document.items)) {
    fail("catalog is missing an items array", "catalog_missing_items");
  }
  if (document.x402Version === undefined) {
    fail("catalog is missing x402Version", "unsupported_x402_version");
  }
  return document;
}

function exactAccepts(accepts, field) {
  if (!Array.isArray(accepts) || accepts.length === 0) {
    fail("catalog item is missing accepts", "item_rejected", field);
  }
  const exact = accepts.filter((entry) => entry && typeof entry === "object" && entry.scheme === "exact");
  if (!exact.length) fail("catalog item has no exact accept option", "item_rejected", field);
  return exact.map((entry) => {
    const amount = entry.amount ?? entry.amountAtomic;
    if (amount == null || String(amount).trim() === "") {
      fail("catalog item accept is missing amount", "item_rejected", field);
    }
    if (!entry.network || !entry.asset || !entry.payTo) {
      fail("catalog item accept is missing network, asset, or payTo", "item_rejected", field);
    }
    return {
      scheme: "exact",
      network: String(entry.network),
      asset: String(entry.asset),
      amountAtomic: String(amount),
      payTo: String(entry.payTo),
    };
  });
}

export function projectCatalogItems(document, { query = "", route = "" } = {}) {
  const queryNeedle = String(query || "").trim().toLowerCase();
  const routeNeedle = String(route || "").trim();
  if (routeNeedle && !/^\/[^?#]*$/.test(routeNeedle)) {
    fail("route must be a path such as /extract", "invalid_discovery_url", "route");
  }

  const projected = [];
  document.items.forEach((item, index) => {
    const field = `items[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail("catalog item must be an object", "item_rejected", field);
    }
    if (item.type && item.type !== "http") {
      fail("only http catalog items are listed", "item_rejected", field);
    }
    const resource = item.resource;
    if (!resource || typeof resource !== "object") fail("catalog item is missing resource", "item_rejected", field);
    const resourceUrl = admitPublicHttpsUrl(resource.url, { field: `${field}.resource.url`, allowQuery: true });
    const routeTemplate = String(resource.routeTemplate || resourceUrl.pathname);
    if (!/^\/[^?#]*$/.test(routeTemplate)) fail("catalog item routeTemplate is invalid", "item_rejected", field);

    const method = String(item.request?.method || "GET").toUpperCase();
    if (!ALLOWED_METHODS.has(method)) fail(`catalog item method ${method} is unsupported`, "item_rejected", field);

    const requestUrl = item.request?.url
      ? admitPublicHttpsUrl(item.request.url, { field: `${field}.request.url`, allowQuery: true }).toString()
      : `${resourceUrl.origin}${routeTemplate}`;
    const exampleUrl = item.request?.exampleUrl
      ? admitPublicHttpsUrl(item.request.exampleUrl, { field: `${field}.request.exampleUrl`, allowQuery: true }).toString()
      : resourceUrl.toString();

    const tags = Array.isArray(resource.tags) ? resource.tags.map((tag) => String(tag)) : [];
    const description = String(resource.description || "");
    const serviceName = String(resource.serviceName || "");
    const haystack = [routeTemplate, description, serviceName, ...tags].join(" ").toLowerCase();
    if (routeNeedle && routeTemplate !== routeNeedle) return;
    if (queryNeedle && !tokenMatch(haystack, queryNeedle)) return;

    projected.push({
      method,
      route: routeTemplate,
      url: requestUrl,
      exampleUrl,
      description,
      mimeType: String(resource.mimeType || "application/json"),
      serviceName: serviceName || null,
      tags,
      accepts: exactAccepts(item.accepts, `${field}.accepts`),
    });
  });

  const truncated = projected.length > MAX_ITEMS;
  return {
    items: projected.slice(0, MAX_ITEMS),
    truncated,
    matched: projected.length,
    catalogCount: document.items.length,
  };
}
