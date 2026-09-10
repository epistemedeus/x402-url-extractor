# Hostile fixtures (c14)

**Label: `fixture` / synthetic. Not live-capture. Not paid demand.**

These trees exist so the upgrade-impact analyzer can be shown to:

1. Refuse path traversal in manifest fields without reading escaped targets.
2. Cap an enormous `exports` map and return `unknown` with partial coverage.
3. Detect lifecycle scripts and **never execute them**.
4. Treat out-of-tree symlinks as invalid; not follow them.
5. Treat lockfile disagreement as `unknown` (packet rule 5).
6. Treat a binary file declared as source as `unknown`, not a crash and not a caller defect.

Do not `npm install` anything here. Do not extract `install-scripts/untrusted.tgz` with a package manager. List or extract with `tar` only.

## Cases

| id | path | expected decision | nextAction |
| --- | --- | --- | --- |
| path-traversal | `path-traversal/` | invalid | unknown |
| install-scripts | `install-scripts/` | unknown | unknown |
| enormous-exports | `enormous-exports/` | unknown | unknown |
| symlink-bomb | `symlink-bomb/` | invalid | unknown |
| conflicting-lockfile | `conflicting-lockfile/` | unknown | unknown |
| binary-source | `binary-source/` | unknown | unknown |

`symlink-bomb/DESCRIPTION.md` documents zip bombs, recursive self-links, and tar-slip entries that were **not** created.

## Exercise

From `experiments/s127-upgrade-impact`:

```bash
node --test test/hostile.test.mjs
```

Regenerate generated bits (enormous `package.json`, PNG `index.js`, escape symlink, tarball):

```bash
node cells/c14-hostile/materialize.mjs
```
