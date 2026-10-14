import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import express from "express";

import { callerResultFeedbackPublicContract } from "../../../caller-result-feedback.mjs";
import { createCallerResultFeedbackService } from "../../../caller-result-feedback.mjs";
import { CALLER_RESULT_FEEDBACK_HEADER } from "../../../caller-result-client/src/contract.mjs";
import { validExtractBody } from "../../../http-delivery-evidence/test/helpers.mjs";
import { bindUsefulServiceObservation, reportUsefulServiceObservation } from "../src/client-hook.mjs";
import { decoratePaidResponse } from "../src/mount.mjs";
import { mountUsefulServiceObservation } from "../src/mount.mjs";
import { issueCallerResultFeedbackToken } from "../../../caller-result-feedback.mjs";
import {
  NOW,
  observationFor,
  observedPair,
  removeDir,
  secret,
  tempDir,
  tokenFor,
  writeCaptures,
} from "./helpers.mjs";

async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, base: `http://127.0.0.1:${address.port}` };
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("the mount preserves the paid JSON body and the existing feedback contract", async () => {
  const dir = await tempDir();
  const key = secret();
  const pair = observedPair();
  await writeCaptures(dir, [pair]);
  const observation = observationFor(dir, key);
  const app = express();
  app.use(express.json({
    limit: "2kb",
    verify(req, _res, buffer) {
      req.rawBody = Buffer.from(buffer);
    },
  }));
  const paidBody = validExtractBody();
  app.get("/extract", (_req, res) => {
    const token = issueCallerResultFeedbackToken({
      key,
      eventId: pair.paid.id,
      method: "GET",
      route: "/extract",
      requestDigest: pair.paid.requestDigest,
      responseDigest: pair.paid.responseDigest,
      now: NOW,
    });
    decoratePaidResponse(res, {
      key,
      eventId: pair.paid.id,
      method: "GET",
      route: "/extract",
      requestDigest: pair.paid.requestDigest,
      responseDigest: pair.paid.responseDigest,
      statusCode: 200,
      now: NOW,
    });
    res.status(200).json(paidBody);
    assert.equal(typeof token, "string");
  });
  mountUsefulServiceObservation(app, observation);
  const { server, base } = await listen(app);
  try {
    const paid = await fetch(`${base}/extract`);
    const paidText = await paid.text();
    assert.equal(paidText, JSON.stringify(paidBody));
    assert.equal(paid.status, 200);
    const link = paid.headers.get("link");
    assert.match(link, /rel="caller-result-feedback"/);
    assert.match(link, /rel="useful-service-observation"/);
    const token = paid.headers.get("x-samedaydesk-caller-result-feedback");
    assert.equal(token, tokenFor(pair, key));

    const contract = await fetch(`${base}/commerce/caller-result-feedback`);
    assert.deepEqual(await contract.json(), callerResultFeedbackPublicContract());

    const direct = createCallerResultFeedbackService({ dataDir: dir, key, now: () => NOW });
    const canonicalBody = { disposition: "useful", reasonCategory: "matched_task" };
    const httpCanonical = await fetch(`${base}/commerce/caller-result-feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", [CALLER_RESULT_FEEDBACK_HEADER]: token },
      body: JSON.stringify(canonicalBody),
    });
    const httpJson = await httpCanonical.json();
    const aloneDir = await tempDir();
    await writeCaptures(aloneDir, [pair]);
    const alone = createCallerResultFeedbackService({ dataDir: aloneDir, key, now: () => NOW });
    const plain = await alone.submit({
      token,
      body: canonicalBody,
      rawBody: Buffer.from(JSON.stringify(canonicalBody)),
      query: {},
    });
    assert.deepEqual(httpJson, plain.body);
    assert.equal(await direct.readDeclarations().then((read) => read.declarations[0].disposition), "useful");

    const extended = await fetch(`${base}/commerce/caller-result-feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", [CALLER_RESULT_FEEDBACK_HEADER]: token },
      body: JSON.stringify({ ...canonicalBody, retainedUse: "retained", originLabel: "sponsored" }),
    });
    const extendedJson = await extended.json();
    assert.equal(extended.status, 200);
    assert.equal(extendedJson.retainedUse, "retained");
    assert.equal(extendedJson.idempotentReplay, false);
    assert.equal(extendedJson.usefulness, "unknown");
    assert.equal(JSON.stringify(extendedJson).includes(token), false);

    const result = { ok: true, body: JSON.parse(paidText) };
    bindUsefulServiceObservation(result, { response: paid, resourceUrl: `${base}/extract` });
    const reported = await reportUsefulServiceObservation(result, {
      disposition: "useful",
      reasonCategory: "matched_task",
      retainedUse: "not_retained",
    });
    assert.equal(reported.code, "conflicting_extension");
    assert.equal(reported.deliveryPreserved, true);
    assert.equal(reported.paymentAttempted, false);
    assert.equal(JSON.stringify(result).includes(token), false);
    await removeDir(aloneDir);
  } finally {
    await close(server);
    await removeDir(dir);
  }
});

test("the existing client hook still refuses an unextended server's extra fields without touching delivery", async () => {
  const dir = await tempDir();
  const key = secret();
  const pair = observedPair();
  await writeCaptures(dir, [pair]);
  const feedback = createCallerResultFeedbackService({ dataDir: dir, key, now: () => NOW });
  const app = express();
  app.use(express.json({
    verify(req, _res, buffer) { req.rawBody = Buffer.from(buffer); },
  }));
  app.post("/commerce/caller-result-feedback", async (req, res) => {
    const result = await feedback.submit({
      token: req.get(CALLER_RESULT_FEEDBACK_HEADER) || "",
      body: req.body,
      rawBody: req.rawBody,
      query: req.query,
    });
    res.status(result.statusCode).json(result.body);
  });
  const { server, base } = await listen(app);
  try {
    const headers = new Map([
      ["x-samedaydesk-caller-result-feedback", tokenFor(pair, key)],
    ]);
    const response = {
      headers: {
        get: (name) => headers.get(name.toLowerCase()) || null,
        has: (name) => headers.has(name.toLowerCase()),
      },
    };
    const result = { ok: true };
    bindUsefulServiceObservation(result, { response, resourceUrl: `${base}/extract` });
    const reported = await reportUsefulServiceObservation(result, {
      disposition: "useful",
      retainedUse: "retained",
    });
    assert.equal(reported.accepted, false);
    assert.equal(reported.code, "unbounded_field");
    assert.equal(reported.deliveryPreserved, true);
    assert.equal(result.ok, true);
  } finally {
    await close(server);
    await removeDir(dir);
  }
});
