import assert from "node:assert/strict";
import test from "node:test";

import { WELL_KNOWN_SKILL_NAMES } from "../../../well-known-skills.mjs";
import {
  titleFromPromptName,
  UNPAID_PROMPT_DISCOVERY_NOTE,
  UNPAID_PROMPT_NAMES,
  unpaidPromptCatalog,
} from "../src/catalog.mjs";

test("unpaid prompt catalog is the three public well-known skills", () => {
  const catalog = unpaidPromptCatalog();
  assert.deepEqual(UNPAID_PROMPT_NAMES, [...WELL_KNOWN_SKILL_NAMES]);
  assert.deepEqual(catalog.map((prompt) => prompt.name), ["web-extract", "page-change", "explicit-record"]);
  assert.equal(catalog.length, 3);
  assert.equal(titleFromPromptName("web-extract"), "Web Extract");
  for (const prompt of catalog) {
    assert.equal(prompt.title, titleFromPromptName(prompt.name));
    assert.ok(prompt.description.length > 0);
    assert.match(prompt.markdown, /^---\nname: /);
    assert.equal(prompt.markdown.includes("\uFEFF"), false);
  }
  assert.match(UNPAID_PROMPT_DISCOVERY_NOTE, /does not authorize payment/);
});

test("catalog rejects a skill that is not on the unpaid allowlist", () => {
  assert.throws(
    () => unpaidPromptCatalog([{ name: "extract", description: "paid", markdown: "---\nname: extract\n---\n" }]),
    /rejected skill name extract/,
  );
});
