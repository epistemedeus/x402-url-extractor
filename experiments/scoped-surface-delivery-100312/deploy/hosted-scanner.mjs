import { fileURLToPath } from "node:url";
import { loadScannerArtifact } from "./artifact.mjs";
import { skillguardMatches } from "../src/scanner-pin.mjs";

// Deployment resolution only. A customer request must not reach this with a
// fetch, and a missing pin must not throw into the merchant process.
export const DEFAULT_SCANNER_ARTIFACT = fileURLToPath(new URL("./runtime-artifact/", import.meta.url));
export function resolveHostedScanner(env = process.env, defaultArtifact = DEFAULT_SCANNER_ARTIFACT) {
  try {
    if (typeof env.SCOPED_SURFACE_SCANNER_ARTIFACT === "string" && env.SCOPED_SURFACE_SCANNER_ARTIFACT.length) {
      const loaded = loadScannerArtifact(env.SCOPED_SURFACE_SCANNER_ARTIFACT);
      return { skillguardRoot: loaded.skillguardRoot, scannerSource: "artifact" };
    }
    if (typeof env.SKILLGUARD_ROOT === "string" && env.SKILLGUARD_ROOT.length) {
      if (!skillguardMatches(env.SKILLGUARD_ROOT)) return { skillguardRoot: null, scannerSource: "unavailable" };
      return { skillguardRoot: env.SKILLGUARD_ROOT, scannerSource: "pin" };
    }
    const loaded = loadScannerArtifact(defaultArtifact);
    return { skillguardRoot: loaded.skillguardRoot, scannerSource: "packaged" };
  } catch {
    return { skillguardRoot: null, scannerSource: "unavailable" };
  }
  return { skillguardRoot: null, scannerSource: "unavailable" };
}
