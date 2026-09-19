import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluateFixture, evaluateRepoPins, loadPins, readJson } from "./evaluate.mjs";
import { inventedHits, projectPinBoundary, refusalPayload } from "./project.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const CHECK = join(HERE, "check.mjs");
const PROJECT = join(HERE, "project.mjs");
const OMITTED = join(HERE, "fixtures", "omitted-buyer-schema-digest.json");
const DRIFT = join(HERE, "fixtures", "seeded-pin-drift.json");
const INVENTED = join(HERE, "fixtures", "seeded-invented-field.json");
const ABSENCE = join(HERE, "fixtures", "seeded-treat-absence-as-demand.json");
const CLAIM = join(HERE, "fixtures", "seeded-claim-inspect-output-schema.json");

function run(command, args) {
  const env = { ...process.env, NO_COLOR: "1" };
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [command, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env,
  });
}

test("omitted buyer.schemaDigest fails closed with pin assertion", () => {
  const pins = loadPins();
  const fixture = readJson(OMITTED);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.buyer, "schemaDigest"), false);

  assert.throws(
    () => projectPinBoundary(fixture, pins),
    (error) => {
      assert.equal(error.reason, "buyer_schema_digest_omitted");
      assert.match(error.message, /inspectOutputSchema/);
      assert.equal(error.extra.sellerOfferReceiptPresent, true);
      assert.equal(error.extra.decisionChanged, "buyer.schemaDigest:omitted");
      return true;
    },
  );

  const pinResult = evaluateRepoPins();
  assert.equal(pinResult.ok, true, JSON.stringify(pinResult.failures, null, 2));

  const cli = run(PROJECT, ["tests/pin/policy-0.12.0/fixtures/omitted-buyer-schema-digest.json"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, false);
  assert.deepEqual(body.reasons, ["buyer_schema_digest_omitted"]);
  assert.equal(body.evidence, null);
  assert.equal(body.sellerOfferReceiptPresent, true);
  assert.equal(body.buyerSchemaDigest, null);
  assert.equal(body.decisionChanged, "buyer.schemaDigest:omitted");
  assert.equal(body.pin.expected, "0.12.0");
  assert.equal(body.pin.inspectOutputSchema, false);
  assert.equal(body.pin.buyerSchemaDigestRequires, "0.13.0");
  assert.equal(body.pinCheck.ok, true);
  assert.equal(body.pinCheck.code, "pins-match");
  assert.equal(body.boundary.paymentSent, false);
  assert.equal(body.boundary.walletAccessed, false);
  assert.equal(body.boundary.inspectOutputSchemaAvailable, false);
  assert.equal(body.boundary.productionPinBumped, false);
  assert.doesNotMatch(cli.stdout, /BEGIN PRIVATE KEY|PAYMENT-SIGNATURE/);
  console.log(JSON.stringify({
    lane: "omitted-buyer-schema-digest",
    exit: cli.status,
    reasons: body.reasons,
    pin: body.pin,
    pinCheck: body.pinCheck,
  }));
});

