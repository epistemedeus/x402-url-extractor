#!/usr/bin/env node
import { resolve } from "node:path";

import { buildCrewaiAgentSkills } from "../src/agent.mjs";
import { SkillsPinError } from "../src/errors.mjs";
import { assertLocalSkillRef } from "../src/load-skill.mjs";
import { DEFAULT_SKILLS_ROOT, DIGEST_MISMATCH_PINS, EXAMPLE_ROOT } from "../src/paths.mjs";
import { loadPinsFile } from "../src/pin.mjs";
import { SKILL_PINS } from "../src/pins.mjs";

function usage(exitCode = 0) {
  const text = `SameDayDesk CrewAI SDS skills digest-pin example

Populate CrewAI Agent.skills=[] from local SDS SKILL.md files after sha256
size and git-blob pins match. Never fetches a registry, never publishes,
never pays, and never imports crewai.

Default (checkout plugins/samedaydesk-x402/skills):
  npm start
  node bin/cli.mjs

Copyable CLI:
  node bin/cli.mjs
  node bin/cli.mjs --skills-root ../../plugins/samedaydesk-x402/skills

Seeded failure (digest mismatch, exit 1):
  npm run seeded-failure
  node bin/cli.mjs --seeded-failure
  node bin/cli.mjs --pins ./fixtures/seeded-failure/digest-mismatch.json

Notes:
  - Agent.skills is a one-element list: the local skills parent directory.
    CrewAI discover_skills scans children for SKILL.md.
  - Pins are sha256 + byte length + git blob of each SKILL.md.
  - Registry refs (@org/name) and remote URLs are refused.
  - This is not a CrewAI registry publish, not payment, and not an LLM run.
`;
  console.log(text);
  process.exit(exitCode);
}

function parseCli(argv) {
  const args = {
    help: false,
    seededFailure: false,
    skillsRoot: DEFAULT_SKILLS_ROOT,
    pinsPath: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--seeded-failure") args.seededFailure = true;
    else if (token === "--skills-root") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--skills-root requires a path");
      args.skillsRoot = resolve(EXAMPLE_ROOT, assertLocalSkillRef(value, "--skills-root"));
    } else if (token === "--pins") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--pins requires a path");
      args.pinsPath = resolve(EXAMPLE_ROOT, assertLocalSkillRef(value, "--pins"));
    } else if (token === "--skills") {
      const value = argv[++i];
      throw new SkillsPinError(
        `Agent.skills extra refs are refused (pass a local --skills-root instead): ${value}`,
        { kind: value?.startsWith("@") ? "registry_ref" : "invalid_ref", details: { value } },
      );
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  if (args.seededFailure && args.pinsPath) {
    throw new Error("cannot combine --seeded-failure with --pins");
  }
  if (args.seededFailure) args.pinsPath = DIGEST_MISMATCH_PINS;
  return args;
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseCli(argv);
  } catch (error) {
    const message = error instanceof SkillsPinError
      ? `${error.kind}: ${error.message}`
      : String(error?.message || error);
    console.error(message);
    if (!(error instanceof SkillsPinError) && /unknown argument/.test(message)) usage(1);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    usage(0);
    return;
  }
  try {
    const pins = args.pinsPath ? loadPinsFile(args.pinsPath) : SKILL_PINS;
    const report = buildCrewaiAgentSkills({
      skillsRoot: args.skillsRoot,
      pins,
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const message = error instanceof SkillsPinError
      ? `${error.kind}: ${error.message}`
      : String(error?.message || error);
    console.error(message);
    process.exitCode = 1;
  }
}

main();
