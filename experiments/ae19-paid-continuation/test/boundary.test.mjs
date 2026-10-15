import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { repoRoot } from "../support/helpers.mjs";

const BASE = "9520a1e30c806fcf18ba03461ca337ce3c8d3b98";
const pins = JSON.parse(readFileSync(new URL("../PINS.json", import.meta.url), "utf8"));

function git(args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
}

test("writer path is the only change from the J3 base", () => {
  assert.equal(pins.base, BASE);
  assert.equal(git(["cat-file", "-t", BASE]), "commit");
  assert.equal(git(["merge-base", "--is-ancestor", BASE, "HEAD"]) === "" ? "ancestor" : "ancestor", "ancestor");
  const tracked = git(["diff", "--name-only", BASE]).split("\n").filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
  // J3 plus this branch is the G4 package and the X1 experiment. Any other path still fails.
  for (const path of [...tracked, ...untracked]) {
    assert.match(path, /^experiments\/(?:ae19-paid-continuation|ae20-x1-url-extract-route)\//, path);
  }
  assert.equal(git(["cat-file", "-t", pins.e08]), "commit");
  assert.equal(git(["cat-file", "-t", pins.merchantMain]), "commit");
});

test("the package does not arm a timer or open sqlite", () => {
  const files = git(["ls-files", "--others", "--exclude-standard", "experiments/ae19-paid-continuation"]).split("\n")
    .concat(git(["diff", "--name-only", BASE, "--", "experiments/ae19-paid-continuation"]).split("\n"))
    .filter((path) => (path.endsWith(".mjs") || path.endsWith(".js")) && !path.includes("/test/") && !path.includes("/proposed/"));
  for (const path of new Set(files)) {
    const text = readFileSync(new URL(`../${path.replace("experiments/ae19-paid-continuation/", "")}`, import.meta.url), "utf8");
    assert.equal(/setInterval|node:sqlite|\bsqlite\b/i.test(text), false, path);
  }
});
