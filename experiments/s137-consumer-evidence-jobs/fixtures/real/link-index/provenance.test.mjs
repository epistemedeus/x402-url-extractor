import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const provenance = JSON.parse(readFileSync(join(dir, "PROVENANCE.json"), "utf8"));
const snapshotBytes = readFileSync(join(dir, "x402-foundation-x402-README.md"));
const headerBytes = readFileSync(join(dir, "x402-foundation-x402-README.headers.txt"));
const snapshotText = snapshotBytes.toString("utf8");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function extractInline(markdown) {
  const out = [];
  const used = [];
  const wrapped = /\[!\[([^\]]*)\]\(([^)\s]+)\)\]\(([^)\s]+)\)/g;
  for (const m of markdown.matchAll(wrapped)) {
    out.push({
      kind: "image",
      text: m[1],
      href: m[2],
      index: m.index + 1,
      nestedIn: m[3],
    });
    out.push({
      kind: "link",
      text: `![${m[1]}](${m[2]})`,
      href: m[3],
      index: m.index,
      containsImage: true,
    });
    used.push([m.index, m.index + m[0].length]);
  }
  const simple = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;
  for (const m of markdown.matchAll(simple)) {
    const start = m.index;
    const end = start + m[0].length;
    if (used.some(([a, b]) => start >= a && end <= b)) continue;
    out.push({
      kind: m[1] === "!" ? "image" : "link",
      text: m[2],
      href: m[3],
      index: start,
    });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

test("PROVENANCE has required retrieval fields", () => {
  assert.equal(provenance.retrievedAt, "2026-09-10T11:23:12Z");
  assert.match(provenance.url, /^https:\/\/raw\.githubusercontent\.com\//);
  assert.equal(typeof provenance.sha256, "string");
  assert.equal(provenance.sha256.length, 64);
  assert.equal(provenance.license.spdx, "Apache-2.0");
  assert.ok(provenance.license.note.includes("Apache"));
  assert.equal(provenance.evidenceClass, "fixture");
  assert.equal(provenance.offline, true);
  assert.equal(provenance.payment.attempted, false);
});

test("snapshot sha256 and byte length match PROVENANCE", () => {
  assert.equal(snapshotBytes.length, provenance.bytes);
  assert.equal(sha256(snapshotBytes), provenance.sha256);
  assert.equal(sha256(snapshotBytes), "edc83ee946abfa11f069077737e12f07cc3119c6d9ec5e01e3417f72be014a86");
});

test("stored headers match PROVENANCE and Content-Length", () => {
  assert.equal(headerBytes.length, provenance.headersBytes);
  assert.equal(sha256(headerBytes), provenance.headersSha256);
  const headers = headerBytes.toString("latin1");
  assert.match(headers, /content-length: 9517/i);
  assert.match(headers, /content-type: text\/plain; charset=utf-8/i);
  assert.match(headers, /date: Thu, 10 Sep 2026 11:23:12 GMT/i);
});

test("citations list includes snapshot hash and license hash", () => {
  const byId = Object.fromEntries(provenance.citations.map((c) => [c.id, c]));
  assert.equal(byId["src-readme"].sha256, provenance.sha256);
  assert.equal(byId["src-readme"].url, provenance.url);
  assert.equal(byId["src-license"].sha256, provenance.license.licenseSha256);
  assert.equal(byId["src-notice"].sha256, provenance.license.noticeSha256);
  for (const finding of provenance.observedCases) {
    assert.ok(finding.citationIds.length > 0);
    for (const id of finding.citationIds) {
      assert.ok(byId[id], `missing citation ${id}`);
    }
  }
});

test("positive: absolute https markdown hrefs are present", () => {
  const records = extractInline(snapshotText);
  const abs = records.filter((r) => r.kind === "link" && /^https?:\/\//.test(r.href));
  assert.ok(abs.length >= 1);
  assert.ok(
    abs.some((r) => r.href === "https://github.com/x402-foundation/x402/blob/main/CONTRIBUTING.md"),
  );
  assert.equal(abs.length, 13);
  assert.equal(provenance.coverage.absoluteHttpOrHttpsLinkHrefs, 13);
});

test("negative: specs/ code span and go module path are not markdown hrefs", () => {
  const records = extractInline(snapshotText);
  const hrefs = records.map((r) => r.href);
  assert.ok(snapshotText.includes("See `specs/` for full documentation of the x402 standard/"));
  assert.equal(hrefs.includes("specs/"), false);
  assert.equal(hrefs.includes("`specs/`"), false);
  assert.ok(snapshotText.includes("go get github.com/x402-foundation/x402/go/v2"));
  assert.equal(
    hrefs.some((h) => h.includes("github.com/x402-foundation/x402/go/v2")),
    false,
  );
});

test("partial: relative ./ hrefs exist and were not retrieved", () => {
  const records = extractInline(snapshotText);
  const relLinks = records.filter((r) => r.kind === "link" && r.href.startsWith("./"));
  const relImages = records.filter((r) => r.kind === "image" && r.href.startsWith("./"));
  assert.equal(relLinks.length, 6);
  assert.equal(relImages.length, 1);
  assert.ok(relLinks.some((r) => r.href === "./typescript/"));
  assert.equal(relImages[0].href, "./static/flow.png");
  assert.ok(provenance.captureMethod.includes("Relative targets were not fetched"));
});

test("conflicting: duplicate slack href and floating main vs pin", () => {
  const records = extractInline(snapshotText);
  const slack = records.filter((r) => r.kind === "link" && r.href === "http://slack.x402.org/");
  assert.equal(slack.length, 2);
  assert.notEqual(slack[0].text, slack[1].text);
  assert.ok(snapshotText.includes("/blob/main/CONTRIBUTING.md"));
  assert.ok(snapshotText.includes("/blob/main/ROADMAP.md"));
  assert.equal(provenance.pin.ref, "3c2ddfb922893c91ef8f281b64f8045d1f5e0d75");
  assert.notEqual(provenance.pin.ref, "main");
  const kinds = new Set(provenance.observedCases.map((c) => c.kind));
  assert.deepEqual([...kinds].sort(), ["conflicting", "negative", "partial", "positive"]);
});

test("extractor counts match PROVENANCE coverage", () => {
  const records = extractInline(snapshotText);
  const links = records.filter((r) => r.kind === "link");
  const images = records.filter((r) => r.kind === "image");
  assert.equal(links.length, provenance.coverage.markdownLinkRecords);
  assert.equal(images.length, provenance.coverage.markdownImageRecords);
  assert.equal(records.length, 21);
});
