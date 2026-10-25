// Test-only preload. Some owning suites intentionally construct child envs
// from an allowlist; carry the admitted resource profile across that boundary.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const preload = `--import=${import.meta.url}`;
function limited(options = {}) {
  const env = { ...(options.env || process.env) };
  let nodeOptions = env.NODE_OPTIONS || process.env.NODE_OPTIONS || "";
  if (!nodeOptions.includes(preload)) nodeOptions += ` ${preload}`;
  env.NODE_OPTIONS = `${nodeOptions} --max-old-space-size=512`.trim();
  env.UV_THREADPOOL_SIZE = "1";
  env.OMP_NUM_THREADS = "1";
  return { ...options, env };
}
for (const name of ["spawn", "spawnSync"]) {
  const original = childProcess[name];
  childProcess[name] = (command, args, options) => Array.isArray(args)
    ? original(command, args, limited(options))
    : original(command, limited(args));
}
syncBuiltinESMExports();
