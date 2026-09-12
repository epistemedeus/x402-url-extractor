import assert from "node:assert/strict";
import test from "node:test";

import { capturePaidEvidenceResponseDigest } from "../../commerce-events.mjs";
import { MAX_RESPONSE_BYTES } from "../index.mjs";

function fakeRes() {
  return {
    statusCode: 200,
    write(_chunk, encoding, callback) {
      const done = typeof encoding === "function" ? encoding : callback;
      done?.();
      return true;
    },
    end(_chunk, encoding, callback) {
      const done = typeof encoding === "function" ? encoding : callback;
      done?.();
    },
  };
}

test("reused write buffers are copied before mutation", () => {
  const res = fakeRes();
  const finish = capturePaidEvidenceResponseDigest(res, "GET", "/extract");
  const chunk = Buffer.from("hello-extract-body");
  res.write(chunk);
  chunk.fill(0xff);
  res.end();
  const captured = finish();
  assert.equal(captured.bytes.toString("utf8"), "hello-extract-body");
  assert.equal(captured.byteLength, "hello-extract-body".length);
  assert.equal(captured.retainedByteLength, captured.byteLength);
  assert.match(captured.digest, /^[0-9a-f]{64}$/);
});

test("oversized bodies retain a prefix while hashing the full length", () => {
  const res = fakeRes();
  const finish = capturePaidEvidenceResponseDigest(res, "GET", "/extract");
  const piece = Buffer.alloc(1024 * 1024, 0x7b);
  const pieces = 11;
  for (let i = 0; i < pieces; i += 1) res.write(piece);
  res.end();
  const captured = finish();
  assert.equal(captured.byteLength, pieces * piece.length);
  assert.equal(captured.retainedByteLength, MAX_RESPONSE_BYTES);
  assert.equal(captured.bytes.length, MAX_RESPONSE_BYTES);
  assert.ok(captured.byteLength > captured.retainedByteLength);
});

test("unsupported paid routes hash without retaining body bytes", () => {
  const res = fakeRes();
  const finish = capturePaidEvidenceResponseDigest(res, "GET", "/scan");
  res.write(Buffer.from("scan-private-body"));
  res.end();
  const captured = finish();
  assert.equal(captured.byteLength, "scan-private-body".length);
  assert.equal(captured.retainedByteLength, 0);
  assert.equal(captured.bytes.length, 0);
  assert.match(captured.digest, /^[0-9a-f]{64}$/);
});
