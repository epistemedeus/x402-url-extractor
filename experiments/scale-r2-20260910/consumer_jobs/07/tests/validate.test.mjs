import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ERROR_CODES,
  FREE_ALTERNATIVE_STATE,
  INPUT_SCHEMA,
  validateFreeBaselines,
  validateProcurementInput,
  validateTaskNeeds,
} from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));

test("validateTaskNeeds: accepts musts / capabilityIds / outcomes", () => {
  const needs = validateTaskNeeds({
    musts: ["a", "b"],
    capabilityIds: ["a"],
    outcomes: ["c"],
  });
  assert.deepEqual(needs.musts, ["a", "b"]);
  assert.deepEqual(needs.capabilityIds, ["a"]);
  assert.deepEqual(needs.outcomes, ["c"]);
});

test("validateTaskNeeds: rejects empty needs", () => {
  assert.throws(
    () => validateTaskNeeds({ musts: [], capabilityIds: [], outcomes: [] }),
    (err) => err.code === ERROR_CODES.MISSING_REQUIREMENT,
  );
});

test("validateProcurementInput: positive fixture normalizes", () => {
  const n = validateProcurementInput(load("positive.json"));
  assert.equal(n.schema, INPUT_SCHEMA);
  assert.equal(n.serviceContracts.length, 2);
  assert.equal(n.serviceContracts[0].price.present, true);
  assert.equal(
    n.serviceContracts[0].freeBaseline.freeAlternativeState,
    FREE_ALTERNATIVE_STATE.NOT_EQUIVALENT,
  );
});

test("validateProcurementInput: rejects forbidden ranking/invest/revenue fields", () => {
  assert.throws(
    () => validateProcurementInput(load("negative-malformed.json")),
    (err) => err.code === ERROR_CODES.FORBIDDEN_CLAIM,
  );

  assert.throws(
    () =>
      validateProcurementInput({
        taskId: "x",
        taskNeeds: { musts: ["a"] },
        serviceContracts: [
          {
            contractId: "c",
            capabilityIds: ["a"],
            rankingScore: 99,
            price: { amountAtomic: "1" },
          },
        ],
      }),
    (err) => err.code === ERROR_CODES.FORBIDDEN_CLAIM && err.details?.field === "rankingScore",
  );
});

test("validateFreeBaselines: unavailable stays distinct", () => {
  const list = validateFreeBaselines([
    {
      freeAlternativeState: "unavailable",
      freeAlternativeBasisId: "none_found_v1",
      appliesToContractId: "svc-1",
    },
  ]);
  assert.equal(list[0].freeAlternativeState, FREE_ALTERNATIVE_STATE.UNAVAILABLE);
  assert.equal(list[0].freeAlternativeBasisId, "none_found_v1");
});

test("validateFreeBaselines: rejects invalid state", () => {
  assert.throws(
    () =>
      validateFreeBaselines([
        { freeAlternativeState: "empty", freeAlternativeBasisId: "bad_v1" },
      ]),
    (err) => err.code === ERROR_CODES.INVALID_INPUT,
  );
});
