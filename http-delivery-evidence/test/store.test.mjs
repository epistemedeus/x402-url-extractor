import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { bindMerchantHttpDeliveryContracts } from "../bind-merchant-contracts.mjs";
import {
  DELIVERY,
  RESOURCES,
  SETTLEMENT_CLASS,
  isHistoricalV1PaidSuccess,
  joinKey,
  openStore,
  recordFromObservedResponse,
} from "../index.mjs";
import { historicalV1Row, validExtractBody } from "./helpers.mjs";

bindMerchantHttpDeliveryContracts();

test("optional validation records survive restart and still join unchanged v1 rows", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "http-delivery-store-"));
  try {
    const bytes = Buffer.from(JSON.stringify(validExtractBody()));
    const v1 = historicalV1Row({
      method: "GET",
      route: "/extract",
    });
    const record = recordFromObservedResponse({
      method: "GET",
      resource: RESOURCES.EXTRACT,
      responseBytes: bytes,
      merchantHttpStatus: 200,
      settlementClass: SETTLEMENT_CLASS.SIMULATED,
      settlementReference: `0x${"e".repeat(64)}`,
      paidEvidenceId: v1.id,
    });
    v1.responseDigest = record.responseDigest;
    await writeFile(path.join(dir, "commerce-paid-success-evidence.ndjson"), `${JSON.stringify(v1)}\n`, "utf8");
    const first = openStore(dir);
    await first.appendValidation(record);
    const joinedOnce = await first.join({ currentValidatorVerdict: "validated" });
    assert.equal(joinedOnce.length, 1);
    assert.equal(joinedOnce[0].historical.validatorVerdict, "not_checked");
    assert.equal(isHistoricalV1PaidSuccess(joinedOnce[0].historical, { currentValidatorVerdict: "validated" }), true);
    assert.equal(joinedOnce[0].validations[0].deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);
    assert.equal(
      joinKey(joinedOnce[0].historical),
      joinKey({ method: record.method, resource: record.resource, responseDigest: record.responseDigest }),
    );

    const second = openStore(dir);
    const joinedAgain = await second.join({ currentValidatorVerdict: "validated" });
    assert.equal(joinedAgain[0].historical.id, v1.id);
    assert.equal(joinedAgain[0].validations.length, 1);
    assert.equal(Object.hasOwn(joinedAgain[0].validations[0], "parsed"), false);
    assert.equal(JSON.stringify(joinedAgain[0].validations[0]).includes("ok.example"), false);

    const fabricated = recordFromObservedResponse({
      method: "GET",
      resource: RESOURCES.EXTRACT,
      responseBytes: Buffer.from(`${bytes.toString("utf8")} `),
      merchantHttpStatus: 200,
      settlementClass: SETTLEMENT_CLASS.SIMULATED,
      paidEvidenceId: v1.id,
    });
    assert.notEqual(fabricated.responseDigest, record.responseDigest);
    await second.appendValidation(fabricated);
    const after = await openStore(dir).join();
    const matched = after.find((row) => row.historical?.id === v1.id);
    assert.equal(matched.validations.some((item) => item.responseDigest === record.responseDigest), true);
    assert.equal(matched.validations.some((item) => item.responseDigest === fabricated.responseDigest), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("join emits one row per historical id even when response digests match", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "http-delivery-join-id-"));
  try {
    const bytes = Buffer.from(JSON.stringify(validExtractBody()));
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    const unmatchedId = "33333333-3333-4333-8333-333333333333";
    const matching = recordFromObservedResponse({
      method: "GET",
      resource: RESOURCES.EXTRACT,
      responseBytes: bytes,
      merchantHttpStatus: 200,
      settlementClass: SETTLEMENT_CLASS.SIMULATED,
      paidEvidenceId: firstId,
    });
    const refused = recordFromObservedResponse({
      method: "GET",
      resource: RESOURCES.EXTRACT,
      responseBytes: Buffer.from(JSON.stringify(validExtractBody({
        status: 403,
        sourceOk: false,
        error: { code: "http_403", message: "source refused: HTTP 403" },
      }))),
      merchantHttpStatus: 200,
      settlementClass: SETTLEMENT_CLASS.SIMULATED,
      paidEvidenceId: secondId,
    });
    const digest = matching.responseDigest;
    const rows = [
      historicalV1Row({
        id: firstId,
        requestDigest: "1".repeat(64),
        settlementReference: `0x${"a".repeat(64)}`,
        responseDigest: digest,
      }),
      historicalV1Row({
        id: secondId,
        requestDigest: "2".repeat(64),
        settlementReference: `0x${"b".repeat(64)}`,
        responseDigest: digest,
      }),
      historicalV1Row({
        id: unmatchedId,
        requestDigest: "3".repeat(64),
        settlementReference: `0x${"c".repeat(64)}`,
        responseDigest: digest,
      }),
    ];
    await writeFile(
      path.join(dir, "commerce-paid-success-evidence.ndjson"),
      `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      "utf8",
    );
    const store = openStore(dir);
    await store.appendValidation(matching);
    await store.appendValidation(refused);
    await store.appendValidation({
      ...matching,
      recordId: "hrv_" + "d".repeat(32),
      paidEvidenceId: firstId,
    });
    const joined = await store.join({ currentValidatorVerdict: "validated" });
    assert.equal(joined.length, 3);
    const byId = Object.fromEntries(joined.map((row) => [row.historical.id, row]));
    assert.equal(byId[firstId].validations.length, 2);
    assert.ok(byId[firstId].validations.every((item) => item.paidEvidenceId === firstId));
    assert.ok(byId[firstId].validations.every((item) => item.deliveryClass === DELIVERY.FULL_BOUNDED_CAPTURE));
    assert.equal(byId[secondId].validations.length, 0);
    assert.equal(byId[unmatchedId].validations.length, 0);
    assert.equal(byId[unmatchedId].historical.validatorVerdict, "not_checked");
    assert.notEqual(byId[firstId].historical.requestDigest, byId[secondId].historical.requestDigest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("body-only validation without paidEvidenceId does not attach to any purchase", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "http-delivery-join-ambiguous-"));
  try {
    const bytes = Buffer.from(JSON.stringify(validExtractBody()));
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    const matching = recordFromObservedResponse({
      method: "GET",
      resource: RESOURCES.EXTRACT,
      responseBytes: bytes,
      merchantHttpStatus: 200,
      settlementClass: SETTLEMENT_CLASS.SIMULATED,
      paidEvidenceId: firstId,
    });
    const { paidEvidenceId, ...bodyOnly } = matching;
    assert.equal(paidEvidenceId, firstId);
    await writeFile(
      path.join(dir, "commerce-paid-success-evidence.ndjson"),
      `${JSON.stringify(historicalV1Row({ id: firstId, responseDigest: matching.responseDigest }))}\n${JSON.stringify(historicalV1Row({ id: secondId, requestDigest: "2".repeat(64), settlementReference: `0x${"b".repeat(64)}`, responseDigest: matching.responseDigest }))}\n`,
      "utf8",
    );
    await writeFile(
      path.join(dir, "http-response-validation.v1.ndjson"),
      `${JSON.stringify(bodyOnly)}\n`,
      "utf8",
    );
    const joined = await openStore(dir).join();
    assert.equal(joined.length, 2);
    assert.equal(joined.every((row) => row.validations.length === 0), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
