#!/usr/bin/env node

import {
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
} from "@x402/extensions/bazaar";

const SCHEMA_VERSION = "samedaydesk.bazaar-contract-audit.v1";
const CREDENTIAL_KEY = /(?:key|token|secret|password|credential|auth)/i;

function value(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parameterExample(parameter) {
  const schema = parameter?.schema || {};
  const declared = parameter?.example ?? schema.example ?? schema.default ?? schema.enum?.[0];
  if (["string", "number", "boolean"].includes(typeof declared)) return String(declared);
  const name = String(parameter?.name || "");
  if (name === "url" || name === "site" || name === "origin") return "https://example.com";
  if (name === "domain") return "example.com";
  if (name === "repo") return "expressjs/express";
  if (name === "intent") return "extract a public web page into structured JSON metadata";
  if (name === "address") return `0x${"0".repeat(40)}`;
  if (name === "marketId" || name === "transactionHash") return `0x${"0".repeat(64)}`;
  if (schema.type === "number" || schema.type === "integer") {
    const minimum = Number(schema.minimum ?? 0);
    return String(schema.exclusiveMinimum !== undefined ? Number(schema.exclusiveMinimum) + 1 : minimum);
  }
  return null;
}

export function buildAuditTarget(origin, route, operation) {
  const target = new URL(route, origin);
  for (const parameter of operation?.parameters || []) {
    if (parameter?.in !== "query" || parameter?.required !== true) continue;
    const name = String(parameter.name || "");
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) || CREDENTIAL_KEY.test(name)) {
      throw new Error(`unsafe required query parameter on ${route}`);
    }
    const example = parameterExample(parameter);
    if (example === null) throw new Error(`unresolved required query parameter ${name} on ${route}`);
    target.searchParams.set(name, example);
  }
  target.searchParams.sort();
  return target.toString();
}

export function validatePaymentRequiredHeader(header) {
  if (typeof header !== "string" || header.length < 8 || header.length > 1_000_000) {
    return { valid: false, errors: ["missing_or_oversized_payment_required"] };
  }
  try {
    const payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const extension = payload?.extensions?.bazaar;
    if (!extension || typeof extension !== "object") {
      return { valid: false, errors: ["bazaar_extension_missing"] };
    }
    const schemaResult = validateDiscoveryExtension(extension);
    const specResult = validateDiscoveryExtensionSpec(extension);
    return {
      valid: schemaResult.valid === true && specResult.valid === true,
      errors: [...(schemaResult.errors || []), ...(specResult.errors || [])].slice(0, 20),
    };
  } catch {
    return { valid: false, errors: ["malformed_payment_required"] };
  }
}

export async function auditBazaarContracts({ origin, fetchImpl = fetch } = {}) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash || base.username || base.password) {
    throw new Error("origin must be a credential-free HTTPS origin");
  }
  const openApiResponse = await fetchImpl(new URL("/openapi.json", base), {
    method: "GET",
    redirect: "error",
    headers: { accept: "application/json", "user-agent": "SameDayDesk-Bazaar-Contract-Audit/1.0" },
  });
  if (!openApiResponse?.ok) throw new Error(`OpenAPI returned HTTP ${openApiResponse?.status}`);
  const openapi = await openApiResponse.json();
  const operations = Object.entries(openapi?.paths || {})
    .filter(([, item]) => item?.get?.["x-payment-info"])
    .map(([route, item]) => ({ route, operation: item.get }))
    .sort((left, right) => left.route.localeCompare(right.route));

  const routes = [];
  for (const { route, operation } of operations) {
    const target = buildAuditTarget(base, route, operation);
    try {
      const response = await fetchImpl(target, {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json", "user-agent": "SameDayDesk-Bazaar-Contract-Audit/1.0" },
      });
      const validation = response?.status === 402
        ? validatePaymentRequiredHeader(response.headers.get("payment-required") || response.headers.get("x-payment-required"))
        : { valid: false, errors: [`expected_402_received_${response?.status}`] };
      routes.push({ route, status: response?.status ?? null, ...validation });
    } catch {
      routes.push({ route, status: null, valid: false, errors: ["credential_free_probe_failed"] });
    }
  }

  const validRoutes = routes.filter((route) => route.valid).length;
  return {
    schemaVersion: SCHEMA_VERSION,
    checkedAt: new Date().toISOString(),
    origin: base.origin,
    version: openapi?.info?.version || null,
    routeCount: routes.length,
    validRoutes,
    invalidRoutes: routes.length - validRoutes,
    routes,
    safety: {
      credentialsUsed: false,
      paymentSigned: false,
      paymentSent: false,
      opaqueHeadersRetained: false,
      queryValuesRetained: false,
    },
  };
}

async function main() {
  const result = await auditBazaarContracts({ origin: value("origin") || "https://agents.samedaydesk.com" });
  console.log(JSON.stringify(result, null, 2));
  if (result.invalidRoutes > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Bazaar contract audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export { SCHEMA_VERSION };
