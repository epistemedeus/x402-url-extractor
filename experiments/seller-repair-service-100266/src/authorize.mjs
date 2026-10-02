import { PUBLIC_READONLY_ORIGIN, PUBLIC_READONLY_RESOURCES } from "./constants.mjs";

function urlOf(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function authorizeProbe({ intake, baseUrl }) {
  if (intake?.probeConsent?.confirmed !== true) return { ok: false, reason: "target_not_authorized" };
  const url = urlOf(baseUrl);
  if (!url || url.username || url.password || url.hash) return { ok: false, reason: "target_not_authorized" };
  if (intake.method !== "GET") return { ok: false, reason: "method_not_read_only" };
  if (intake.probeConsent.class === "public-read-only") {
    if (url.origin !== PUBLIC_READONLY_ORIGIN || intake.origin !== PUBLIC_READONLY_ORIGIN) {
      return { ok: false, reason: "target_not_authorized" };
    }
    if (url.pathname !== "/" && url.pathname !== "") return { ok: false, reason: "target_not_authorized" };
    if (!PUBLIC_READONLY_RESOURCES.includes(intake.resource)) return { ok: false, reason: "resource_not_authorized" };
    return { ok: true, transport: "public-read-only" };
  }
  if (intake.probeConsent.class === "loopback") {
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
      return { ok: false, reason: "target_not_authorized" };
    }
    return { ok: true, transport: "loopback" };
  }
  return { ok: false, reason: "target_not_authorized" };
}
