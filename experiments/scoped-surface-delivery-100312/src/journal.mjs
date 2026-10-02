import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fileFor(dir) {
  return path.join(dir, "journal.json");
}

export function openJournal(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = fileFor(dir);
  function read() {
    if (!fs.existsSync(file)) return { rows: [] };
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || !Array.isArray(parsed.rows)) throw new Error("journal_unreadable");
    return parsed;
  }
  function write(data) {
    const tmp = path.join(dir, `.journal-${process.pid}.tmp`);
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(data));
      fs.fchmodSync(fd, 0o600);
      fs.closeSync(fd);
      fs.renameSync(tmp, file);
      fs.chmodSync(file, 0o600);
    } catch (error) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw error;
    }
  }
  return {
    list() {
      return read().rows;
    },
    get(id) {
      return read().rows.find((row) => row.id === id) || null;
    },
    put(row) {
      const data = read();
      const prior = data.rows.find((item) => item.id === row.id);
      const revision = prior ? prior.revision + 1 : 1;
      const ownerId = prior?.ownerId || `own-${randomBytes(8).toString("hex")}`;
      const next = { ...row, revision, ownerId };
      data.rows = data.rows.filter((item) => item.id !== row.id).concat(next);
      write(data);
      return next;
    },
    revoke(id) {
      const data = read();
      const row = data.rows.find((item) => item.id === id);
      if (!row) return null;
      row.revoked = true;
      row.revision += 1;
      write(data);
      return row;
    },
  };
}
