// Consumer binding after a verified Poppy session result.
// Signature checks, key resolution, and access-token checks belong to the injected
// verifier (H64220 when its export is present). This module does not verify JWTs.

import { MAX_SESSION_HEADER_CHARS } from "./constants.mjs";

export const INVALID_SESSION = Object.freeze({ error: "invalid_session" });

export const VERIFIER_PORT = Object.freeze({
  schema: "h64221.poppy-reader.verifier-port.v1",
  name: "verifyPoppySession",
  call: "verifyPoppySession({ header, method, url, authorization, issuer, now })",
  success: {
    ok: true,
    session: ["clientId", "sid", "sub", "agentId", "signedIn", "htm", "htu", "aud"],
  },
  failure: { ok: false, error: "invalid_session" },
  notes: [
    "authorization is omitted when the request has no Authorization header.",
    "signedIn may be true or false. The adapter never treats it as payment or as a different target.",
    "evidence is not part of this port. A boundary fixture may add it; the adapter ignores it.",
    "The adapter also refuses the handler when htm, htu, or aud disagree with this deployment.",
  ],
});

function invalid() {
  return { ok: false, error: "invalid_session" };
}

export function singleHeader(value) {
  if (typeof value !== "string") return invalid();
  if (value.length === 0 || value.length > MAX_SESSION_HEADER_CHARS) return invalid();
  if (value.includes("\n") || value.includes("\r") || value.includes("\0")) return invalid();
  return { ok: true, value };
}

export function requestTarget({ origin, path, method }) {
  const url = new URL(path, origin);
  url.search = "";
  url.hash = "";
  return { method: String(method || "").toUpperCase(), url: url.href };
}

function sessionShape(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return false;
  if (typeof session.clientId !== "string" || session.clientId.length === 0) return false;
  if (typeof session.sid !== "string" || session.sid.length === 0) return false;
  if (typeof session.sub !== "string" || session.sub.length === 0) return false;
  if (typeof session.signedIn !== "boolean") return false;
  if (typeof session.htm !== "string" || typeof session.htu !== "string" || typeof session.aud !== "string") return false;
  if (session.agentId != null && typeof session.agentId !== "string") return false;
  return true;
}

// Returns the bound session, or invalid_session. A verifier throw is a failed check.
export async function bindVerifiedSession({ verifier, header, method, url, authorization, issuer, now }) {
  if (typeof verifier !== "function") return invalid();
  const presented = singleHeader(header);
  if (!presented.ok) return invalid();
  if (authorization !== undefined && !singleHeader(authorization).ok) return invalid();
  let result;
  try {
    result = await verifier({
      header: presented.value,
      method,
      url,
      ...(authorization === undefined ? {} : { authorization }),
      issuer,
      now,
    });
  } catch {
    return invalid();
  }
  if (!result || result.ok !== true || result.error) return invalid();
  if (!sessionShape(result.session)) return invalid();
  const session = result.session;
  if (session.htm !== method || session.htu !== url || session.aud !== issuer) return invalid();
  return {
    ok: true,
    session: {
      clientId: session.clientId,
      sid: session.sid,
      sub: session.sub,
      agentId: typeof session.agentId === "string" ? session.agentId : null,
      signedIn: session.signedIn,
      htm: session.htm,
      htu: session.htu,
      aud: session.aud,
    },
  };
}
