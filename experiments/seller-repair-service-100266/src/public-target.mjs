import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// Same public-address contract as payment-offer-preflight. The portable
// consumer uses this copy when that module is not installed. The experiment
// calls the imported helpers and checks the copy against them.

const blockedAddresses = new BlockList();
for (const [address, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["100::", 64, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
]) blockedAddresses.addSubnet(address, prefix, family);

const SENSITIVE_QUERY_KEY = /(?:^|[-_.])(api[-_.]?key|access[-_.]?token|auth|authorization|credential|password|secret|token)(?:$|[-_.])/i;

export function vendoredPublicAddress(address) {
  const family = isIP(address);
  if (!family) return false;
  if (family === 6 && /^::ffff:/i.test(address)) return false;
  return !blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function vendoredPinnedLookup(resolved) {
  return (_hostname, options, callback) => {
    if (options?.all === true) return callback(null, [{ address: resolved.address, family: resolved.family }]);
    return callback(null, resolved.address, resolved.family);
  };
}

export function publicOriginShape(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return { ok: false, reason: "target_not_authorized" };
  let target;
  try {
    target = new URL(raw);
  } catch {
    return { ok: false, reason: "target_not_authorized" };
  }
  if (target.protocol !== "https:" || target.username || target.password || target.hash) {
    return { ok: false, reason: "target_not_authorized" };
  }
  if (target.port) return { ok: false, reason: "target_not_authorized" };
  if (target.pathname !== "/" && target.pathname !== "") return { ok: false, reason: "target_not_authorized" };
  if (target.search) return { ok: false, reason: "target_not_authorized" };
  if (/[{}]/.test(target.pathname) || /:\w+/.test(target.pathname)) {
    return { ok: false, reason: "target_not_authorized" };
  }
  for (const key of target.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) return { ok: false, reason: "target_not_authorized" };
  }
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return { ok: false, reason: "target_not_public" };
  }
  if (isIP(hostname) && !vendoredPublicAddress(hostname)) return { ok: false, reason: "target_not_public" };
  return { ok: true, hostname, origin: target.origin };
}

function sameAddresses(left, right) {
  const key = (rows) => rows.map((row) => `${row.address}/${row.family}`).sort().join(",");
  return key(left) === key(right);
}

async function listAddresses(hostname, lookupImpl) {
  const lookup = lookupImpl || dnsLookup;
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "dns_failed" };
  }
  if (!Array.isArray(addresses)) {
    if (addresses && typeof addresses.address === "string") addresses = [addresses];
    else return { ok: false, reason: "dns_failed" };
  }
  if (addresses.length === 0) return { ok: false, reason: "dns_failed" };
  const rows = addresses.map((entry) => ({
    address: entry?.address,
    family: entry?.family || (String(entry?.address || "").includes(":") ? 6 : 4),
  }));
  if (rows.some((row) => typeof row.address !== "string" || !row.address)) return { ok: false, reason: "dns_failed" };
  return { ok: true, addresses: rows };
}

function mapImportedError(error) {
  const code = error?.code;
  if (code === "ssrf_rejected") return "target_not_public";
  if (code === "dns_failed") return "dns_failed";
  return "target_not_authorized";
}

async function loadBoundary() {
  try {
    const mod = await import("../../../payment-offer-preflight.mjs");
    return { kind: "imported", ...mod };
  } catch (error) {
    const message = String(error?.message || error);
    if (error?.code === "ERR_MODULE_NOT_FOUND" || message.includes("Cannot find module") || message.includes("Cannot find package")) {
      return { kind: "vendored" };
    }
    throw error;
  }
}

export async function assessPublicOrigin(origin, { lookupImpl = null, implementation = null } = {}) {
  const boundary = implementation === "vendored" ? { kind: "vendored" } : await loadBoundary();
  const useVendored = boundary.kind === "vendored" || implementation === "vendored";
  const label = useVendored ? "vendored" : "imported";
  if (!useVendored) {
    try {
      boundary.normalizePaymentTarget(String(origin || ""));
    } catch (error) {
      return { ok: false, reason: mapImportedError(error), implementation: label };
    }
  } else {
    const normalized = publicOriginShape(origin);
    if (!normalized.ok) return { ...normalized, implementation: label };
  }

  let parsed;
  try {
    parsed = new URL(String(origin));
  } catch {
    return { ok: false, reason: "target_not_authorized", implementation: label };
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return { ok: false, reason: "target_not_authorized", implementation: label };
  }
  if (parsed.port && parsed.port !== "443") return { ok: false, reason: "target_not_authorized", implementation: label };
  if (parsed.pathname !== "/" && parsed.pathname !== "") return { ok: false, reason: "target_not_authorized", implementation: label };
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isPublic = useVendored ? vendoredPublicAddress : boundary.publicAddress;
  if (isIP(hostname)) {
    if (!isPublic(hostname)) return { ok: false, reason: "target_not_public", implementation: useVendored ? "vendored" : "imported" };
    const resolved = { address: hostname, family: isIP(hostname) };
    const pin = useVendored ? vendoredPinnedLookup(resolved) : boundary.createPinnedLookup(resolved);
    return { ok: true, reason: null, resolved, lookup: pin, resolvedPublic: true, implementation: useVendored ? "vendored" : "imported" };
  }

  const first = await listAddresses(hostname, lookupImpl);
  if (!first.ok) return { ...first, implementation: useVendored ? "vendored" : "imported" };
  if (first.addresses.some((row) => !isPublic(row.address))) {
    return { ok: false, reason: "target_not_public", implementation: useVendored ? "vendored" : "imported" };
  }
  const second = await listAddresses(hostname, lookupImpl);
  if (!second.ok) return { ...second, implementation: useVendored ? "vendored" : "imported" };
  if (!sameAddresses(first.addresses, second.addresses) || second.addresses.some((row) => !isPublic(row.address))) {
    return { ok: false, reason: "dns_changed", implementation: useVendored ? "vendored" : "imported" };
  }
  let resolved = { address: first.addresses[0].address, family: Number(first.addresses[0].family) === 6 ? 6 : 4 };
  if (!useVendored) {
    try {
      resolved = await boundary.resolvePublicAddress(hostname, { lookupImpl: lookupImpl || dnsLookup });
    } catch (error) {
      return { ok: false, reason: mapImportedError(error), implementation: "imported" };
    }
    if (!first.addresses.some((row) => row.address === resolved.address)) {
      return { ok: false, reason: "dns_changed", implementation: "imported" };
    }
    const third = await listAddresses(hostname, lookupImpl);
    if (!third.ok) return { ...third, implementation: "imported" };
    if (!sameAddresses(first.addresses, third.addresses)) {
      return { ok: false, reason: "dns_changed", implementation: "imported" };
    }
  }
  const pin = useVendored ? vendoredPinnedLookup(resolved) : boundary.createPinnedLookup(resolved);
  return {
    ok: true,
    reason: null,
    resolved,
    lookup: pin,
    resolvedPublic: true,
    implementation: useVendored ? "vendored" : "imported",
  };
}
