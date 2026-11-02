import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

import {
  CALLER_CLAIMABLE_REASON,
  PLATFORM_HEALTH_CARDS,
  PLATFORM_HEALTH_SCHEMA,
  VERIFIED_CHAIN_TIME_REASON,
  buildPlatformHealthResponse,
  classifyPlatformHealthFreshness,
  freshnessFor,
  getPlatformHealthCard,
  listPlatformHealthCards,
  projectPlatformHealthCard,
  validatePlatformHealthCard,
} from "./platform-health.mjs";
import { renderPlatformCard, renderPlatformIndex } from "./platform-health-page.mjs";

test("launch set contains the five rights-approved platforms", () => {
  assert.deepEqual(
    PLATFORM_HEALTH_CARDS.map((card) => card.platform_id),
    ["gofrantic", "taskmarket", "bountybook", "superteam", "moltjobs"]
  );
});

test("every card passes the v0 evidence contract", () => {
  for (const card of PLATFORM_HEALTH_CARDS) {
    assert.deepEqual(validatePlatformHealthCard(card), {
      ok: true,
      missing: [],
      forbiddenScore: false,
    });
    assert.equal(card.disclaimer_ref, "samedaydesk-radar-disclaimer.v0");
    assert.ok(card.unknowns.length > 0);
    assert.ok(card.evidence.every((entry) => entry.source_url.startsWith("https://")));
  }
});

test("public schema forbids unspecified fields and has no numerical reliability score", () => {
  assert.equal(PLATFORM_HEALTH_SCHEMA.additionalProperties, false);
  assert.equal("score" in PLATFORM_HEALTH_SCHEMA.properties, false);
  assert.equal("reliability_score" in PLATFORM_HEALTH_SCHEMA.properties, false);
});

test("freshness expires honestly", () => {
  const card = PLATFORM_HEALTH_CARDS[0];
  assert.equal(freshnessFor(card, new Date("2026-08-09T17:41:59.000Z")), "fresh");
  assert.equal(freshnessFor(card, new Date("2026-08-09T17:42:01.000Z")), "stale");
});

test("lookup and machine response preserve evidence", () => {
  assert.equal(getPlatformHealthCard("bountybook", new Date("2026-08-08T18:00:00Z")).health_category, "VERIFIER_BLOCK");
  assert.equal(getPlatformHealthCard("missing"), null);
  const response = buildPlatformHealthResponse(new Date("2026-08-08T18:00:00Z"));
  assert.equal(response.cards.length, 5);
  assert.equal(response.cards.every((card) => card.freshness === "fresh"), true);
  assert.match(response.disclaimer.short, /not calibrated predictions/i);
  assert.equal(response.disclaimer.long.length, 9);
});

const FRESH_CLOCK = new Date("2026-08-08T18:00:00.000Z");
const EXACT_EXPIRY = new Date("2026-08-09T17:42:00.000Z");
const STALE_CLOCK = new Date("2026-08-10T00:00:00.000Z");
const CHECKPOINT = new Date("2026-11-02T07:10:00.000Z");
const HISTORICAL_COUNTS = Object.freeze([0, 18, 100, null, 3]);
const cwd = path.dirname(fileURLToPath(import.meta.url));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compileCardSchema() {
  const schema = structuredClone(PLATFORM_HEALTH_SCHEMA);
  delete schema.$schema;
  return new Ajv({ allErrors: true, strict: false }).compile(schema);
}

function synthetic(overrides = {}) {
  const state = {
    open_inventory_count: 4,
    competition_signal: "synthetic density",
    custody_status: null,
    notes: "Advertised OPEN is not caller claimability.",
  };
  return {
    schema_version: "platform-health-card.v0",
    card_id: "synthetic:clock",
    platform_id: "synthetic-lane",
    platform_name: "Synthetic Lane",
    primary_url: "https://example.invalid/synthetic",
    health_category: "INSUFFICIENT_EVIDENCE",
    secondary_tags: ["synthetic"],
    settlement_mechanism: ["UNFUNDED_OR_UNKNOWN"],
    confidence: "low",
    sample_count: 1,
    window_start: "2026-01-01T00:00:00.000Z",
    window_end: "2026-01-02T00:00:00.000Z",
    observed_at: "2026-01-02T00:00:00.000Z",
    fresh_until: "2026-01-03T00:00:00.000Z",
    current_platform_state: state,
    rights_class: "PUBLIC_READ",
    evidence: [{
      evidence_id: "synthetic-payment-time",
      fact_class: "PUBLIC_API",
      summary: "Provider payment time is not verified chain time.",
      observed_at: "2026-01-02T00:00:00.000Z",
      source_url: "https://example.invalid/evidence",
      source_type: "public_api",
      stage_reached: "discoverable",
      failed_at: null,
      external_id: null,
      confidence: "low",
    }],
    unknowns: ["current claimability"],
    correction_of: null,
    disclaimer_ref: "samedaydesk-radar-disclaimer.v0",
    ...overrides,
    current_platform_state: { ...state, ...overrides.current_platform_state },
  };
}

