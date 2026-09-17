import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadFixture } from "../src/fixture.mjs";
import { UnpaidCallError } from "../src/errors.mjs";
import { REJECTION_KINDS } from "../src/constants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOSTILE = join(ROOT, "fixtures", "hostile");

const EXPECTED = Object.freeze({
  "is-error-false.json": REJECTION_KINDS.IS_ERROR_NOT_TRUE,
  "protocol-error-402.json": REJECTION_KINDS.PROTOCOL_ERROR,
  "missing-accepts.json": REJECTION_KINDS.MISSING_PAYMENT_REQUIRED,
  "paid-success-shape.json": REJECTION_KINDS.IS_ERROR_NOT_PRESERVED,
  "calltool-content-only.json": REJECTION_KINDS.IS_ERROR_NOT_PRESERVED,
  "payment-request-meta.json": REJECTION_KINDS.PAYMENT_ATTACHED,
  "empty-accepts.json": REJECTION_KINDS.EMPTY_ACCEPTS,
  "settlement-meta.json": REJECTION_KINDS.SETTLEMENT_EVIDENCE,
});

test("every hostile fixture is rejected", () => {
  const files = readdirSync(HOSTILE).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(files, Object.keys(EXPECTED).sort());
  for (const [name, kind] of Object.entries(EXPECTED)) {
    assert.throws(
      () => loadFixture(join(HOSTILE, name)),
      (error) => error instanceof UnpaidCallError && error.kind === kind,
      name,
    );
  }
});

test("seeded isError:false is not unpaid_call_is_error", () => {
  assert.throws(
    () => loadFixture(join(HOSTILE, "is-error-false.json")),
    (error) => error instanceof UnpaidCallError
      && error.kind === REJECTION_KINDS.IS_ERROR_NOT_TRUE
      && /isError:true/.test(error.message),
  );
});
