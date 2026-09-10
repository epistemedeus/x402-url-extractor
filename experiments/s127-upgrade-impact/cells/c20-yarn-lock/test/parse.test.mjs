import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { detectYarnLockFormat, parseYarnLock } from "../parse.mjs";

const cellRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (...parts) => join(cellRoot, "fixtures", ...parts);
const read = (...parts) => readFileSync(fixture(...parts), "utf8");

test("detect: classic v1 header", () => {
  const d = detectYarnLockFormat(read("classic-simple", "yarn.lock"));
  assert.equal(d.format, "classic-v1");
  assert.equal(d.classicHeader, true);
  assert.equal(d.berry, false);
});

test("detect: berry metadata is unknown-to-classic (berry format)", () => {
  const d = detectYarnLockFormat(read("berry-v6", "yarn.lock"));
  assert.equal(d.format, "berry");
  assert.equal(d.berry, true);
  assert.equal(d.metadataVersion, 6);
  assert.equal(d.coverage, "unknown");
});

test("detect: berry workspace lockfile", () => {
  const d = detectYarnLockFormat(read("berry-workspace", "yarn.lock"));
  assert.equal(d.format, "berry");
  assert.equal(d.reason, "metadata_block");
});

test("detect: git conflict markers", () => {
  const d = detectYarnLockFormat(read("hostile-conflict-markers", "yarn.lock"));
  assert.equal(d.format, "unknown");
  assert.equal(d.reason, "git_conflict_markers");
  assert.equal(d.hostile, true);
});

test("detect: empty is unknown", () => {
  const d = detectYarnLockFormat(read("empty", "yarn.lock"));
  assert.equal(d.format, "unknown");
  assert.equal(d.reason, "empty");
});

test("parse classic-simple: unique versions and multi-key same version", () => {
  const parsed = parseYarnLock(read("classic-simple", "yarn.lock"));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.format, "classic-v1");
  assert.equal(parsed.coverage, "classic-v1-entries");
  assert.equal(parsed.entries.length, 2);
  const widget = parsed.entries.find((e) => e.keys.includes("demo-widget@^1.0.0"));
  assert.equal(widget.version, "1.0.0");
  assert.match(widget.resolved, /demo-widget-1\.0\.0\.tgz/);
  assert.equal(widget.dependencies["left-pad"], "^1.1.0");
  const pad = parsed.entries.find((e) => e.keys.includes("left-pad@^1.1.0"));
  assert.deepEqual(pad.keys, ["left-pad@^1.1.0", "left-pad@^1.1.3"]);
  assert.equal(pad.version, "1.3.0");
});

test("parse classic-alias: npm alias descriptor kept as a single key", () => {
  const parsed = parseYarnLock(read("classic-alias", "yarn.lock"));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries.length, 1);
  assert.deepEqual(parsed.entries[0].keys, ["widget@npm:demo-widget@^1.0.0"]);
  assert.equal(parsed.entries[0].version, "1.2.3");
});

test("parse classic-conflict: both lodash versions kept (not first-wins)", () => {
  const parsed = parseYarnLock(read("classic-conflict", "yarn.lock"));
  assert.equal(parsed.ok, true);
  const lodash = parsed.entries.filter((e) => e.keys.some((k) => k.startsWith("lodash@")));
  assert.equal(lodash.length, 2);
  const versions = lodash.map((e) => e.version).sort();
  assert.deepEqual(versions, ["3.10.1", "4.17.21"]);
});

test("parse scoped multi-key and nested scoped dependency", () => {
  const parsed = parseYarnLock(read("classic-scoped-multikey", "yarn.lock"));
  assert.equal(parsed.ok, true);
  const pkg = parsed.entries.find((e) => e.keys[0].startsWith("@scope/pkg@"));
  assert.deepEqual(pkg.keys, ["@scope/pkg@^1.0.0", "@scope/pkg@~1.2.0"]);
  assert.equal(pkg.version, "1.2.4");
  assert.equal(pkg.dependencies["@scope/helper"], "^2.0.0");
});

test("parse file: locator", () => {
  const parsed = parseYarnLock(read("classic-file-workspace", "yarn.lock"));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries[0].version, "0.0.0");
  assert.equal(parsed.entries[0].resolved, "file:packages/local-widget");
});

test("parse berry: ok=false, no invented entries", () => {
  const parsed = parseYarnLock(read("berry-v6", "yarn.lock"));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.format, "berry");
  assert.equal(parsed.coverage, "unknown");
  assert.equal(parsed.reason, "yarn_berry_unsupported");
  assert.deepEqual(parsed.entries, []);
  assert.ok(parsed.unknownReasons.includes("yarn_berry_unsupported"));
});

test("parse unclosed quote: unknown", () => {
  const parsed = parseYarnLock(read("hostile-unclosed-quote", "yarn.lock"));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.coverage, "unknown");
  assert.equal(parsed.reason, "unclosed_quote");
});

test("parse conflict markers: unknown", () => {
  const parsed = parseYarnLock(read("hostile-conflict-markers", "yarn.lock"));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reason, "git_conflict_markers");
});

test("parse BOM + CRLF classic lockfile", () => {
  const inner = read("classic-simple", "yarn.lock").replace(/\n/g, "\r\n");
  const text = `\uFEFF${inner}`;
  const parsed = parseYarnLock(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].version, "1.0.0");
});

test("nul byte is hostile unknown", () => {
  const parsed = parseYarnLock("# yarn lockfile v1\n\0foo@^1:\n  version \"1.0.0\"\n");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.detection.reason, "nul_byte");
});

test("header-only classic lockfile is ok with zero entries", () => {
  const parsed = parseYarnLock("# yarn lockfile v1\n\n");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries.length, 0);
});

test("integrity may be unquoted", () => {
  const text = `# yarn lockfile v1

foo@^1.0.0:
  version "1.0.0"
  resolved "https://registry.yarnpkg.com/foo/-/foo-1.0.0.tgz#abc"
  integrity sha1-LzcHPRq8jktc3aqqmNar2ZqKVdg=
`;
  const parsed = parseYarnLock(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries[0].integrity, "sha1-LzcHPRq8jktc3aqqmNar2ZqKVdg=");
});
