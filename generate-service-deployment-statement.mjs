#!/usr/bin/env node
import { createPrivateKey, createPublicKey } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createServiceDeploymentStatement,
  signServiceDeploymentStatement,
} from "agent-payment-policy";
import { SERVICE_DEPLOYMENT_ROUTES } from "./service-deployment-routes.mjs";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_NETWORK = "eip155:8453";
const BASE_PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const CANONICAL_ORIGIN = "https://agents.samedaydesk.com";
const MAX_TTL_MS = 30 * 86_400_000;
const PKCS8_ED25519_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function base58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let encoded = "";
  while (number > 0n) {
    const remainder = Number(number % 58n);
    encoded = alphabet[remainder] + encoded;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}

function atomicWrite(path, value, mode) {
  const target = resolve(path);
  const temporary = resolve(dirname(target), `.${target.split("/").at(-1)}.${process.pid}.tmp`);
  writeFileSync(temporary, value, { mode, flag: "wx" });
  renameSync(temporary, target);
  chmodSync(target, mode);
}

const walletPath = argument("wallet");
if (!walletPath) throw new Error("--wallet is required");
const envelopePath = argument("envelope", "service-deployment-statement.json");
const publicKeyPath = argument("public-key", "service-deployment-ed25519-public.pem");
const now = argument("now") ? Date.parse(argument("now")) : Date.now();
if (!Number.isFinite(now)) throw new Error("--now must be an ISO timestamp");

const wallet = JSON.parse(readFileSync(resolve(walletPath), "utf8"));
const secret = Buffer.from(wallet.secretKeyArray || []);
if (secret.length !== 64) throw new Error("wallet must contain one 64-byte Solana Ed25519 secretKeyArray");
const privateKey = createPrivateKey({
  key: Buffer.concat([PKCS8_ED25519_SEED_PREFIX, secret.subarray(0, 32)]),
  format: "der",
  type: "pkcs8",
});
const publicKey = createPublicKey(privateKey);
const publicDer = publicKey.export({ format: "der", type: "spki" });
const rawPublicKey = publicDer.subarray(-32);
if (!rawPublicKey.equals(secret.subarray(32))) throw new Error("wallet public key does not match its Ed25519 seed");
const derivedAddress = base58(rawPublicKey);
if (derivedAddress !== wallet.address) throw new Error("wallet address does not match its Ed25519 public key");

const settlement = [
  { protocol: "x402", network: BASE_NETWORK, asset: BASE_USDC, recipient: BASE_PAY_TO, decimals: 6 },
  { protocol: "mpp", network: BASE_NETWORK, asset: BASE_USDC, recipient: BASE_PAY_TO, decimals: 6 },
];
const statement = createServiceDeploymentStatement({
  canonicalOrigin: CANONICAL_ORIGIN,
  deployments: [{ origin: CANONICAL_ORIGIN, routes: SERVICE_DEPLOYMENT_ROUTES, settlement }],
}, { now, ttlMs: MAX_TTL_MS });
const envelope = signServiceDeploymentStatement(statement, {
  privateKey,
  kid: `solana-agent-wallet:${derivedAddress}`,
});
atomicWrite(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, 0o644);
atomicWrite(publicKeyPath, publicKey.export({ format: "pem", type: "spki" }), 0o644);
console.log(JSON.stringify({
  statementId: statement.statementId,
  canonicalOrigin: statement.canonicalOrigin,
  routeCount: statement.deployments[0].routes.length,
  settlementCount: statement.deployments[0].settlement.length,
  kid: `solana-agent-wallet:${derivedAddress}`,
  expiresAt: statement.expiresAt,
  envelope: resolve(envelopePath),
  publicKey: resolve(publicKeyPath),
  privateKeyExported: false,
  paymentAuthorized: false,
  paymentSigned: false,
  paymentSent: false,
}, null, 2));
