import { randomBytes } from "node:crypto";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { importJWK, importPKCS8, SignJWT } from "jose";

const CDP_HOST = "api.cdp.coinbase.com";
const CDP_PATH = "/platform/v2/x402";
const CDP_URL = `https://${CDP_HOST}${CDP_PATH}`;
// Preserve the deployed wrapper's correlation header across the transport change.
const CORRELATION = "sdk_version=1.29.0,sdk_language=typescript,source=x402,source_version=2.1.0";

async function importCdpApiKey(secret) {
  try {
    return { alg: "ES256", key: await importPKCS8(secret, "ES256") };
  } catch {
    // CDP's Ed25519 export is a 32-byte seed followed by its 32-byte public key.
  }
  const bytes = Buffer.from(secret, "base64");
  if (bytes.length !== 64) throw new Error("Invalid CDP API key format");
  try {
    const key = await importJWK({
      kty: "OKP",
      crv: "Ed25519",
      d: bytes.subarray(0, 32).toString("base64url"),
      x: bytes.subarray(32).toString("base64url"),
    }, "EdDSA");
    return { alg: "EdDSA", key };
  } catch {
    throw new Error("Invalid CDP API key format");
  }
}

// CDP secret API-key authentication for these three REST operations only.
// https://docs.cdp.coinbase.com/api-reference/v2/authentication
export function createCdpFacilitatorConfig(id, secret) {
  if (!id || !secret) throw new Error("FACILITATOR=cdp requires CDP_API_KEY_ID and CDP_API_KEY_SECRET env vars.");

  return {
    url: CDP_URL,
    async createAuthHeaders() {
      const { alg, key } = await importCdpApiKey(secret);
      async function headers(method, operation) {
        const now = Math.floor(Date.now() / 1000);
        const token = await new SignJWT({ uris: [`${method} ${CDP_HOST}${CDP_PATH}/${operation}`] })
          .setProtectedHeader({ alg, kid: id, typ: "JWT", nonce: randomBytes(16).toString("hex") })
          .setIssuer("cdp")
          .setSubject(id)
          .setIssuedAt(now)
          .setNotBefore(now)
          .setExpirationTime(now + 120)
          .sign(key);
        return { Authorization: `Bearer ${token}`, "Correlation-Context": CORRELATION };
      }
      return {
        verify: await headers("POST", "verify"),
        settle: await headers("POST", "settle"),
        supported: await headers("GET", "supported"),
        list: { "Correlation-Context": CORRELATION },
      };
    },
  };
}

export function createMerchantFacilitator(env = process.env) {
  const mode = (env.FACILITATOR || "xpay").toLowerCase();
  if (!["xpay", "cdp", "testnet"].includes(mode)) {
    throw new Error("Unsupported FACILITATOR; expected xpay, cdp, or testnet");
  }
  const config = mode === "cdp"
    ? createCdpFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET)
    : { url: mode === "testnet" ? "https://x402.org/facilitator" : env.FACILITATOR_URL || "https://facilitator.xpay.sh" };
  return { mode, client: new HTTPFacilitatorClient(config) };
}
