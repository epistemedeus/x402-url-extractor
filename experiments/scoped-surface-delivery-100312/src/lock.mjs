import { spawnSync } from "node:child_process";
import fs from "node:fs";

// Directory-inode flock, the maintained-operations protocol: flock locks the
// parent's open file description and exits; this fd holds the lock until close.
export function withDirectoryLock(dir, fn) {
  const fd = fs.openSync(dir, "r");
  try {
    const child = spawnSync("flock", ["--exclusive", "--timeout", "5", "3"], {
      stdio: ["ignore", "ignore", "pipe", fd],
    });
    if (child.error || child.status !== 0) {
      const code = child.status === 1 ? "lock_timeout" : "lock_unavailable";
      throw Object.assign(new Error(code), { code });
    }
    return fn();
  } finally {
    fs.closeSync(fd);
  }
}
