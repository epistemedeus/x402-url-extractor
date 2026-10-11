// Runs every file from the repository's existing pretest/test scripts with a
// bounded worker count on the shared VM. It does not edit those scripts.
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
for (const name of ["pretest", "test"]) {
  const command = pkg.scripts[name];
  const words = command.split(/\s+/);
  if (words[0] !== "node" || words[1] !== "--test" || words.some(word => !/^[A-Za-z0-9_.:/=-]+$/.test(word))) {
    throw new Error("unexpected_normal_suite_command");
  }
  const argv = ["--test", "--test-concurrency=1", ...words.slice(2)];
  process.stdout.write(`${JSON.stringify({ script: name, originalCommand: command, executable: process.execPath, argv })}\n`);
  const child = spawn(process.execPath, argv, { stdio: "inherit", env: process.env });
  const code = await new Promise(resolve => child.once("exit", code => resolve(code)));
  process.stdout.write(`${JSON.stringify({ script: name, exitCode: code })}\n`);
  if (code !== 0) process.exit(code || 1);
}
