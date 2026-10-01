export const MACHINE_OPENAPI_PATH = "/openapi.json";
export const MACHINE_X402_CATALOG_PATH = "/.well-known/x402";

function machineOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("machine documentation origin must be an absolute http(s) URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("machine documentation origin must be an absolute http(s) URL");
  }
  if (url.username || url.password) {
    throw new Error("machine documentation origin must not include credentials");
  }
  return url.origin;
}

export function machineDocumentationLinkHeaders({ origin } = {}) {
  const base = machineOrigin(origin);
  const openapi = new URL(MACHINE_OPENAPI_PATH, base).toString();
  const catalog = new URL(MACHINE_X402_CATALOG_PATH, base).toString();
  return [
    `<${openapi}>; rel="service-desc"; type="application/vnd.oai.openapi+json"`,
    `<${catalog}>; rel="service-desc"; type="application/json"`,
  ];
}
