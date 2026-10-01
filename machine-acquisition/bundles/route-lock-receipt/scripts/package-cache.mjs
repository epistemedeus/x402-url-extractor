import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";

const MAX_MEMBER_BYTES = 2 * 1024 * 1024;
const MAX_MEMBERS = 64;
const CLI_MEMBER = "package/src/cli.mjs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function lstatOrNull(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function listMembers(archivePath) {
  const output = execFileSync("tar", ["-tzf", archivePath], {
    encoding: "utf8",
    maxBuffer: MAX_MEMBER_BYTES,
  });
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

function assertSafeMembers(members) {
  if (!members.length) throw fail("unsafe_archive", "archive has no package members");
  for (const member of members) {
    if (!member.startsWith("package/") || member.startsWith("/") || member.includes("\\") || member.split("/").includes("..")) {
      throw fail("unsafe_archive", `refusing archive member ${member}`);
    }
  }
}

function fileMembers(members) {
  return members.filter((member) => !member.endsWith("/"));
}

function memberBytes(archivePath, member) {
  return execFileSync("tar", ["-xOf", archivePath, member], { maxBuffer: MAX_MEMBER_BYTES });
}

function locateMember(root, member) {
  const parts = member.split("/");
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const st = lstatOrNull(current);
    if (!st) return { missing: true };
    if (st.isSymbolicLink()) return { symlink: true };
  }
  return { stat: lstatSync(current), full: current };
}

// Extra install products such as node_modules are ignored. A missing member,
// a symlink on a member path, or bytes that differ from the archive do not match.
export function matchArchiveTree(root, archivePath) {
  const rootStat = lstatOrNull(root);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null;
  let members;
  try {
    members = listMembers(archivePath);
    assertSafeMembers(members);
  } catch (error) {
    if (error.code === "unsafe_archive") throw error;
    return null;
  }
  const expected = fileMembers(members);
  if (expected.length === 0 || expected.length > MAX_MEMBERS || !expected.includes(CLI_MEMBER)) return null;
  const digests = {};
  for (const member of expected) {
    const located = locateMember(root, member);
    if (located.missing || located.symlink || !located.stat?.isFile() || located.stat.size > MAX_MEMBER_BYTES) return null;
    let archived;
    try {
      archived = memberBytes(archivePath, member);
    } catch {
      return null;
    }
    const body = readFileSync(located.full);
    if (!body.equals(archived)) return null;
    digests[member] = sha256(body);
  }
  const lines = Object.keys(digests).sort().map((member) => `${member}\n${digests[member]}\n`).join("");
  return {
    root,
    members: expected,
    digests,
    treeSha256: sha256(Buffer.from(lines)),
    cliSha256: digests[CLI_MEMBER],
  };
}

function removeOwnStaging(directory, base) {
  const stagingRoot = path.resolve(base, ".staging");
  const resolved = path.resolve(directory);
  if (resolved !== stagingRoot && !resolved.startsWith(`${stagingRoot}${path.sep}`)) {
    throw fail("unsafe_archive", "refusing to delete an extraction this process did not stage");
  }
  rmSync(resolved, { recursive: true, force: true });
}

function adopted(match, extraction) {
  return {
    ...match,
    packageDir: path.join(match.root, "package"),
    extraction,
    markerTrusted: false,
  };
}

// A matching legacy tree/ or bound/<sha256>/ tree is reused in place.
// This process only deletes a staging directory it created. A partial,
// symlink, or edited tree is left in place and is not executed.
export function acquireExecutableTree(base, archivePath) {
  const archiveStat = lstatOrNull(archivePath);
  if (!archiveStat || archiveStat.isSymbolicLink() || !archiveStat.isFile()) {
    throw fail("cache_not_file", "pinned archive is not a regular file");
  }
  const digest = sha256(readFileSync(archivePath));
  const legacy = matchArchiveTree(path.join(base, "tree"), archivePath);
  if (legacy) return adopted(legacy, "reused");
  const bound = path.join(base, "bound", digest);
  const published = matchArchiveTree(bound, archivePath);
  if (published) return adopted(published, "reused");

  const staging = path.join(base, ".staging", `${process.pid}-${randomBytes(8).toString("hex")}`);
  mkdirSync(staging, { recursive: true });
  try {
    execFileSync("tar", ["-xzf", archivePath, "-C", staging], { stdio: "ignore" });
    const extracted = matchArchiveTree(staging, archivePath);
    if (!extracted) throw fail("unsafe_archive", "extracted tree does not match the archive");
    const boundStat = lstatOrNull(bound);
    if (!boundStat) {
      mkdirSync(path.dirname(bound), { recursive: true });
      try {
        renameSync(staging, bound);
        const confirmed = matchArchiveTree(bound, archivePath);
        if (confirmed) return adopted(confirmed, "published");
      } catch {
        // Another process published first, or the path is an unusable foreign entry.
      }
    }
    const winner = matchArchiveTree(bound, archivePath);
    if (winner) {
      removeOwnStaging(staging, base);
      return adopted(winner, "reused");
    }
    return adopted(extracted, "private");
  } catch (error) {
    removeOwnStaging(staging, base);
    throw error;
  }
}
