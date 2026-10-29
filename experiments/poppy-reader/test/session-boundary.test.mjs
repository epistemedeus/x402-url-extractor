import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createExtractionTrialBudget, provisionExtractionTrial } from "../../../extraction-trial.mjs";
import { authority, NOW } from "../../../extraction-trial-test-fixture.mjs";
import { createPoppyReaderAdapter } from "../src/adapter.mjs";
import { boundaryFixtureHeader, verifyBoundaryFixture } from "../src/boundary-fixture.mjs";
import { DEFAULT_ISSUER, DEFAULT_ORIGIN, TRIAL_READ_PATH } from "../src/constants.mjs";
import { bindVerifiedSession } from "../src/session-port.mjs";
import { jsonRequest, listen, rawRequest } from "./support.mjs";

const TARGET = `${DEFAULT_ORIGIN}${TRIAL_READ_PATH}`;
const PAGE = "https://example.com/lab-page";

function claims(overrides = {}) {
  return {
    clientId: "https://client.lab.example/agent",
    sid: "sid-guest",
    sub: "guest-lab",
    htm: "POST",
    htu: TARGET,
    aud: DEFAULT_ISSUER,
    ...overrides,
  };
}

function installFetch(t) {
  const previous = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  const previousTimeout = globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
  t.after(() => {
    globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = previous;
    globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = previousTimeout;
  });
  globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = 1000;
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input) => {
    const url = String(input);
    const bytes = new TextEncoder().encode("<html><head><title>Lab</title></head><body><p>hello lab</p></body></html>");
    let sent = false;
    return {
      status: 200,
      url,
      headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
      body: {
        getReader() {
          return {
            async read() {
              if (sent) return { done: true };
              sent = true;
              return { done: false, value: bytes };
            },
            async cancel() {},
          };
        },
      },
    };
  };
}

async function startedBudget(t) {
  const scratch = await mkdtemp(path.join(tmpdir(), "h64221-session-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const dir = path.join(scratch, "authority");
  await provisionExtractionTrial(dir, authority());
  let acquires = 0;
  const inner = createExtractionTrialBudget({ enabled: true, dir, now: () => NOW });
  return {
    async started() {
      return (await inner.status()).started ?? 0;
    },
    budget: {
      status: () => inner.status(),
      async acquire() {
        acquires += 1;
        return inner.acquire();
      },
    },
    acquires: () => acquires,
  };
}

test("the boundary fixture is labelled and is not a JWT verifier", async () => {
  const header = boundaryFixtureHeader(claims());
  assert.equal(header.startsWith("boundary-fixture:v1:"), true);
  assert.equal(header.split(".").length, 1);
  const accepted = await verifyBoundaryFixture({ header, issuer: DEFAULT_ISSUER });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.evidence, "boundary-fixture");
  assert.equal(accepted.session.signedIn, false);
  const jwt = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.signature";
  const rejected = await verifyBoundaryFixture({ header: jwt, issuer: DEFAULT_ISSUER });
  assert.deepEqual(rejected, { ok: false, error: "invalid_session" });
  const withToken = await verifyBoundaryFixture({
    header,
    authorization: "Bearer not-checked",
    issuer: DEFAULT_ISSUER,
  });
  assert.equal(withToken.ok, false);
  const jwtBound = await bindVerifiedSession({
    verifier: verifyBoundaryFixture,
    header: jwt,
    method: "POST",
    url: TARGET,
    issuer: DEFAULT_ISSUER,
    now: () => NOW,
  });
  assert.deepEqual(jwtBound, { ok: false, error: "invalid_session" });
  const mismatched = await bindVerifiedSession({
    verifier: verifyBoundaryFixture,
    header: boundaryFixtureHeader(claims({ htu: `${DEFAULT_ORIGIN}/other` })),
    method: "POST",
    url: TARGET,
    issuer: DEFAULT_ISSUER,
    now: () => NOW,
  });
  assert.deepEqual(mismatched, { ok: false, error: "invalid_session" });
  assert.throws(() => createPoppyReaderAdapter({ budget: { async status() {}, async acquire() {} } }), /injected session verifier/);
});

test("a session for another target does not run the reader", async (t) => {
  installFetch(t);
  const watched = await startedBudget(t);
  const adapter = createPoppyReaderAdapter({ verifier: verifyBoundaryFixture, budget: watched.budget, now: () => NOW });
  const server = await listen(adapter.app);
  t.after(() => server.close());
  const missing = await jsonRequest(server.base, TRIAL_READ_PATH, {
    method: "POST",
    raw: "{",
    headers: {},
  });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.json, { error: "invalid_session" });
  const other = await jsonRequest(server.base, TRIAL_READ_PATH, {
    method: "POST",
    body: { url: PAGE },
    headers: {
      "poppy-session": boundaryFixtureHeader(claims({ htu: "https://evil.example/poppy/v0/trial-read" })),
      host: "reader.lab.example",
    },
  });
  assert.deepEqual(other.json, { error: "invalid_session" });
  assert.equal(watched.acquires(), 0);
  assert.equal(await watched.started(), 0);

  const read = await rawRequest(server.base, TRIAL_READ_PATH, {
    method: "POST",
    body: { url: PAGE },
    headers: {
      "poppy-session": boundaryFixtureHeader(claims()),
      host: "evil.example",
      "x-forwarded-proto": "http",
    },
  });
  assert.equal(read.status, 200, read.text);
  assert.equal(read.json.ok, true);
  assert.equal(read.json.title, "Lab");
  assert.equal(read.json.markdown.includes("hello lab"), true);
  assert.equal(Object.hasOwn(read.json, "charged"), false);
  assert.equal(read.headers["payment-required"], undefined);
  assert.equal(await watched.started(), 1);
});
