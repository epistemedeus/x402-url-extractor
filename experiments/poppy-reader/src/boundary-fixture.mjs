// Labelled stand-in for tests while H64220 has not published an executable export.
// This is not a session verifier and not an integration result.
// Tokens are an opaque prefix plus JSON. JWT-shaped strings are rejected whole.
// No signature, no key fetch, and no access-token check is performed here.

export const BOUNDARY_FIXTURE_PREFIX = "boundary-fixture:v1:";
export const BOUNDARY_FIXTURE_EVIDENCE = "boundary-fixture";

const REQUIRED = ["clientId", "sid", "sub", "htm", "htu", "aud"];
const ALLOWED = new Set(["v", "agentId", ...REQUIRED]);

function invalid() {
  return { ok: false, error: "invalid_session" };
}

export function boundaryFixtureHeader(claims) {
  const payload = { v: 1 };
  for (const key of REQUIRED) {
    if (typeof claims?.[key] !== "string" || claims[key].length === 0) {
      throw new Error(`boundary fixture header needs ${key}`);
    }
    payload[key] = claims[key];
  }
  if (claims.agentId !== undefined) {
    if (typeof claims.agentId !== "string" || claims.agentId.length === 0) {
      throw new Error("boundary fixture agentId must be a non-empty string when set");
    }
    payload.agentId = claims.agentId;
  }
  if (claims.signedIn !== undefined) {
    throw new Error("boundary fixture cannot represent signedIn; it does not check access tokens");
  }
  return BOUNDARY_FIXTURE_PREFIX + Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export async function verifyBoundaryFixture({ header, authorization, issuer } = {}) {
  if (authorization) return invalid();
  if (typeof header !== "string" || !header.startsWith(BOUNDARY_FIXTURE_PREFIX)) return invalid();
  const encoded = header.slice(BOUNDARY_FIXTURE_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return invalid();
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return invalid();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.v !== 1) return invalid();
  if (parsed.signedIn !== undefined) return invalid();
  if (Object.keys(parsed).some((key) => !ALLOWED.has(key))) return invalid();
  for (const key of REQUIRED) {
    if (typeof parsed[key] !== "string" || parsed[key].length === 0 || parsed[key].length > 2048) return invalid();
  }
  if (parsed.agentId !== undefined && (typeof parsed.agentId !== "string" || parsed.agentId.length === 0)) return invalid();
  if (typeof issuer !== "string" || parsed.aud !== issuer) return invalid();
  return {
    ok: true,
    evidence: BOUNDARY_FIXTURE_EVIDENCE,
    session: {
      clientId: parsed.clientId,
      sid: parsed.sid,
      sub: parsed.sub,
      agentId: parsed.agentId ?? null,
      signedIn: false,
      htm: parsed.htm,
      htu: parsed.htu,
      aud: parsed.aud,
    },
  };
}
