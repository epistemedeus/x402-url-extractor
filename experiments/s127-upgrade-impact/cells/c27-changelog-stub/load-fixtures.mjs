import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_ROOT = join(here, "fixtures");

export function loadFixtures(root = FIXTURES_ROOT) {
  const files = listJsonFiles(root);
  return files.map((filePath) => {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    return {
      filePath,
      relPath: filePath.slice(root.length + 1),
      ...raw,
    };
  });
}

function listJsonFiles(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name === "PROVENANCE.json") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) listJsonFiles(full, acc);
    else if (name.endsWith(".json")) acc.push(full);
  }
  return acc;
}
