import { skillMdRelativePath } from "./paths.mjs";

export const SCHEMA = "samedaydesk.crewai-sds-skills-pin.v1";
export const SKILL_FILE = "SKILL.md";
export const SKILL_MAX_BYTES = 1_048_576;
export const SKILL_NAME_PATTERN = /^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_DESCRIPTION_LENGTH = 1024;

/** Canonical SDS portable skill order (matches /.well-known/skills). */
export const SKILL_NAMES = Object.freeze([
  "web-extract",
  "page-change",
  "explicit-record",
]);

/**
 * Digest pins of checkout SDS SKILL.md files.
 * sha256 of web-extract matches plugins/samedaydesk-x402/plugin.test.mjs PRODUCT_SKILL_SHA256.
 */
export const SKILL_PINS = Object.freeze([
  Object.freeze({
    name: "web-extract",
    relativePath: skillMdRelativePath("web-extract"),
    bytes: 3324,
    sha256: "382e45d33e95b81dd27c2ab38c576118159a37af2d776bc0620ecf9b472d3551",
    gitBlobSha: "faffb077d648180d92e5bd1bfb8a76867bf6719f",
  }),
  Object.freeze({
    name: "page-change",
    relativePath: skillMdRelativePath("page-change"),
    bytes: 3938,
    sha256: "24a197775f91a002027be506b8ba60afdd10bd7d165d8a629d0b38b5f707d13a",
    gitBlobSha: "e561d5b1f84af05fdaaded5dea14128b03a13105",
  }),
  Object.freeze({
    name: "explicit-record",
    relativePath: skillMdRelativePath("explicit-record"),
    bytes: 4801,
    sha256: "509c816d00d42928249b019bfa8f072b0b414f53ff48ae195de1e02a99b17062",
    gitBlobSha: "abd78347b0a90425e9dbc065b6783772f4d7309c",
  }),
]);

export const AGENT_ROLE = "SameDayDesk portable-skill operator";
export const AGENT_GOAL =
  "Follow digest-pinned local SDS SKILL.md instructions without registry install or payment.";
export const AGENT_BACKSTORY =
  "Loads only checkout Agent Skills whose SKILL.md sha256 matches the committed pin. Does not pay, publish, or fetch skills.";

export const FORBIDDEN_SUBSTRINGS = Object.freeze([
  "PAYMENT" + "-SIGNATURE",
  "X-" + "PAYMENT",
  "Authorization" + ":",
  "Bearer" + " ",
  "api" + "_key",
  "api" + "-key",
]);
