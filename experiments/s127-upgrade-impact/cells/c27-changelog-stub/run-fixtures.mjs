#!/usr/bin/env node
import { decideFromChangelog } from "./changelog.mjs";
import { compareBaselineToBinder } from "./compare.mjs";
import { loadFixtures } from "./load-fixtures.mjs";

const fixtures = loadFixtures();
const rows = [];
for (const fixture of fixtures) {
  const result = decideFromChangelog(fixture.input);
  const expect = fixture.expect || {};
  const match =
    result.decision === expect.decision &&
    result.ruleId === expect.ruleId &&
    (expect.delta == null || result.delta === expect.delta);
  const contrast = fixture.binderWould
    ? compareBaselineToBinder(result, { summary: { nextAction: fixture.binderWould.coarse } })
    : null;
  rows.push({
    id: fixture.id,
    label: fixture.label,
    expected: expect.decision,
    decision: result.decision,
    ruleId: result.ruleId,
    match,
    binderCoarse: fixture.binderWould?.coarse || null,
    decisionChangedRelativeToChangelog: contrast
      ? contrast.decisionChangedRelativeToChangelog
      : null,
  });
}

const failed = rows.filter((row) => !row.match);
console.log(
  JSON.stringify(
    {
      cell: "c27-changelog-stub",
      baseline: "A",
      usageBinding: false,
      count: rows.length,
      failed: failed.length,
      rows,
    },
    null,
    2,
  ),
);
if (failed.length > 0) {
  console.error(`fixture mismatches: ${failed.map((row) => row.id).join(", ")}`);
  process.exit(1);
}
