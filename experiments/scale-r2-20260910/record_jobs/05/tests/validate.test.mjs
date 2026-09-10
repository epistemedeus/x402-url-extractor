import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ERROR_CODES,
  INPUT_SCHEMA,
  validateRouteObservation,
  validateRouteRegressionInput,
  validateSnapshot,
} from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));

test("validateRouteRegressionInput: positive fixture normalizes", () => {
  const n = validateRouteRegressionInput(load("positive.json"));
  assert.equal(n.schema, INPUT_SCHEMA);
  assert.equal(n.baseline.routes.length, 6);
  assert.equal(n.current.routes.length, 6);
  assert.equal(n.baseline.routes[0].statusPresent, true);
});

test("validateRouteRegressionInput: rejects forbidden SEO/traffic/invest/health fields", () => {
  assert.throws(
    () => validateRouteRegressionInput(load("negative-malformed.json")),
    (err) => err.code === ERROR_CODES.FORBIDDEN_CLAIM,
  );

  assert.throws(
    () =>
      validateRouteRegressionInput({
        reportId: "x",
        baseline: { routes: [{ path: "/", status: 200 }] },
        current: { routes: [{ path: "/", status: 200, seoRank: 1 }] },
      }),
    (err) => err.code === ERROR_CODES.FORBIDDEN_CLAIM && err.details?.field === "seoRank",
  );
});

test("validateRouteObservation: statusCode alias and incomplete flag", () => {
  const full = validateRouteObservation({ path: "/z", statusCode: 410 }, 0);
  assert.equal(full.status, 410);
  assert.equal(full.statusPresent, true);
  assert.equal(full.incomplete, false);

  const incomplete = validateRouteObservation({ path: "/z", url: "https://example.test/z" }, 0);
  assert.equal(incomplete.incomplete, true);
  assert.equal(incomplete.statusPresent, false);
});

test("validateSnapshot: rejects duplicate routeKey", () => {
  assert.throws(
    () =>
      validateSnapshot({
        routes: [
          { path: "/dup", status: 200 },
          { path: "/dup", status: 404 },
        ],
      }),
    (err) => err.code === ERROR_CODES.INVALID_INPUT,
  );
});

test("validateRouteRegressionInput: requires both snapshots", () => {
  assert.throws(
    () => validateRouteRegressionInput({ reportId: "x", baseline: { routes: [{ path: "/", status: 200 }] } }),
    (err) => err.code === ERROR_CODES.MISSING_REQUIREMENT,
  );
});
