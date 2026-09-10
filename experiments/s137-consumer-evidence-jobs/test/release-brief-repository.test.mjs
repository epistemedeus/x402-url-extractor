// Repository-only gate: these excerpts informed synthetic fixtures, not kit metadata.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {loadSourcePins} from "../fixtures/synthetic/release-brief/load.mjs";
const PACK = join(dirname(fileURLToPath(import.meta.url)), "..");

test("source pins still appear in cited repo paths", () => {
  const pins = loadSourcePins();
  const repo = join(PACK, "../..");
  for (const pin of pins.pins) {
    const body = readFileSync(join(repo, pin.repoPath), "utf8");
    assert.equal(body.includes(pin.excerpt), true, pin.id);
  }
});

