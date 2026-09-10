/**
 * Optional probe of the pack analyzer (src/ or scripts/cli.mjs) once the
 * integrator wires it. Absence is not a failure of this cell.
 *
 * Only assertion that matters: scanning install-scripts must not create
 * SCRIPT_RAN.marker and must not be treated as nextAction=action.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { PACK_ROOT, casePath } from "./cases.mjs";

export function packAnalyzerPresent(packRoot = PACK_ROOT) {
  const src = path.join(packRoot, "src");
  const cli = path.join(packRoot, "scripts", "cli.mjs");
  const srcFiles = fs.existsSync(src)
    ? fs.readdirSync(src).filter((n) => n.endsWith(".mjs") || n.endsWith(".js"))
    : [];
  return {
    cli: fs.existsSync(cli) ? cli : null,
    srcFiles: srcFiles.map((n) => path.join(src, n)),
    present: Boolean(fs.existsSync(cli) || srcFiles.length > 0),
  };
}

export function probePackAnalyzer({ packRoot = PACK_ROOT, timeout = 15000 } = {}) {
  const installRoot = casePath("install-scripts");
  const marker = path.join(installRoot, "SCRIPT_RAN.marker");
  const before = fs.existsSync(marker);
  const loc = packAnalyzerPresent(packRoot);
  if (!loc.present) {
    return {
      present: false,
      skipped: true,
      reason: "pack analyzer not wired yet (src/ and scripts/cli.mjs empty)",
      markerExistedBefore: before,
      markerExistsAfter: fs.existsSync(marker),
    };
  }

  const env = {
    ...process.env,
    npm_config_ignore_scripts: "true",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
  };

  const runs = [];
  if (loc.cli) {
    const manifest = path.join(installRoot, "package.json");
    const proc = spawnSync(
      process.execPath,
      [
        loc.cli,
        "analyze",
        "--manifest",
        manifest,
        "--source-root",
        installRoot,
        "--dep",
        "hostile-install-scripts",
        "--old",
        "0.0.0-synthetic",
        "--new",
        "0.0.0-synthetic",
        "--clock",
        "2026-09-10T12:00:00.000Z",
        "--evidence-class",
        "fixture",
      ],
      {
        encoding: "utf8",
        timeout,
        cwd: packRoot,
        env,
      },
    );
    runs.push({
      kind: "cli",
      status: proc.status,
      error: proc.error ? String(proc.error.message || proc.error) : null,
      stdout: (proc.stdout || "").slice(0, 8000),
      stderr: (proc.stderr || "").slice(0, 2000),
    });
  }

  return {
    present: true,
    skipped: false,
    markerExistedBefore: before,
    markerExistsAfter: fs.existsSync(marker),
    runs,
  };
}