test("seeded pin drift to 0.15.1 is rejected", () => {
  const pins = loadPins();
  const fixture = readJson(DRIFT);
  const evaluated = evaluateFixture(fixture, pins);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "pin-drift");
  assert.equal(evaluated.label, "seeded-pin-drift-policy-0.15.1");
  const codes = evaluated.failures.map((failure) => `${failure.code}:${failure.name}`);
  assert.ok(codes.includes("version-drift:agent-payment-policy"));
  assert.ok(codes.includes("lock-version-drift:agent-payment-policy"));
  assert.ok(codes.includes("lock-integrity-drift:agent-payment-policy"));
  const drifted = evaluated.failures.find((failure) => failure.code === "version-drift");
  assert.equal(drifted.expected, "0.12.0");
  assert.equal(drifted.actual, "0.15.1");

  const cli = run(CHECK, ["tests/pin/policy-0.12.0/fixtures/seeded-pin-drift.json"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const quoted = JSON.parse(cli.stdout);
  assert.equal(quoted.ok, false);
  assert.equal(quoted.code, "pin-drift");
  console.log(JSON.stringify({
    lane: "seeded-pin-drift",
    exit: cli.status,
    failures: quoted.failures.map((failure) => failure.code),
  }));
});

test("seeded invented field and treat-absence-as-demand fail closed", () => {
  const invented = run(CHECK, ["--project", "tests/pin/policy-0.12.0/fixtures/seeded-invented-field.json"]);
  assert.equal(invented.status, 1, invented.stderr || invented.stdout);
  const inventedBody = JSON.parse(invented.stdout);
  assert.equal(inventedBody.ok, false);
  assert.equal(inventedBody.code, "invented_receipt_field_without_live_schema");
  assert.deepEqual(inventedBody.reasons, ["invented_receipt_field_without_live_schema"]);
  assert.deepEqual(inventedBody.invented, ["loyaltyPoints"]);
  assert.equal(inventedBody.evidence, null);
  console.log(JSON.stringify({
    lane: "seeded-invented-loyaltyPoints",
    exit: invented.status,
    reasons: inventedBody.reasons,
    invented: inventedBody.invented,
  }));

  const absence = run(CHECK, ["--project", "tests/pin/policy-0.12.0/fixtures/seeded-treat-absence-as-demand.json"]);
  assert.equal(absence.status, 1, absence.stderr || absence.stdout);
  const absenceBody = JSON.parse(absence.stdout);
  assert.equal(absenceBody.ok, false);
  assert.equal(absenceBody.code, "treat_absence_as_demand");
  assert.equal(absenceBody.evidence, null);
  assert.equal(absenceBody.decisionChanged, "buyer.schemaDigest:omitted;treat-absence-as-demand");
  console.log(JSON.stringify({
    lane: "seeded-treat-absence-as-demand",
    exit: absence.status,
    reasons: absenceBody.reasons,
  }));

  const claim = run(PROJECT, ["tests/pin/policy-0.12.0/fixtures/seeded-claim-inspect-output-schema.json"]);
  assert.equal(claim.status, 1, claim.stderr || claim.stdout);
  const claimBody = JSON.parse(claim.stdout);
  assert.equal(claimBody.accepted, false);
  assert.deepEqual(claimBody.reasons, ["inspect_output_schema_unavailable"]);
  assert.equal(claimBody.evidence, null);
});

test("empty pin-source, missing integrity, and nested lock drift fail closed", () => {
  const empty = run(CHECK, ["tests/pin/policy-0.12.0/fixtures/seeded-empty-pin-source.json"]);
  assert.equal(empty.status, 1, empty.stderr || empty.stdout);
  const emptyBody = JSON.parse(empty.stdout);
  assert.equal(emptyBody.ok, false);
  assert.equal(emptyBody.code, "pin-drift");
  assert.ok(emptyBody.failures.some((failure) => failure.code === "pin-source-empty"));

  const integrity = run(CHECK, ["tests/pin/policy-0.12.0/fixtures/seeded-lock-integrity-missing.json"]);
  assert.equal(integrity.status, 1, integrity.stderr || integrity.stdout);
  const integrityBody = JSON.parse(integrity.stdout);
  assert.equal(integrityBody.ok, false);
  assert.ok(integrityBody.failures.some((failure) => failure.code === "lock-integrity-missing"));
  assert.equal(integrityBody.failures.some((failure) => failure.code === "version-drift"), false);

  const nested = run(CHECK, ["tests/pin/policy-0.12.0/fixtures/seeded-nested-lock-drift.json"]);
  assert.equal(nested.status, 1, nested.stderr || nested.stdout);
  const nestedBody = JSON.parse(nested.stdout);
  assert.equal(nestedBody.ok, false);
  const nestedVersion = nestedBody.failures.find((failure) => failure.code === "lock-version-drift");
  assert.equal(nestedVersion.actual, "0.15.1");
  assert.match(nestedVersion.surface, /node_modules\/foo\/node_modules\/agent-payment-policy/);
});

test("caller-supplied digest is not inspectOutputSchema; notes are not invented fields", () => {
  const pins = loadPins();
  assert.deepEqual(inventedHits({ note: "must not invent loyaltyPoints", buyer: {} }, pins.forbiddenInvented), []);
  assert.deepEqual(inventedHits({ buyer: { loyaltyPoints: 1 } }, pins.forbiddenInvented), ["loyaltyPoints"]);
  assert.deepEqual(inventedHits({ axb: 1 }, ["a.b"]), []);

  const caller = run(PROJECT, ["tests/pin/policy-0.12.0/fixtures/seeded-caller-supplied-digest.json"]);
  assert.equal(caller.status, 1, caller.stderr || caller.stdout);
  const callerBody = JSON.parse(caller.stdout);
  assert.equal(callerBody.accepted, false);
  assert.deepEqual(callerBody.reasons, ["inspect_output_schema_unavailable"]);
  assert.equal(callerBody.evidence, null);
  assert.equal(callerBody.buyerSchemaDigest, "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");

  const note = run(PROJECT, ["tests/pin/policy-0.12.0/fixtures/seeded-note-mentions-loyaltyPoints.json"]);
  assert.equal(note.status, 1, note.stderr || note.stdout);
  const noteBody = JSON.parse(note.stdout);
  assert.equal(noteBody.accepted, false);
  assert.deepEqual(noteBody.reasons, ["buyer_schema_digest_omitted"]);
  assert.equal(noteBody.invented, undefined);
  assert.equal(noteBody.evidence, null);
});

test("cold pin check passes and refusal payload never mints evidence", () => {
  const pins = run(CHECK, []);
  assert.equal(pins.status, 0, pins.stderr || pins.stdout);
  const pinBody = JSON.parse(pins.stdout);
  assert.equal(pinBody.ok, true);
  assert.equal(pinBody.code, "pins-match");
  assert.equal(pinBody.version, "0.12.0");
  assert.equal(pinBody.pin.inspectOutputSchema, false);

  try {
    projectPinBoundary(readJson(OMITTED));
    assert.fail("expected fail-closed omitted digest");
  } catch (error) {
    const payload = refusalPayload(error);
    assert.equal(payload.accepted, false);
    assert.equal(payload.evidence, null);
    assert.equal(payload.boundary.ledgerCreated, false);
    assert.equal(payload.boundary.paidCapture, false);
    assert.equal(payload.boundary.productionPinBumped, false);
  }
});
