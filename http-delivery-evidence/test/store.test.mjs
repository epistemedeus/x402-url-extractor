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
    const record = recordFromObservedResponse({
      method: "GET",
      resource: RESOURCES.EXTRACT,
      responseBytes: bytes,
      merchantHttpStatus: 200,
      settlementClass: SETTLEMENT_CLASS.SIMULATED,
      settlementReference: `0x${"e".repeat(64)}`,
    });
    const v1 = historicalV1Row({
      responseDigest: record.responseDigest,
      method: "GET",
      route: "/extract",
    });
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
