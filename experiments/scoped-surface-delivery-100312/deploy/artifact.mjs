import fs from "node:fs";
import path from "node:path";

import { SKILLGUARD } from "../src/pins.mjs";
import { skillguardMatches } from "../src/scanner-pin.mjs";

export const ARTIFACT_SCHEMA = "samedaydesk.scoped-surface.scanner-artifact.v1";

export function buildScannerArtifact(skillguardRoot, destDir) {
  if (!skillguardMatches(skillguardRoot)) {
    throw Object.assign(new Error("scanner_pin_mismatch"), { code: "scanner_pin_mismatch" });
  }
  const filesDir = path.join(destDir, "files");
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(filesDir, { recursive: true, mode: 0o755 });
  for (const rel of Object.keys(SKILLGUARD.files)) {
    const target = path.join(filesDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(skillguardRoot, rel), target);
  }
  const manifest = {
    schema: ARTIFACT_SCHEMA,
    commit: SKILLGUARD.commit,
    version: SKILLGUARD.version,
    licenseDeclared: SKILLGUARD.licenseDeclared,
    licenseFile: SKILLGUARD.licenseFile,
    npmDependencies: {},
    fetchedOnRequest: false,
    files: { ...SKILLGUARD.files },
  };
  fs.writeFileSync(path.join(destDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  if (!skillguardMatches(filesDir)) throw Object.assign(new Error("scanner_pin_mismatch"), { code: "scanner_pin_mismatch" });
  return { destDir, manifest, skillguardRoot: filesDir };
}

export function loadScannerArtifact(destDir) {
  const manifestPath = path.join(destDir, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw Object.assign(new Error("scanner_artifact_unreadable"), { code: "scanner_artifact_unreadable" });
  }
  if (manifest?.schema !== ARTIFACT_SCHEMA || manifest.commit !== SKILLGUARD.commit || manifest.version !== SKILLGUARD.version) {
    throw Object.assign(new Error("scanner_pin_mismatch"), { code: "scanner_pin_mismatch" });
  }
  const root = path.join(destDir, "files");
  if (!skillguardMatches(root)) throw Object.assign(new Error("scanner_pin_mismatch"), { code: "scanner_pin_mismatch" });
  return { skillguardRoot: root, manifest, fetchedOnRequest: false };
}