function withoutProjection(card) {
  const copy = structuredClone(card);
  delete copy.freshness;
  delete copy.current_availability;
  return copy;
}

test("projection qualifies every card without rewriting dated observations", () => {
  const fresh = listPlatformHealthCards(FRESH_CLOCK);
  const exact = listPlatformHealthCards(EXACT_EXPIRY);
  const stale = listPlatformHealthCards(STALE_CLOCK);
  const checkpoint = listPlatformHealthCards(CHECKPOINT);
  assert.deepEqual(fresh.map((card) => card.freshness), ["fresh", "fresh", "fresh", "fresh", "fresh"]);
  assert.deepEqual(exact.map((card) => card.current_availability.time_reason), Array(5).fill("exact_expiry"));
  assert.deepEqual(stale.map((card) => card.freshness), Array(5).fill("stale"));
  assert.deepEqual(checkpoint.map((card) => card.current_platform_state.open_inventory_count), HISTORICAL_COUNTS);
  assert.deepEqual(checkpoint.map((card) => card.current_availability.open_inventory_count), [null, null, null, null, null]);
  assert.deepEqual(fresh.map((card) => card.current_availability.open_inventory_count), HISTORICAL_COUNTS);
  assert.deepEqual(fresh.map((card) => card.current_availability.open_inventory_reason), ["observed", "observed", "observed", "unknown", "observed"]);
  for (const card of checkpoint) {
    assert.equal(card.current_availability.open_inventory_reason, "not_current");
    assert.equal(card.current_availability.caller_claimable, null);
    assert.equal(card.current_availability.verified_chain_time, null);
    assert.equal(card.current_availability.caller_claimable_reason, CALLER_CLAIMABLE_REASON);
    assert.equal(card.current_availability.verified_chain_time_reason, VERIFIED_CHAIN_TIME_REASON);
    const stored = PLATFORM_HEALTH_CARDS.find((item) => item.platform_id === card.platform_id);
    assert.deepEqual(withoutProjection(card), stored);
  }
});

test("fresh zero stays zero and a fresh unknown stays null", () => {
  const zero = getPlatformHealthCard("gofrantic", FRESH_CLOCK);
  assert.equal(zero.current_platform_state.open_inventory_count, 0);
  assert.equal(zero.current_availability.open_inventory_count, 0);
  assert.equal(zero.current_availability.open_inventory_reason, "observed");
  const unknown = getPlatformHealthCard("superteam", FRESH_CLOCK);
  assert.equal(unknown.current_platform_state.open_inventory_count, null);
  assert.equal(unknown.current_availability.open_inventory_count, null);
  assert.equal(unknown.current_availability.open_inventory_reason, "unknown");
  const staleZero = getPlatformHealthCard("gofrantic", CHECKPOINT);
  assert.equal(staleZero.current_platform_state.open_inventory_count, 0);
  assert.equal(staleZero.current_availability.open_inventory_count, null);
  assert.equal(staleZero.current_availability.open_inventory_reason, "not_current");
});

