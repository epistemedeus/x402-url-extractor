import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "./hash.mjs";

export const FIXTURE_ROOT = dirname(fileURLToPath(import.meta.url));
export const LANES = Object.freeze(["announced", "shipped", "tested"]);
export const JOB_ID = "R2-CONSUMER-JOBS-02";
export const ARTIFACT_KIND = "release-brief";
export const CASE_SCHEMA = "s137.release-brief.synthetic-case.v1";

export function clock() {
  return readFileSync(join(FIXTURE_ROOT, "CLOCK.txt"), "utf8").trim();
}

export function loadManifest() {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, "MANIFEST.json"), "utf8"));
}

export function loadCase(id) {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, "cases", `${id}.json`), "utf8"));
}

export function loadProvenance() {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, "PROVENANCE.json"), "utf8"));
}

export function loadSourcePins() {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, "SOURCE-PINS.json"), "utf8"));
}

export function absFromRel(relPath) {
  return join(FIXTURE_ROOT, relPath);
}

export function loadSource(relPath) {
  const abs = absFromRel(relPath);
  return {
    abs,
    relPath,
    sha256: sha256File(abs),
    doc: JSON.parse(readFileSync(abs, "utf8")),
  };
}

function laneFields(doc) {
  return {
    tag_name: doc.tag_name ?? null,
    draft: Object.prototype.hasOwnProperty.call(doc, "draft") ? doc.draft : null,
    prerelease: Object.prototype.hasOwnProperty.call(doc, "prerelease") ? doc.prerelease : null,
    published_at: Object.prototype.hasOwnProperty.call(doc, "published_at") ? doc.published_at : null,
    target_commitish: doc.target_commitish ?? null,
    objectSha: doc.object?.sha ?? null,
    head_sha: doc.head_sha ?? null,
    conclusion: doc.conclusion ?? null,
    status: doc.status ?? null,
    body: doc.body ?? null,
    lane: Object.prototype.hasOwnProperty.call(doc, "lane") ? doc.lane : undefined,
    evidenceClass: doc.evidenceClass ?? null,
  };
}

export function observeCase(spec) {
  const lanes = {};
  for (const lane of LANES) {
    const rel = spec.lanes?.[lane];
    if (!rel) {
      lanes[lane] = { present: false };
      continue;
    }
    const abs = absFromRel(rel);
    if (!existsSync(abs)) {
      lanes[lane] = { present: false, missingFile: rel };
      continue;
    }
    const loaded = loadSource(rel);
    lanes[lane] = { present: true, sha256: loaded.sha256, path: rel, ...laneFields(loaded.doc) };
  }
  const announcedSha = lanes.announced.target_commitish;
  const shippedSha = lanes.shipped.objectSha;
  const testedSha = lanes.tested.head_sha;
  const disagreements = [];
  if (lanes.announced.present && lanes.shipped.present && lanes.announced.tag_name !== lanes.shipped.tag_name) {
    disagreements.push({
      code: "tag_mismatch",
      announced: lanes.announced.tag_name,
      shipped: lanes.shipped.tag_name,
    });
  }
  if (
    lanes.announced.present &&
    lanes.shipped.present &&
    announcedSha &&
    shippedSha &&
    announcedSha !== shippedSha
  ) {
    disagreements.push({
      code: "sha_mismatch",
      announced: announcedSha,
      shipped: shippedSha,
    });
  }
  if (
    lanes.shipped.present &&
    lanes.tested.present &&
    shippedSha &&
    testedSha &&
    shippedSha !== testedSha
  ) {
    disagreements.push({
      code: "tested_sha_mismatch",
      shipped: shippedSha,
      tested: testedSha,
    });
  }
  if (
    lanes.announced.present &&
    lanes.tested.present &&
    /all tests passed/i.test(lanes.announced.body || "") &&
    lanes.tested.conclusion &&
    lanes.tested.conclusion !== "success"
  ) {
    disagreements.push({
      code: "ci_vs_announce",
      announcedClaim: "All tests passed",
      conclusion: lanes.tested.conclusion,
    });
  }
  if (lanes.announced.present && lanes.announced.draft === true) {
    disagreements.push({
      code: "unpublished_draft",
      draft: true,
      published_at: lanes.announced.published_at,
    });
  }
  return {
    lanes,
    disagreements,
    presentCount: LANES.filter((lane) => lanes[lane].present).length,
  };
}
