/**
 * BasePay harness check identity at the pinned revision.
 *
 * This list is the layer-2 source of truth for check IDs. It is copied from
 * the independently executed `basepay-conformance/result` fixture, not from
 * this example's `node --test` count, merchant case count, or mapping rows.
 */
export const BASEPAY_CHECK_IDS = Object.freeze([
  "P0",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "F13",
  "F14",
  "F15",
  "F16",
  "F16b",
  "F17",
]);

export const BASEPAY_CHECK_COUNT = BASEPAY_CHECK_IDS.length;

export const CHECK_COUNT_SOURCE = "basepay-conformance/result.checks";
export const CHECK_COUNT_NOT_DERIVED_FROM = Object.freeze([
  "example_unit_tests",
  "merchant_stateful_case_count",
  "mapping_row_count",
  "imported_json_pass_promotion",
]);