test("open advertising and provider payment time do not become current claims", () => {
  const jobs = getPlatformHealthCard("moltjobs", FRESH_CLOCK);
  assert.match(jobs.current_platform_state.notes, /OPEN/);
  assert.equal(jobs.current_availability.open_inventory_count, 3);
  assert.equal(jobs.current_availability.caller_claimable, null);
  const paid = getPlatformHealthCard("gofrantic", FRESH_CLOCK);
  assert.equal(paid.evidence[0].fact_class, "ON_CHAIN");
  assert.equal(paid.evidence[0].observed_at, "2026-06-25T00:31:37.000Z");
  assert.equal(paid.current_availability.verified_chain_time, null);
  const stalePaid = getPlatformHealthCard("gofrantic", CHECKPOINT);
  assert.equal(stalePaid.evidence[0].observed_at, "2026-06-25T00:31:37.000Z");
  assert.equal(stalePaid.current_availability.verified_chain_time, null);
});

test("synthetic clocks cover boundaries, defects, recovery, and identical availability", () => {
  const inside = new Date("2026-01-02T12:00:00.000Z");
  const base = synthetic();
  const alpha = projectPlatformHealthCard(synthetic({ platform_id: "alpha-synthetic", platform_name: "Alpha" }), inside);
  const beta = projectPlatformHealthCard(synthetic({ platform_id: "beta-synthetic", platform_name: "Beta" }), inside);
  assert.deepEqual(alpha.current_availability, beta.current_availability);
  assert.equal(alpha.freshness, "fresh");
  assert.equal(alpha.current_availability.time_reason, "within_window");
  assert.equal(alpha.current_availability.open_inventory_count, 4);

  const until = "2026-01-03T00:00:00.000Z";
  assert.deepEqual(classifyPlatformHealthFreshness(base, new Date(until)), { freshness: "fresh", reason: "exact_expiry" });
  assert.equal(projectPlatformHealthCard(base, new Date(until)).current_availability.open_inventory_count, 4);
  const justAfter = new Date(Date.parse(until) + 1);
  assert.deepEqual(classifyPlatformHealthFreshness(base, justAfter), { freshness: "stale", reason: "window_elapsed" });
  assert.equal(projectPlatformHealthCard(base, justAfter).current_availability.open_inventory_count, null);

  const future = projectPlatformHealthCard(base, new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(future.freshness, "not_current");
  assert.equal(future.current_availability.time_reason, "observation_in_future");
  assert.equal(future.current_availability.open_inventory_count, null);
  assert.equal(future.current_platform_state.open_inventory_count, 4);

  const reversed = projectPlatformHealthCard(synthetic({
    observed_at: "2026-05-02T00:00:00.000Z",
    fresh_until: "2026-05-01T00:00:00.000Z",
  }), new Date("2026-04-01T00:00:00.000Z"));
  assert.equal(reversed.current_availability.time_reason, "window_reversed");
  assert.equal(reversed.current_availability.open_inventory_count, null);

  const reversedWindow = projectPlatformHealthCard(synthetic({
    window_start: "2026-02-02T00:00:00.000Z",
    window_end: "2026-02-01T00:00:00.000Z",
  }), inside);
  assert.equal(reversedWindow.current_availability.time_reason, "window_reversed");

  const missingObserved = synthetic();
  delete missingObserved.observed_at;
  assert.equal(classifyPlatformHealthFreshness(missingObserved, inside).reason, "observation_missing");
  const missingFreshUntil = synthetic();
  delete missingFreshUntil.fresh_until;
  assert.equal(classifyPlatformHealthFreshness(missingFreshUntil, inside).reason, "fresh_until_missing");
  assert.equal(classifyPlatformHealthFreshness(synthetic({ observed_at: "not-a-time" }), inside).reason, "observation_invalid");
  assert.equal(classifyPlatformHealthFreshness(synthetic({ fresh_until: "2026-13-40T00:00:00.000Z" }), inside).reason, "fresh_until_invalid");
  assert.equal(classifyPlatformHealthFreshness(synthetic({ window_end: "yesterday" }), inside).reason, "observation_invalid");
  assert.equal(classifyPlatformHealthFreshness(synthetic({ observed_at: "" }), inside).reason, "observation_missing");

  const unknownInventory = projectPlatformHealthCard(synthetic({
    current_platform_state: { open_inventory_count: null },
  }), inside);
  assert.equal(unknownInventory.current_availability.open_inventory_count, null);
  assert.equal(unknownInventory.current_availability.open_inventory_reason, "unknown");
  const malformedInventory = projectPlatformHealthCard(synthetic({
    current_platform_state: { open_inventory_count: "100" },
  }), inside);
  assert.equal(malformedInventory.current_availability.open_inventory_count, null);
  assert.equal(malformedInventory.current_availability.open_inventory_reason, "unknown");

  const outside = new Date("2026-02-01T00:00:00.000Z");
  assert.equal(projectPlatformHealthCard(base, outside).current_availability.open_inventory_count, null);
  assert.equal(projectPlatformHealthCard(base, inside).current_availability.open_inventory_count, 4);
  assert.equal(projectPlatformHealthCard(base, outside).current_platform_state.notes, base.current_platform_state.notes);

  assert.throws(() => freshnessFor(base, "not-a-clock"), /now must be a valid date/);
  assert.throws(() => listPlatformHealthCards(new Date(Number.NaN)), /now must be a valid date/);
  assert.throws(() => buildPlatformHealthResponse("nope"), /now must be a valid date/);
  assert.throws(() => projectPlatformHealthCard(null, inside), /card must be an object/);
});

test("returned cards do not mutate stored observations or later reads", () => {
  const canonical = JSON.stringify(PLATFORM_HEALTH_CARDS);
  const notes = PLATFORM_HEALTH_CARDS.find((card) => card.platform_id === "bountybook").current_platform_state.notes;
  const first = getPlatformHealthCard("bountybook", CHECKPOINT);
  first.current_platform_state.notes += " EXTRA";
  first.current_platform_state.open_inventory_count = 0;
  first.evidence[0].summary += " EXTRA";
  first.secondary_tags.push("primary_host_nxdomain");
  first.unknowns.push("leaked");
  first.current_availability.open_inventory_count = 100;
  first.current_availability.caller_claimable = true;
  const second = getPlatformHealthCard("bountybook", CHECKPOINT);
  const listed = listPlatformHealthCards(CHECKPOINT).find((card) => card.platform_id === "bountybook");
  assert.equal(second.current_platform_state.notes, notes);
  assert.equal(second.current_platform_state.open_inventory_count, 100);
  assert.equal(second.current_availability.open_inventory_count, null);
  assert.equal(second.secondary_tags.includes("primary_host_nxdomain"), false);
  assert.deepEqual(second.current_platform_state, listed.current_platform_state);
  assert.notEqual(second.current_platform_state, listed.current_platform_state);
  assert.equal(JSON.stringify(PLATFORM_HEALTH_CARDS), canonical);
  assert.deepEqual(listPlatformHealthCards(CHECKPOINT), listPlatformHealthCards(CHECKPOINT));
});

test("projection logic has no platform, incident, or census special case", () => {
  const source = readFileSync(new URL("./platform-health.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function evaluationInstant");
  const end = source.indexOf("export function buildPlatformHealthResponse");
  const projection = source.slice(start, end);
  assert.equal(start > 0 && end > start, true);
  assert.doesNotMatch(projection, /bountybook|gofrantic|taskmarket|superteam|moltjobs|nxdomain|2026-11-02/i);
});

test("published schema accepts stored seeds and emitted cards, including null availability", () => {
  const validate = compileCardSchema();
  for (const card of PLATFORM_HEALTH_CARDS) {
    assert.equal(card.freshness, undefined);
    assert.equal(card.current_availability, undefined);
    assert.equal(validate(card), true, JSON.stringify(validate.errors));
  }
  const response = buildPlatformHealthResponse(CHECKPOINT);
  assert.equal(response.generated_at, CHECKPOINT.toISOString());
  assert.equal(response.cards.length, 5);
  for (const card of response.cards) {
    assert.equal(validate(structuredClone(card)), true, JSON.stringify(validate.errors));
    assert.equal(validatePlatformHealthCard(card).ok, true);
  }
  const tampered = structuredClone(response.cards[0]);
  tampered.current_availability.caller_claimable = true;
  assert.equal(validate(tampered), false);
  assert.equal(validatePlatformHealthCard(tampered).ok, false);
  const coerced = structuredClone(response.cards[0]);
  coerced.current_availability.open_inventory_count = 0;
  assert.equal(validatePlatformHealthCard(coerced).ok, false);
  const freshUnknown = getPlatformHealthCard("superteam", FRESH_CLOCK);
  assert.equal(validate(structuredClone(freshUnknown)), true, JSON.stringify(validate.errors));
  assert.equal(PLATFORM_HEALTH_SCHEMA.properties.current_availability.properties.open_inventory_count.type.includes("null"), true);
  assert.equal(PLATFORM_HEALTH_SCHEMA.properties.freshness.enum.includes("not_current"), true);
});

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

test("loopback server returns qualified cards, schema, preflight, and unchanged human pages", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-card-freshness-"));
  const port = await unusedPort();
  const internalToken = "h108010-local-gateway-token-0123456789";
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      COMMERCE_INTERNAL_TOKEN: internalToken,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 30_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`) || !output.includes("MCP server:  POST /mcp")) return;
      clearTimeout(timer);
      resolve(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  });
  assert.equal(await listening, true);
  const base = `http://127.0.0.1:${port}`;
  const humanAssets = JSON.parse(readFileSync(new URL("./fixtures/platform-health/human-asset-sha256.json", import.meta.url), "utf8"));
  const validate = compileCardSchema();

  const cardsResponse = await fetch(`${base}/v0/cards.json`);
  const cardsRaw = await cardsResponse.text();
  const cardsBody = JSON.parse(cardsRaw);
  const cardsAgain = await (await fetch(`${base}/v0/cards.json`)).json();
  assert.equal(cardsResponse.status, 200);
  assert.equal(cardsResponse.headers.get("cache-control"), "public, max-age=300, stale-while-revalidate=900");
  assert.equal(cardsBody.schema_version, "platform-health-index.v0");
  assert.equal(Number.isNaN(Date.parse(cardsBody.generated_at)), false);
  assert.deepEqual(cardsBody.cards.map((card) => card.platform_id), PLATFORM_HEALTH_CARDS.map((card) => card.platform_id));
  assert.deepEqual(cardsBody.cards.map((card) => card.current_platform_state.open_inventory_count), HISTORICAL_COUNTS);
  assert.deepEqual(cardsBody.cards.map((card) => card.current_availability.open_inventory_count), [null, null, null, null, null]);
  assert.equal(cardsBody.cards.every((card) => card.freshness === "stale" && validate(structuredClone(card))), true);
  assert.deepEqual(cardsAgain.cards, cardsBody.cards);

  const schemaResponse = await fetch(`${base}/schemas/platform-health-card-v0.json`);
  assert.equal(schemaResponse.status, 200);
  assert.equal(schemaResponse.headers.get("cache-control"), "public, max-age=300, stale-while-revalidate=900");
  assert.deepEqual(await schemaResponse.json(), PLATFORM_HEALTH_SCHEMA);

  const indexResponse = await fetch(`${base}/platforms`);
  const indexHtml = await indexResponse.text();
  assert.equal(indexResponse.status, 200);
  assert.equal(indexResponse.headers.get("content-type")?.includes("text/html"), true);
  assert.equal(sha256(indexHtml), humanAssets.clocks[CHECKPOINT.toISOString()].index);
  assert.equal(sha256(await (await fetch(`${base}/radar`)).text()), humanAssets.clocks[CHECKPOINT.toISOString()].index);
  for (const card of PLATFORM_HEALTH_CARDS) {
    const detail = await fetch(`${base}/platforms/${card.platform_id}`);
    assert.equal(detail.status, 200);
    assert.equal(sha256(await detail.text()), humanAssets.clocks[CHECKPOINT.toISOString()].details[card.platform_id]);
  }
  assert.equal(sha256(await (await fetch(`${base}/platforms/methodology`)).text()), humanAssets.methodology);
  assert.equal(sha256(await (await fetch(`${base}/alerts`)).text()), humanAssets.alerts);
  assert.equal(sha256(await (await fetch(`${base}/robots.txt`)).text()), humanAssets.robots);
  assert.equal(sha256(await (await fetch(`${base}/sitemap.xml`)).text()), humanAssets.sitemap);
  const homepage = await fetch(`${base}/`, { headers: { accept: "text/html" } });
  const homepageHtml = await homepage.text();
  const homepageAgain = await (await fetch(`${base}/`, { headers: { accept: "text/html" } })).text();
  assert.equal(homepage.status, 200);
  assert.equal(homepageHtml, homepageAgain);
  assert.match(homepageHtml, /SameDayDesk Agent Payment Gateway/);
  assert.equal(homepageHtml.includes("current_availability"), false);
  assert.equal(homepageHtml.includes("open_inventory_count"), false);

  const trial = await fetch(`${base}/work/opportunity-preflight?trial=1`);
  const trialBody = await trial.json();
  assert.equal(trial.status, 200);
  assert.equal(trialBody.sample, true);
  assert.equal(trialBody.charged, false);
  assert.equal(trialBody.platformEvidence, null);
  assert.equal(trialBody.decision, "attempt");

  const unpaidUrl = `${base}/work/opportunity-preflight?platform=bountybook&rewardUsd=10&hours=0.25&hourlyCostUsd=4&selectionProbabilityPct=80`;
  const unpaid = await fetch(unpaidUrl);
  assert.equal(unpaid.status, 402);
  const unpaidText = await unpaid.text();
  assert.equal(unpaidText.includes("\"decision\":\"attempt\""), false);

  const malformed = await fetch(`${base}/work/opportunity-preflight?rewardUsd=nan&hours=1&hourlyCostUsd=1`);
  const malformedBody = await malformed.json();
  assert.equal(malformed.status, 400);
  assert.equal(malformedBody.charged, false);
  assert.match(malformedBody.error, /rewardUsd/);

  const authorized = await fetch(`${unpaidUrl}&agentAccess=agent_allowed&acceptance=deterministic&settlement=escrow`, {
    headers: { "x-samedaydesk-internal": internalToken },
  });
  const authorizedBody = await authorized.json();
  assert.equal(authorized.status, 200);
  assert.equal(authorized.headers.get("cache-control"), "no-store");
  assert.equal(authorizedBody.decision, "verify_first");
  assert.equal(authorizedBody.platformEvidence.platformId, "bountybook");
  assert.equal(authorizedBody.platformEvidence.freshness, "stale");
  assert.equal(authorizedBody.platformEvidence.healthCategory, "VERIFIER_BLOCK");
  assert.equal(authorizedBody.platformEvidence.observedAt, "2026-08-08T17:42:00.000Z");
  assert.equal(authorizedBody.gates.requiredChecks.includes("refresh_platform_health_evidence"), true);
  assert.equal(authorizedBody.delivery.upstreamAuthenticated, true);
  assert.equal(authorizedBody.input.rewardUsd, 10);

  const mcp = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }),
  });
  const mcpText = await mcp.text();
  const mcpBody = mcp.headers.get("content-type")?.includes("text/event-stream")
    ? JSON.parse(mcpText.split("\n").find((line) => line.startsWith("data: ")).slice(6))
    : JSON.parse(mcpText);
  const tool = mcpBody.result.tools.find((entry) => entry.name === "opportunity_preflight");
  assert.equal(tool.outputSchema.type, "object");
  assert.equal(tool.outputSchema.additionalProperties, false);
  const evidenceSchema = tool.outputSchema.properties.platformEvidence;
  const evidenceObject = evidenceSchema.properties
    ? evidenceSchema
    : (evidenceSchema.anyOf || evidenceSchema.oneOf).find((entry) => entry.type === "object");
  assert.equal(evidenceObject.additionalProperties, false);
  assert.equal(evidenceObject.properties.freshness.type, "string");
  assert.equal(evidenceObject.required.includes("freshness"), true);
  assert.equal(tool.outputSchema.properties.gates.properties.requiredChecks.type, "array");

  await writeFile("/tmp/h108010-cards-readback.json", JSON.stringify({
    command: "node server.js",
    bind: "127.0.0.1",
    port,
    publicUrl: "https://agents.samedaydesk.com",
    clock: cardsBody.generated_at,
    checkpoint: CHECKPOINT.toISOString(),
    cacheControl: cardsResponse.headers.get("cache-control"),
    contentType: cardsResponse.headers.get("content-type"),
    status: cardsResponse.status,
    sha256: sha256(cardsRaw),
    body: cardsBody,
    nonsecretConfiguration: {
      PORT: String(port),
      PUBLIC_URL: "https://agents.samedaydesk.com",
      MPP_SECRET_KEY: "",
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      COMMERCE_INTERNAL_TOKEN: "set-local-test-token-not-recorded",
      FACILITATOR: process.env.FACILITATOR || "xpay",
    },
  }));
});
