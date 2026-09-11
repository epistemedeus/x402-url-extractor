import fs from "node:fs";
import path from "node:path";

const SAMPLE_SIDECARS = ["SAMPLE.txt", "SAMPLE.md", "SAMPLE"];

export function isSampleLabeled(filePath, parsed) {
  if (!filePath) return false;
  const base = path.basename(filePath);
  if (/sample/i.test(base)) return true;
  const dir = path.dirname(filePath);
  for (const name of SAMPLE_SIDECARS) {
    if (fs.existsSync(path.join(dir, name))) return true;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.name === "SAMPLE") {
    return true;
  }
  return false;
}

export function sampleReason(filePath, parsed) {
  const base = path.basename(filePath || "");
  if (/sample/i.test(base)) return `filename ${base}`;
  if (parsed?.name === "SAMPLE") return "root package name SAMPLE";
  const dir = path.dirname(filePath || ".");
  const hit = SAMPLE_SIDECARS.find((name) => fs.existsSync(path.join(dir, name)));
  if (hit) return `sidecar ${hit}`;
  return "sample-labeled input";
}
