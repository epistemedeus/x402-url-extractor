import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  OFFICIAL_CLIENT_NEGOTIATION,
  UNKNOWN_TOOL_RECOVERY,
  FREE_PAGE_CHANGE,
} from "samedaydesk-capability-compat";
import { useFreeCompare, usePinProbe, useRecoveredCompare } from "../consumer.mjs";
import { startLoopbackPageChange } from "../test-only/start-loopback-page-change.mjs";

let profile;

before(async () => {
  profile = await startLoopbackPageChange();
});

after(async () => {
  await profile.close();
});

test("positive: official-style client compares held observations on the free profile without payment", async () => {
  const compared = await useFreeCompare(profile.endpoint, OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient);
  assert.equal(compared.paymentSignature, null);
  assert.equal(compared.charged, false);
  assert.equal(compared.verdict, "changed");
  assert.deepEqual(compared.tools, [FREE_PAGE_CHANGE.tool]);
  assert.ok(compared.result.content);
  assert.ok(compared.result.structuredContent);
  if (compared.protocol) {
    assert.equal(compared.protocol, OFFICIAL_CLIENT_NEGOTIATION.legacyProtocol);
  }
});

test("failure: explicit 2026-07-28 pin is refused on the free profile without a paid fallback", async () => {
  const refused = await usePinProbe(profile.endpoint, OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient);
  assert.equal(refused.connected, false);
  assert.equal(refused.pinRefused, true);
  assert.equal(refused.sdkError, true);
  assert.equal(refused.code, OFFICIAL_CLIENT_NEGOTIATION.pinClientErrorCode);
  assert.equal(refused.paymentSignature, null);
  assert.equal(refused.discover.refused, true);
  assert.equal(refused.discover.status, OFFICIAL_CLIENT_NEGOTIATION.discoverHttpStatus);
  assert.equal(refused.discover.errorCode, OFFICIAL_CLIENT_NEGOTIATION.discoverJsonRpcCode);
  assert.match(refused.discover.errorMessage, OFFICIAL_CLIENT_NEGOTIATION.discoverMessageUnsupported);
  assert.match(refused.discover.errorMessage, OFFICIAL_CLIENT_NEGOTIATION.discoverMessageSupported);
});

test("recovery: after pin refusal or unknown-tool, the pack completes the free compare on 2025-11-25 and tools/list", async () => {
  const refused = await usePinProbe(profile.endpoint);
  assert.equal(refused.pinRefused, true);
  const recovered = await useRecoveredCompare(profile.endpoint, OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient);
  if (recovered.protocol) {
    assert.equal(recovered.protocol, OFFICIAL_CLIENT_NEGOTIATION.legacyProtocol);
  }
  assert.deepEqual(recovered.listed, UNKNOWN_TOOL_RECOVERY.availableTools);
  assert.equal(recovered.charged, false);
  assert.equal(recovered.verdict, "changed");
});

