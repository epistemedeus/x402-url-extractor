import { spawn } from "node:child_process";

// One deadline and one output cap cover the owned child. The caller cannot
// choose the executable. A kill is an inconclusive stop, never a clean scan.
export function runBoundedChild({ command, args, cwd, env, deadlineMs, maxStdout, maxStderr }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const started = process.hrtime.bigint();
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let overOutput = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, deadlineMs);
    child.stdout.on("data", (chunk) => {
      if (overOutput) return;
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > maxStdout) {
        overOutput = true;
        stdout = stdout.subarray(0, maxStdout);
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > maxStderr) {
        stderr = stderr.subarray(0, maxStderr);
        overOutput = true;
        child.kill("SIGKILL");
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({
        code,
        signal,
        timedOut,
        overOutput,
        cancelled: timedOut || overOutput || signal === "SIGKILL",
        stdout,
        stderr,
        wallMs,
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        code: null,
        signal: null,
        timedOut: false,
        overOutput: false,
        cancelled: true,
        stdout,
        stderr,
        wallMs: Number(process.hrtime.bigint() - started) / 1e6,
        error: error.code || "spawn_failed",
      });
    });
  });
}
