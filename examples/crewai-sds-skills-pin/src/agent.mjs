import { pinLocalSdsSkills } from "./pin.mjs";
import { AGENT_BACKSTORY, AGENT_GOAL, AGENT_ROLE, SCHEMA } from "./pins.mjs";

export function pythonConstructor(skillsRoot) {
  const escaped = JSON.stringify(skillsRoot);
  return [
    "from pathlib import Path",
    "from crewai import Agent",
    "",
    `SDS_SKILLS = Path(${escaped}).resolve()`,
    "agent = Agent(",
    `    role=${JSON.stringify(AGENT_ROLE)},`,
    `    goal=${JSON.stringify(AGENT_GOAL)},`,
    `    backstory=${JSON.stringify(AGENT_BACKSTORY)},`,
    "    skills=[SDS_SKILLS],",
    ")",
    "",
  ].join("\n");
}

export function buildCrewaiAgentSkills(options = {}) {
  const pinned = pinLocalSdsSkills(options);
  const skills = [pinned.skillsRoot];
  return Object.freeze({
    ok: true,
    schema: SCHEMA,
    agent: Object.freeze({
      role: AGENT_ROLE,
      goal: AGENT_GOAL,
      backstory: AGENT_BACKSTORY,
      skills,
    }),
    skills: pinned.skills,
    pin: Object.freeze({
      source: "local-checkout",
      skillsRoot: pinned.skillsRoot,
      algorithm: "sha256",
      gitBlob: "sha1(\"blob \" + len + NUL + bytes)",
      skillFile: "SKILL.md",
    }),
    boundary: Object.freeze({
      registry: false,
      remoteFetch: false,
      payment: false,
      publish: false,
      llm: false,
      crewaiImport: false,
    }),
    python: pythonConstructor(pinned.skillsRoot),
  });
}
