import { format, usedRemoved } from "s127-golden-kit";

/**
 * Synthetic caller (label: synthetic).
 * Static surface: named imports format + usedRemoved from "s127-golden-kit".
 * Dynamic surface: s127-golden-kit/plugin via import() — member usage unknown.
 * unusedRemoved is deliberately not imported.
 */
export async function run(value) {
  const plugin = await import("s127-golden-kit/plugin");
  return format(usedRemoved(value), plugin);
}
