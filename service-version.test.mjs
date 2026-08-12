import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SERVICE_VERSION } from "./service-version.mjs";

test("uses package.json as the single service version source", () => {
  const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  const packageLock = JSON.parse(readFileSync(new URL("./package-lock.json", import.meta.url), "utf8"));
  const registryDescriptor = JSON.parse(readFileSync(new URL("./server.json", import.meta.url), "utf8"));
  assert.equal(SERVICE_VERSION, packageJson.version);
  assert.equal(packageLock.version, SERVICE_VERSION);
  assert.equal(packageLock.packages[""].version, SERVICE_VERSION);
  assert.equal(registryDescriptor.version, SERVICE_VERSION);
  assert.ok(registryDescriptor.description.length <= 100);
  assert.match(SERVICE_VERSION, /^\d+\.\d+\.\d+$/);
});
