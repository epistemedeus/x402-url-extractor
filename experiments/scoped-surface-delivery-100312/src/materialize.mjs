import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assertInside(root, file) {
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  const rel = path.relative(realRoot, realFile);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw Object.assign(new Error("path_escape"), { code: "path_traversal" });
  }
}

export function materializeInventory(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-surface-"));
  const tree = path.join(root, "tree");
  fs.mkdirSync(tree, { mode: 0o700 });
  try {
    for (const file of files) {
      const dest = path.resolve(tree, file.path);
      const rel = path.relative(tree, dest);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw Object.assign(new Error("path_escape"), { code: "path_traversal" });
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      const existing = fs.existsSync(dest) ? fs.lstatSync(dest) : null;
      if (existing?.isSymbolicLink()) {
        throw Object.assign(new Error("symlink"), { code: "symlink" });
      }
      const fd = fs.openSync(dest, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
      try {
        fs.writeFileSync(fd, file.bytes);
      } finally {
        fs.closeSync(fd);
      }
      const listed = fs.lstatSync(dest);
      if (listed.isSymbolicLink() || !listed.isFile()) {
        throw Object.assign(new Error("symlink"), { code: "symlink" });
      }
      assertInside(tree, dest);
    }
    walkRejectSymlinks(tree);
    return { root, tree };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function assertTreeSafe(dir) {
  walkRejectSymlinks(dir);
}

function walkRejectSymlinks(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const listed = fs.lstatSync(file);
    if (listed.isSymbolicLink()) {
      throw Object.assign(new Error("symlink"), { code: "symlink" });
    }
    if (listed.isDirectory()) walkRejectSymlinks(file);
  }
}

export function removeTree(root) {
  if (root) fs.rmSync(root, { recursive: true, force: true });
}
