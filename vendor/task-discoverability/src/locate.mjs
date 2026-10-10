import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findRepoFile(start, relative) {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
