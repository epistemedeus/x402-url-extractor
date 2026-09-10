/**
 * Lifecycle-script policy: detect, never execute.
 * Marker scripts in fixtures/hostile/install-scripts write SCRIPT_RAN.marker
 * only if someone actually runs them — tests assert that file stays absent.
 */

export const LIFECYCLE_SCRIPTS = Object.freeze([
  "preinstall",
  "install",
  "postinstall",
  "preuninstall",
  "uninstall",
  "postuninstall",
  "prepublish",
  "prepare",
  "preprepare",
  "postprepare",
  "prepack",
  "postpack",
  "prepublishOnly",
  "postpublish",
  "dependencies",
]);

export const PACKAGE_MANAGERS = Object.freeze(["npm", "npx", "yarn", "pnpm", "bun", "corepack"]);

export function listLifecycleScripts(manifest) {
  const scripts = manifest && typeof manifest === "object" ? manifest.scripts : null;
  if (!scripts || typeof scripts !== "object") return [];
  const present = [];
  for (const name of LIFECYCLE_SCRIPTS) {
    if (Object.prototype.hasOwnProperty.call(scripts, name) && typeof scripts[name] === "string") {
      present.push({ name, command: scripts[name] });
    }
  }
  return present;
}

export function isPackageManagerInvocation(command, args = []) {
  const cmd = String(command || "").split(/[\\/]/).pop() || "";
  const base = cmd.replace(/\.exe$/i, "");
  if (PACKAGE_MANAGERS.includes(base.toLowerCase())) return true;
  const joined = [base, ...args.map(String)].join(" ");
  if (/\bnpm\s+(i|install|ci|rebuild|explore)\b/i.test(joined)) return true;
  if (/\byarn\s+(install|rebuild)\b/i.test(joined)) return true;
  if (/\bpnpm\s+(i|install|rebuild)\b/i.test(joined)) return true;
  return false;
}
