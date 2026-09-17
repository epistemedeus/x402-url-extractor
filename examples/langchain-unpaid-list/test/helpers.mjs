import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = join(ROOT, "bin/cli.mjs");

export function runCliProcess(args, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== expectStatus) {
    throw new Error(
      `cli ${args.join(" ")} exited ${result.status}, expected ${expectStatus}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

export function collectStreams() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      stdoutChunks.push(Buffer.from(chunk).toString("utf8"));
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      stderrChunks.push(Buffer.from(chunk).toString("utf8"));
      cb();
    },
  });
  return {
    stdout,
    stderr,
    get stdoutText() { return stdoutChunks.join(""); },
    get stderrText() { return stderrChunks.join(""); },
  };
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
