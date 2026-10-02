// Source pins for the scoped surface candidate. Hashes are the received bytes.
// Private Neo and Pilot sources are declared here and hydrated outside this
// public tree. They are not copied into the merchant repository.

export const MERCHANT_COMMIT = "c1518cce1b60799044cfd8b8a749abb150299a63";
export const PILOT_CONTEXT = "64c83609faf6a44d9d8a76930546a06313100033";
export const SOL_RETURN = "29c80e6b4aa19a437af3870489281b7820cd6cc7";

export const SKILLGUARD = Object.freeze({
  repo: "https://github.com/epistemedeus/skillguard.git",
  commit: "beec14acbb56de37cd361acc949087b9ae019b70",
  version: "1.3.0",
  licenseDeclared: "MIT",
  licenseFile: null,
  files: Object.freeze({
    "package.json": "0d3779302eed7a84e2ecd276fc4b42cd4413d2033d3a335d2b324c6780fb7cdd",
    "index.js": "65889c7f283609f0881707f24bbee1b82efdc8b66ce68adb02c24eb57ec59ab1",
    "report.js": "8ca493009a9500c8da0e70caf9702db4f7df5babfe0a7ef61b5f06f40dc2480f",
    "rules.js": "896b876ee972b9f0b81ff44f01c6c43d5f6b625809b77ceba2539d00eb5b3ad3",
    "secrets.js": "7334d84f3034630ad01469b6b556af880b861719ebd54d9923541ac08a3f2662",
    "version.js": "e6ea4e3e6cb72d77dd8eea7e5d49261af8850be9039350343b09d87bf99f142d",
    "mcp.js": "4e9b6ad6c1634d63e41c33c4fdad304eda28a365ec084964390b07fd92ef7d0e",
  }),
});

export const ACCEPTED_DERIVATIVE = Object.freeze({
  repo: "https://github.com/epistemedeus/neomorphic-io.git",
  commit: "a7bd87116a4e8285e779b10e549fc4c1cd179674",
  path: "packages/accepted-derivative/src/index.mjs",
  sha256: "fcd9d9c10c1a82154384f367fa7c3fc9096d234978609a1c45ade819eb102e5b",
  private: true,
  foundation272: "4dbd9612a2d263d464bbf7c782a7e1211c164dcb",
  inputTotality283: "a7bd87116a4e8285e779b10e549fc4c1cd179674",
});

export const PROTOCOL_ENVELOPE_203 = Object.freeze({
  repo: "https://github.com/epistemedeus/pilot.git",
  commit: "d0bff9127bd609137a32167b0120d0382ca7225e",
  branch: "codex/protocol-compatibility-foundation-100203",
  role: "declared-source-not-copied",
});

export const MAINTAINED_LOCK_222 = Object.freeze({
  repo: "https://github.com/epistemedeus/neomorphic-io.git",
  commit: "ba7e32612568c967907828f340aa5ba7cfa91afc",
  path: "experiments/maintained-operations-100184/src/persist.mjs",
  role: "declared-source-not-copied",
});

export const COMMERCE_BINDING_301 = Object.freeze({
  module: "commerce-outcome-binding.mjs",
  merchantCommit: MERCHANT_COMMIT,
  operationId: "scoped-surface-scan",
  cohort: "owner_qa",
});

export const RULE_IDS = Object.freeze([
  "env-dump",
  "env-exfil",
  "exfil-host",
  "obfuscation",
  "shell-pipe",
  "forced-artifact",
  "secret-literal",
  "prompt-injection",
  "dangerous-perms",
  "install-hook",
  "committed-binary",
  "symlink-escape",
]);

export const LIMITS = Object.freeze({
  maxFiles: 32,
  maxPathLength: 180,
  maxFileBytes: 64 * 1024,
  maxAggregateBytes: 256 * 1024,
  maxOutputBytes: 16 * 1024,
  deadlineMs: 2000,
  maxDeadlineMs: 5000,
  minDeadlineMs: 20,
  maxStatement: 240,
  maxStderrBytes: 1024,
});

export const NEGATIVE_LIMITS = Object.freeze([
  "The scanner reads supplied text and does not execute it.",
  "A no-match on these rules is not a universal security guarantee.",
  "blanketSafetyScore is null. This candidate does not emit a trust score.",
  "An unverified local report is not a scan and is not process authority.",
  "A payment receipt, HTTP 200, or a caller label is not sharing authority.",
  "Git URLs, installers, and shell commands are not targets.",
]);

export const SCHEMA = "samedaydesk.scoped-surface.v1";
export const RETEST_SCHEMA = "samedaydesk.scoped-surface.retest.v1";
export const REGRESSION_SCHEMA = "samedaydesk.scoped-surface.regression.v1";
export const PRICE_SCHEMA = "samedaydesk.scoped-surface.price-proposal.v1";
export const TASK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const CONCERN_DECIDE = "scanner-cannot-decide";
export const SOURCE_ID = "scoped-surface-retest";
export const TERMS_VERSION = "scoped-surface-100312";
export const SUBJECT_ID = "caller-tree";
export const TOOL_ID = "skillguard";
