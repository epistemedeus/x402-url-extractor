import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifySemverDelta,
  parseSemver,
} from "../fixtures/local-semver.mjs";

test("exact x.y.z deltas match S122 rules", () => {
  assert.equal(classifySemverDelta("1.2.3", "1.2.3"), "none");
  assert.equal(classifySemverDelta("1.2.3", "1.2.4"), "patch");
  assert.equal(classifySemverDelta("1.2.3", "1.3.0"), "minor");
  assert.equal(classifySemverDelta("1.2.3", "2.0.0"), "major");
  assert.equal(classifySemverDelta("v59.9.1", "59.15.1"), "minor");
});

test("ranges and junk are unknown, not a break", () => {
  assert.equal(parseSemver("^1.2.3"), null);
  assert.equal(classifySemverDelta("^1.2.3", "1.3.0"), "unknown");
  assert.equal(classifySemverDelta("not-a-version", "1.0.0"), "unknown");
});

test("S122 file, when present, agrees with the cell fixture copy", async () => {
  const s122 = new URL(
    "../../../../s122-application-jobs/recipes/lib/semver.mjs",
    import.meta.url,
  );
  const mod = await import(s122.href);
  assert.equal(mod.classifySemverDelta("2.1.260", "2.1.267"), "patch");
  assert.equal(classifySemverDelta("2.1.260", "2.1.267"), "patch");
  assert.equal(mod.classifySemverDelta("1.0.0", "1.0.0-rc.1"), "none");
  assert.equal(classifySemverDelta("1.0.0", "1.0.0-rc.1"), "none");
});
