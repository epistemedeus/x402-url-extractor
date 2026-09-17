import { PRODUCT, SCHEMA_VERSION } from "./constants.mjs";
import { parseCatalogJson, projectCatalogItems, readCatalogFile } from "./catalog.mjs";
import { fail } from "./errors.mjs";
import { DEFAULT_CATALOG_PATH } from "./paths.mjs";
import { assertNoPaymentHeaders, boundedGetJson } from "./transport.mjs";
import { admitDiscoveryUrl, discoveryUrlForOrigin } from "./url-guard.mjs";

const PAYMENT_OPTION_KEYS = new Set([
  "approve",
  "pay",
  "wallet",
  "checkout",
  "privateKey",
  "privateKeyEnv",
  "paymentSignature",
  "paymentHeader",
  "account",
]);

export function assertUnpaidIntent(options = {}) {
  for (const key of PAYMENT_OPTION_KEYS) {
    if (options[key]) fail("unpaid list refuses payment, wallet, or checkout options", "payment_intent_refused", key);
  }
  if (options.headers) assertNoPaymentHeaders({ headers: options.headers });
  if (options.init) assertNoPaymentHeaders(options.init);
}

function boundary() {
  return {
    credentialsUsed: false,
    paymentSigned: false,
    paymentSent: false,
    paidBodyRead: false,
    walletAccessed: false,
    redirectsFollowed: false,
    liveChallengeFetched: false,
  };
}

function resolveSource({ catalogPath = null, origin = null, url = null } = {}) {
  const supplied = [catalogPath, origin, url].filter((value) => value != null && value !== "");
  if (supplied.length > 1) {
    fail("provide only one of catalogPath, origin, or url", "invalid_discovery_url");
  }
  if (catalogPath) {
    return { kind: "fixture", path: String(catalogPath), url: null };
  }
  if (url) {
    return { kind: "live", path: null, url: admitDiscoveryUrl(url) };
  }
  if (origin) {
    return { kind: "live", path: null, url: discoveryUrlForOrigin(origin) };
  }
  return { kind: "fixture", path: DEFAULT_CATALOG_PATH, url: null };
}

async function loadDocument(source, { fetchImpl = globalThis.fetch } = {}) {
  if (source.kind === "fixture") return { document: readCatalogFile(source.path), httpStatus: null };
  const response = await boundedGetJson(fetchImpl, source.url);
  if (response.status === 402) {
    fail("well-known discovery is unpaid; HTTP 402 means the catalog is paywalled and is not listed", "discovery_paywalled");
  }
  if (response.status !== 200) {
    fail(`discovery returned HTTP ${response.status}; expected 200`, "discovery_not_ok");
  }
  return { document: parseCatalogJson(response.bodyText), httpStatus: response.status };
}

export async function listUnpaidResources(options = {}) {
  assertUnpaidIntent(options);
  const source = resolveSource(options);
  const { document, httpStatus } = await loadDocument(source, options);
  const projected = projectCatalogItems(document, {
    query: options.query,
    route: options.route,
  });
  return {
    ok: true,
    product: PRODUCT,
    schemaVersion: SCHEMA_VERSION,
    source: {
      kind: source.kind,
      path: source.path,
      url: source.url,
      httpStatus,
      x402Version: document.x402Version,
    },
    itemCount: projected.items.length,
    catalogCount: projected.catalogCount,
    matched: projected.matched,
    truncated: projected.truncated,
    items: projected.items,
    boundary: boundary(),
  };
}
