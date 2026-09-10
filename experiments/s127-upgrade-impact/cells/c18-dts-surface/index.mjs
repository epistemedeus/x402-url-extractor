/**
 * c18 bounded .d.ts export surface — integrator entry.
 *
 * Named exports are the contract. Does not write outside this cell.
 * Does not claim a TypeScript checker.
 */

export { EXTRACT_SCHEMA, extractFromText, exportNames } from "./extract.mjs";
export { tokenizeDts } from "./tokenize.mjs";
export { detectTypescriptApi, engineRecord } from "./engine.mjs";
export { extractPackageTypes } from "./types-entry.mjs";
export { USAGE_SCHEMA, analyzeTypeUsage, extractUsageFromText } from "./usage.mjs";
export { DIFF_SCHEMA, BIND_SCHEMA, diffDtsSurfaces, bindDtsUsage } from "./diff.mjs";
export { runCase, runAllCases, listCaseIds, CLOCK } from "./run.mjs";
export { CELL_ROOT, isolationSnapshot, assertNoScriptRan } from "./isolation.mjs";
