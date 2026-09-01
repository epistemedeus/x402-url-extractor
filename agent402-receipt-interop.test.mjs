/**
 * Compatibility replay against the pinned Agent402 PR 1070 offer-receipt
 * capture contract (merge f6f2595d202b9224fd70bc090a3b0330f8b19852;
 * upstream scripts/lib/smoke-receipt.js SHA-256
 * 90841bd10f4176eff8b838d953d56836d2c6b4bef6a0537c654314b86feba268;
 * AGPL-3.0). No Agent402 source is imported or retained.
 *
 * Independently authored helper writes the observable artifact shape:
 * complete bare receipt object, pretty JSON with trailing newline, mode 0600,
 * no wrapper. Suite proves file -> JSON.parse -> receiptReferralId /
 * receiptReferralRecheck, RFC 8785/SHA-256 identity across serialization, and
 * fail-closed verifier cases. No wallet, network payment, or protocol redesign.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open as fsOpen, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalize } from "@x402/extensions/offer-receipt";

import { createCommerceTrust } from "./commerce-trust.mjs";
import {
  ReceiptReferralRecheckError,
  createReceiptReferralClaimStore,
  receiptReferralId,
  receiptReferralRecheck,
} from "./receipt-referral-recheck.mjs";
import { isReceiptReferralId, normalizeReceiptReferralId } from "./receipt-referral.mjs";

const PROVENANCE_PATH = fileURLToPath(new URL("./fixtures/agent402-pr1070/provenance.json", import.meta.url));
const AGENT402_MERGE = "f6f2595d202b9224fd70bc090a3b0330f8b19852";
const AGENT402_SOURCE_SHA256 = "90841bd10f4176eff8b838d953d56836d2c6b4bef6a0537c654314b86feba268";
const PUBLIC_URL = "https://agents.samedaydesk.com";
const NETWORK = "eip155:8453";
const PRIVATE_KEY = `0x${"1".repeat(64)}`;
const FOREIGN_KEY = `0x${"2".repeat(64)}`;
const PAYER_ONE = `0x${"a".repeat(40)}`;
const PAYER_TWO = `0x${"b".repeat(40)}`;
const TX_ONE = `0x${"1".repeat(64)}`;
const TX_TWO = `0x${"2".repeat(64)}`;
const ORIGINAL_URL = `${PUBLIC_URL}/commerce/seller-integrity-audit?origin=https%3A%2F%2Fseller.example&route=%2Fpaid&method=GET&requiredPaths=data.id&requireBazaar=true`;

const trust = createCommerceTrust({ privateKey: PRIVATE_KEY, network: NETWORK });
const foreignTrust = createCommerceTrust({ privateKey: FOREIGN_KEY, network: NETWORK });

function downstreamUrl(referralId) {
  return `${PUBLIC_URL}/commerce/seller-integrity-audit?origin=https%3A%2F%2Fdownstream.example&route=%2Fchanged&method=POST&referral=${referralId}`;
}

async function signedReceipt({
  issuer = trust.issuer,
  resourceUrl,
  payer,
  network = NETWORK,
  transaction,
  issuedAt,
}) {
  const realNow = Date.now;
  Date.now = () => issuedAt * 1000;
  try {
    return await issuer.issueReceipt(resourceUrl, payer, network, transaction);
  } finally {
    Date.now = realNow;
  }
}

async function tempDir(t, prefix = "agent402-receipt-interop-") {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function options(claimStore, audit = async () => ({ ok: true })) {
  return {
    merchantSigner: trust.signerAddress,
    network: NETWORK,
    publicUrl: PUBLIC_URL,
    claimStore,
    audit,
  };
}

async function expectCode(promise, code, statusCode = 400) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof ReceiptReferralRecheckError, true);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    return true;
  });
}

/**
 * Independently authored writer for the pinned observable capture contract.
 * Does not decode settlement headers or extract offer-receipt extensions.
 */
