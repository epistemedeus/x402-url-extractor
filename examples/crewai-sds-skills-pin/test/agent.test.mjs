import assert from "node:assert/strict";
import test from "node:test";

import { buildCrewaiAgentSkills, pythonConstructor } from "../src/agent.mjs";
import { DEFAULT_SKILLS_ROOT } from "../src/paths.mjs";
import { AGENT_BACKSTORY, AGENT_GOAL, AGENT_ROLE, SKILL_NAMES } from "../src/pins.mjs";

test("Agent.skills is a local one-element list, never a registry ref", () => {
  const report = buildCrewaiAgentSkills();
  assert.deepEqual(Object.keys(report.agent), ["role", "goal", "backstory", "skills"]);
  assert.equal(report.agent.role, AGENT_ROLE);
  assert.equal(report.agent.goal, AGENT_GOAL);
  assert.equal(report.agent.backstory, AGENT_BACKSTORY);
  assert.equal(Array.isArray(report.agent.skills), true);
  assert.equal(report.agent.skills.length, 1);
  assert.equal(report.agent.skills[0], DEFAULT_SKILLS_ROOT);
  assert.equal(report.agent.skills[0].startsWith("@"), false);
  assert.equal(/^https?:/i.test(report.agent.skills[0]), false);
  assert.deepEqual(report.skills.map((skill) => skill.name), [...SKILL_NAMES]);
});

test("copyable Python constructor uses Path and Agent.skills=[SDS_SKILLS]", () => {
  const source = pythonConstructor(DEFAULT_SKILLS_ROOT);
  assert.match(source, /^from pathlib import Path\nfrom crewai import Agent\n/);
  assert.match(source, /skills=\[SDS_SKILLS\],/);
  assert.equal(source.includes("crewai skill publish"), false);
  assert.equal(source.includes("crewai skill install"), false);
  assert.equal(source.includes("@"), false);
});
