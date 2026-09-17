import { loadWellKnownSkills, WELL_KNOWN_SKILL_NAMES } from "../../../well-known-skills.mjs";

export const UNPAID_PROMPT_NAMES = WELL_KNOWN_SKILL_NAMES;

export const UNPAID_PROMPT_DISCOVERY_NOTE =
  "Unpaid MCP prompt discovery. This template does not authorize payment, execute extract, or settle.";

export function titleFromPromptName(name) {
  if (typeof name !== "string" || name.length === 0) return "";
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function unpaidPromptCatalog(skills = loadWellKnownSkills()) {
  if (!Array.isArray(skills) || skills.length === 0) {
    throw new Error("unpaid prompt catalog requires the well-known skills");
  }
  return skills.map((skill) => {
    const name = skill?.name;
    const description = skill?.description;
    const markdown = skill?.markdown;
    if (typeof name !== "string" || !UNPAID_PROMPT_NAMES.includes(name)) {
      throw new Error(`unpaid prompt catalog rejected skill name ${name}`);
    }
    if (typeof description !== "string" || description.length === 0) {
      throw new Error(`unpaid prompt catalog missing description for ${name}`);
    }
    if (typeof markdown !== "string" || !markdown.startsWith("---\n")) {
      throw new Error(`unpaid prompt catalog missing SKILL.md body for ${name}`);
    }
    return Object.freeze({
      name,
      title: titleFromPromptName(name),
      description,
      markdown,
    });
  });
}

export function unpaidPromptSummaries(catalog = unpaidPromptCatalog()) {
  return catalog.map(({ name, title, description }) => ({ name, title, description }));
}
