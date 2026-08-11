import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SERVICE_VERSION } from "./service-version.mjs";

test("uses package.json as the single service version source", () => {
  const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  assert.equal(SERVICE_VERSION, packageJson.version);
  assert.match(SERVICE_VERSION, /^\d+\.\d+\.\d+$/);
});
