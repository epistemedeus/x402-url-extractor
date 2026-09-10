# Symlink / archive bombs — described, not created

This directory contains **one** out-of-tree symlink (`escape-link` → `/etc/passwd`)
and **one** in-tree symlink (`in-tree-link` → `package.json`). That is enough
to prove `lstat` + `readlink` refusal.

The following were **not** materialized because they can hang walkers, fill
disks, or confuse extractors:

1. **Recursive self-link** — `ln -s . ./self` or `ln -s $PWD $PWD/loop`. A
   `realpath`-following walker loops until stack/path-length exhaustion.
   Analyzer must never `fs.realpath` untrusted trees; cap walk entries/depth;
   never follow symlinks when enumerating.
2. **Mutual loop** — `a → b` and `b → a` across directories.
3. **Zip bomb** — overlapping DEFLATE entries (classic `42.zip`) that expand
   to terabytes. Do not fetch or store one. Cap decompressed bytes if a pack
   ever inflates archives.
4. **Tar slip** — archive member named `../../../../etc/cron.d/evil` or
   `/etc/passwd`. Extract with `tar` to a fresh directory and reject members
   whose resolved path escapes the destination (same rule as manifest
   traversal). Never `npm install` the tarball.
5. **Device nodes / `/dev/zero` as source** — reading never completes. Cap
   read size; `lstat` and refuse non-regular files.
6. **Hundreds of thousands of directory entries** — walk cap (`MAX_WALK_ENTRIES`)
   must return `unknown` / partial coverage rather than hanging.

Packet rule: missing/partial/conflicting source ⇒ `unknown`, not `action`.
Escaping symlink ⇒ `invalid` input, `nextAction` still `unknown`.

Label: fixture / synthetic. Not live-capture. Not paid demand.
