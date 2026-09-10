import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyIdentifier,
  evaluateEntry,
  parseSpdx,
} from "../policy.mjs";

test("permissive identifiers are allowed", () => {
  for (const id of ["MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BlueOak-1.0.0"]) {
    assert.equal(classifyIdentifier(id), "allowed");
    assert.equal(parseSpdx(id).class, "allowed");
  }
});

test("GPL family is denied including OR-only GPL", () => {
  assert.equal(parseSpdx("GPL-3.0-only").class, "denied");
  assert.equal(parseSpdx("AGPL-3.0-or-later").class, "denied");
  assert.equal(parseSpdx("LGPL-2.1").class, "denied");
  assert.equal(parseSpdx("GPL-2.0-or-later").class, "denied");
});

test("MIT OR GPL-3.0-or-later is allowed if MIT is chosen", () => {
  const parsed = parseSpdx("MIT OR GPL-3.0-or-later");
  assert.equal(parsed.class, "allowed");
  assert.equal(parsed.chosen, "MIT");
  assert.ok(parsed.reasons.includes("dual-license-choose-permissive"));
});

test("MIT AND AGPL-3.0-only is denied", () => {
  const parsed = parseSpdx("MIT AND AGPL-3.0-only");
  assert.equal(parsed.class, "denied");
  assert.equal(parsed.chosen, null);
});

test("SEE LICENSE IN is unknown until a file SPDX is supplied", () => {
  const parsed = parseSpdx("SEE LICENSE IN license.md");
  assert.equal(parsed.class, "unknown");
  assert.ok(parsed.reasons.includes("see-license-in-file"));
});

test("recommend + GPL is blocked", () => {
  const result = evaluateEntry({
    id: "evil",
    decision: "recommend",
    licenseSpdx: "GPL-3.0-only",
    hasInstallScript: false,
  });
  assert.equal(result.ok, false);
  assert.ok(result.blocking.includes("denied-license"));
});

test("do_not_add + GPL is consistent", () => {
  const result = evaluateEntry({
    id: "evil",
    decision: "do_not_add",
    licenseSpdx: "GPL-3.0-only",
    hasInstallScript: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.licenseClass, "denied");
});

test("install scripts block shippable decisions", () => {
  const result = evaluateEntry({
    id: "bin",
    decision: "optional",
    licenseSpdx: "MIT",
    hasInstallScript: true,
  });
  assert.equal(result.ok, false);
  assert.ok(result.blocking.includes("install-script"));
});

test("regex claimed as full TS is blocked even when MIT", () => {
  const result = evaluateEntry({
    id: "re",
    decision: "recommend",
    licenseSpdx: "MIT",
    claimsFullTsViaRegex: true,
  });
  assert.equal(result.ok, false);
  assert.ok(result.blocking.includes("regex-claimed-as-full-ts"));
});

test("native bindings farm cannot be recommend or optional", () => {
  const rec = evaluateEntry({
    id: "oxc",
    decision: "recommend",
    licenseSpdx: "MIT",
    nativeBindingsFarm: true,
  });
  assert.equal(rec.ok, false);
});
