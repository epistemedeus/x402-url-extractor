import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyServiceDeploymentStatement } from "agent-payment-policy";
import {
  SERVICE_DEPLOYMENT_PATH,
  SERVICE_DEPLOYMENT_PUBLIC_KEY_PATH,
  SERVICE_DEPLOYMENT_ROUTES,
} from "./service-deployment-routes.mjs";

const SOLANA_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes) {
  let number = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let encoded = "";
  while (number > 0n) {
    const remainder = Number(number % 58n);
    encoded = SOLANA_ALPHABET[remainder] + encoded;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function decodePayload(envelope) {
  const text = Buffer.from(envelope.payload, "base64url").toString("utf8");
  const payload = JSON.parse(text);
  if (JSON.stringify(canonical(payload)) !== text) throw new Error("service deployment payload is not canonical");
  return payload;
}

export function loadServiceDeploymentPublication({
  canonicalOrigin,
  network,
  asset,
  recipient,
  operationalWallet,
  envelope = JSON.parse(readFileSync(new URL("./service-deployment-statement.json", import.meta.url), "utf8")),
  publicKeyPem = readFileSync(new URL("./service-deployment-ed25519-public.pem", import.meta.url), "utf8"),
  now = Date.now(),
} = {}) {
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("service deployment public key must be Ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const derivedWallet = base58(publicDer.subarray(-32));
  if (derivedWallet !== operationalWallet) throw new Error("service deployment public key is not the registered operational wallet");
  const payload = decodePayload(envelope);
  const expiresAtMs = Date.parse(payload.expiresAt);
  const issuedAtMs = Date.parse(payload.issuedAt);
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(issuedAtMs) || expiresAtMs <= issuedAtMs) {
    throw new Error("service deployment validity window is invalid");
  }
  const expectedRoutes = [...SERVICE_DEPLOYMENT_ROUTES].sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`));
  const expectedSettlement = ["mpp", "x402"].map((protocol) => ({ asset: asset.toLowerCase(), decimals: 6, network, protocol, recipient: recipient.toLowerCase() }));
  if (payload.canonicalOrigin !== canonicalOrigin || payload.deployments?.length !== 1 || payload.deployments[0].origin !== canonicalOrigin) {
    throw new Error("service deployment origin does not match production");
  }
  if (JSON.stringify(payload.deployments[0].routes) !== JSON.stringify(expectedRoutes)) {
    throw new Error("service deployment routes do not match production");
  }
  if (JSON.stringify(payload.deployments[0].settlement) !== JSON.stringify(expectedSettlement)) {
    throw new Error("service deployment settlement does not match production");
  }
  const signatureVerificationTime = Math.min(now, expiresAtMs - 1);
  for (const route of expectedRoutes) {
    for (const settlement of expectedSettlement) {
      verifyServiceDeploymentStatement(envelope, {
        publicKey,
        request: { method: route.method, url: `${canonicalOrigin}${route.path}` },
        runtimeOffer: settlement,
        now: signatureVerificationTime,
      });
    }
  }
  const fingerprint = `sha256:${createHash("sha256").update(publicDer).digest("hex")}`;
  return Object.freeze({
    envelope: Object.freeze(envelope),
    publicKeyPem,
    statementId: payload.statementId,
    expiresAt: payload.expiresAt,
    active: now >= issuedAtMs && now < expiresAtMs,
    expiresInMs: expiresAtMs - now,
    routeCount: expectedRoutes.length,
    settlementCount: expectedSettlement.length,
    publicKeyFingerprint: fingerprint,
    operationalWallet: derivedWallet,
    paths: Object.freeze({ statement: SERVICE_DEPLOYMENT_PATH, publicKey: SERVICE_DEPLOYMENT_PUBLIC_KEY_PATH }),
  });
}
