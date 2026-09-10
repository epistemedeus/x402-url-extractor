/** Isolation stub for c31 CLI wiring. Not the pack schema cell. */

export const ARTIFACT_KIND = "migration-checklist";

export function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, issues: ["input_not_object"] };
  }
  if (!input.oldDoc) {
    return { ok: false, issues: ["missing_oldDoc"] };
  }
  return { ok: true, issues: [] };
}