async function writePinnedCaptureArtifact(filePath, receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new TypeError("pinned capture artifact requires one complete receipt object");
  }
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  const handle = await fsOpen(filePath, "wx", 0o600);
  try {
    await handle.writeFile(bytes, "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  return bytes;
}

async function loadPinnedCaptureArtifact(dir, receipt, name = "captured-receipt.json") {
  const out = path.join(dir, name);
  const written = await writePinnedCaptureArtifact(out, receipt);
  const bytes = await readFile(out, "utf8");
  assert.equal(bytes, written);
  assert.equal(bytes, `${JSON.stringify(receipt, null, 2)}\n`);
  assert.equal((await stat(out)).mode & 0o777, 0o600);
  return JSON.parse(bytes);
}

test("provenance fixture pins Agent402 merge, source hash, license, and artifact contract without source", async () => {
  const provenance = JSON.parse(await readFile(PROVENANCE_PATH, "utf8"));
  assert.equal(provenance.upstream.mergeCommit, AGENT402_MERGE);
  assert.equal(provenance.upstream.sourcePath, "scripts/lib/smoke-receipt.js");
  assert.equal(provenance.upstream.sourceSha256, AGENT402_SOURCE_SHA256);
  assert.equal(provenance.upstream.license, "AGPL-3.0");
  assert.equal(provenance.artifactContract.contents, "complete bare signed offer-receipt object");
  assert.equal(provenance.artifactContract.serialization, "pretty JSON with trailing newline");
  assert.equal(provenance.artifactContract.fileMode, "0600");
  assert.equal(provenance.artifactContract.wrapper, "none");
  assert.match(await readFile(new URL("./fixtures/agent402-pr1070/README.md", import.meta.url), "utf8"), /does not contain Agent402 source/);
});

test(`pinned contract ${AGENT402_MERGE} pretty JSON artifact yields a stable r1_ referral after JSON.parse`, async (t) => {
  const dir = await tempDir(t);
  const original = await signedReceipt({
    resourceUrl: ORIGINAL_URL,
    payer: PAYER_ONE,
    transaction: TX_ONE,
    issuedAt: 1_800_000_000,
  });
  const fromFile = await loadPinnedCaptureArtifact(dir, original);
  const directId = receiptReferralId(original);
  const fileId = receiptReferralId(fromFile);
  const reparsedCompact = receiptReferralId(JSON.parse(JSON.stringify(fromFile)));

  assert.equal(isReceiptReferralId(directId), true);
  assert.equal(normalizeReceiptReferralId(fileId), fileId);
  assert.equal(fileId, directId);
  assert.equal(reparsedCompact, directId);
  assert.equal(
    createHash("sha256").update(canonicalize(fromFile)).digest("hex"),
    directId.slice(3),
  );
  assert.notEqual(await readFile(path.join(dir, "captured-receipt.json"), "utf8"), canonicalize(original));
});

test("pinned-capture original plus distinct downstream claim succeeds through exported recheck", async (t) => {
  const dir = await tempDir(t);
  const dataDir = await tempDir(t, "agent402-claim-store-");
  const claimStore = createReceiptReferralClaimStore({ dataDir });
  const originalLive = await signedReceipt({
    resourceUrl: ORIGINAL_URL,
    payer: PAYER_ONE,
    transaction: TX_ONE,
    issuedAt: 1_800_000_000,
  });
  const original = await loadPinnedCaptureArtifact(dir, originalLive, "original.json");
  const referralId = receiptReferralId(original);
  const downstreamLive = await signedReceipt({
    resourceUrl: downstreamUrl(referralId),
    payer: PAYER_TWO,
    transaction: TX_TWO,
    issuedAt: 1_800_000_001,
  });
  const downstream = await loadPinnedCaptureArtifact(dir, downstreamLive, "downstream.json");

  let auditedInput;
  const result = await receiptReferralRecheck({ original, downstream }, options(claimStore, async (input) => {
    auditedInput = input;
    return { ok: true, decision: "machine_buyable", request: input };
  }));

  assert.equal(result.ok, true);
  assert.equal(result.referralId, referralId);
  assert.equal(result.reward, "one_free_changed_state_recheck");
  assert.equal(result.boundary.rawReceiptsRetained, false);
  assert.equal(result.boundary.payersRetained, false);
  assert.equal(result.boundary.transactionsRetained, false);
  assert.equal(result.boundary.charged, false);
  assert.deepEqual(auditedInput, {
    origin: "https://seller.example",
    route: "/paid",
    method: "GET",
    requiredPaths: ["data.id"],
    requireBazaar: true,
    referral: null,
  });
});

test("pinned-capture path remains fail-closed for hostile and absent cases", async (t) => {
  const dir = await tempDir(t);
  const dataDir = await tempDir(t, "agent402-hostile-store-");
  const claimStore = createReceiptReferralClaimStore({ dataDir });

  const originalLive = await signedReceipt({
    resourceUrl: ORIGINAL_URL,
    payer: PAYER_ONE,
    transaction: TX_ONE,
    issuedAt: 1_800_000_000,
  });
  const original = await loadPinnedCaptureArtifact(dir, originalLive, "original.json");
  const referralId = receiptReferralId(original);

  await t.test("absent receipt is rejected before claim consumption", async () => {
    await expectCode(
      receiptReferralRecheck({ original: null, downstream: original }, options(claimStore)),
      "invalid_referral_claim",
    );
    await expectCode(
      receiptReferralRecheck({ original }, options(claimStore)),
      "invalid_referral_claim",
    );
    await assert.rejects(
      () => writePinnedCaptureArtifact(path.join(dir, "absent.json"), null),
      /complete receipt object/,
    );
  });

  await t.test("malformed capture file object is rejected before claim consumption", async () => {
    const malformedPath = path.join(dir, "malformed.json");
    await writeFile(malformedPath, `${JSON.stringify({ format: "eip712", payload: { version: 1 }, signature: "0x" }, null, 2)}\n`, { mode: 0o600 });
    const malformed = JSON.parse(await readFile(malformedPath, "utf8"));
    await expectCode(
      receiptReferralRecheck({ original: malformed, downstream: original }, options(claimStore)),
      "invalid_referral_claim",
    );
  });

  await t.test("foreign signer", async () => {
    const foreignOriginal = await signedReceipt({
      issuer: foreignTrust.issuer,
      resourceUrl: ORIGINAL_URL,
      payer: PAYER_ONE,
      transaction: TX_ONE,
      issuedAt: 1_800_000_000,
    });
    const foreignFromFile = await loadPinnedCaptureArtifact(dir, foreignOriginal, "foreign-original.json");
    const foreignDownstream = await signedReceipt({
      issuer: foreignTrust.issuer,
      resourceUrl: downstreamUrl(receiptReferralId(foreignFromFile)),
      payer: PAYER_TWO,
      transaction: TX_TWO,
      issuedAt: 1_800_000_001,
    });
    await expectCode(
      receiptReferralRecheck({
        original: foreignFromFile,
        downstream: await loadPinnedCaptureArtifact(dir, foreignDownstream, "foreign-downstream.json"),
      }, options(claimStore)),
      "foreign_receipt_signer",
      403,
    );
  });

  await t.test("same payer", async () => {
    const downstream = await signedReceipt({
      resourceUrl: downstreamUrl(referralId),
      payer: PAYER_ONE,
      transaction: TX_TWO,
      issuedAt: 1_800_000_001,
    });
    await expectCode(
      receiptReferralRecheck({
        original,
        downstream: await loadPinnedCaptureArtifact(dir, downstream, "same-payer.json"),
      }, options(claimStore)),
      "payer_not_distinct",
    );
  });

  await t.test("same transaction", async () => {
    const downstream = await signedReceipt({
      resourceUrl: downstreamUrl(referralId),
      payer: PAYER_TWO,
      transaction: TX_ONE,
      issuedAt: 1_800_000_001,
    });
    await expectCode(
      receiptReferralRecheck({
        original,
        downstream: await loadPinnedCaptureArtifact(dir, downstream, "same-tx.json"),
      }, options(claimStore)),
      "transaction_not_distinct",
    );
  });

  await t.test("referral mismatch", async () => {
    const downstream = await signedReceipt({
      resourceUrl: downstreamUrl(`r1_${"0".repeat(64)}`),
      payer: PAYER_TWO,
      transaction: TX_TWO,
      issuedAt: 1_800_000_001,
    });
    await expectCode(
      receiptReferralRecheck({
        original,
        downstream: await loadPinnedCaptureArtifact(dir, downstream, "mismatch.json"),
      }, options(claimStore)),
      "referral_mismatch",
    );
  });

  await t.test("duplicate claim after a successful pinned-capture replay", async () => {
    const downstream = await signedReceipt({
      resourceUrl: downstreamUrl(referralId),
      payer: PAYER_TWO,
      transaction: TX_TWO,
      issuedAt: 1_800_000_001,
    });
    const pair = {
      original,
      downstream: await loadPinnedCaptureArtifact(dir, downstream, "dup-downstream.json"),
    };
    await receiptReferralRecheck(pair, options(claimStore));
    await expectCode(receiptReferralRecheck(pair, options(claimStore)), "referral_already_claimed", 409);
  });
});
