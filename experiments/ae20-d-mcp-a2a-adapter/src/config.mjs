// X1's published local unsigned test credential (support/gateway.mjs). Not a secret.
export const PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL = "local_unsigned_tenant_a_credential_000001";

export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  let baseUrl = env.X1_BASE_URL || "";
  let bearer = env.X1_BEARER || PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL;
  let urlFile = "";
  let port = 0;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") baseUrl = argv[++i] || "";
    else if (arg === "--bearer") bearer = argv[++i] || "";
    else if (arg === "--url-file") urlFile = argv[++i] || "";
    else if (arg === "--port") port = Number(argv[++i]);
    else throw Object.assign(new Error("unknown_arg"), { code: "unknown_arg" });
  }
  baseUrl = baseUrl.replace(/\/+$/, "");
  if (!bearer) bearer = PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw Object.assign(new Error("bad_port"), { code: "bad_port" });
  }
  return { baseUrl, bearer, urlFile, port };
}

export function requireBaseUrl(config) {
  if (!config.baseUrl) throw Object.assign(new Error("x1_base_url_required"), { code: "x1_base_url_required" });
  return config.baseUrl;
}
