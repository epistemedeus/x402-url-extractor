# c02 synthetic lockfile fixtures

All files in this directory are **synthetic** (hand-written). They are not
live-capture. No registry URLs were fetched to produce them.

Integrity / resolved URL strings are placeholders so parsers have fields to
read. Do not treat them as registry evidence.

| Directory | What it proves |
| --- | --- |
| `alias-npm-v3/` | `npm:pkg@version` alias matches package-lock v3 `name` |
| `disagreement-range-npm-v3/` | manifest range vs locked version → conflict / unknown |
| `alias-target-mismatch-npm-v3/` | alias target ≠ lockfile `name` → conflict / unknown |
| `workspace-npm-v3/` | `workspace:*` + `link` entry → reported, identity unknown for registry |
| `alias-pnpm-v9/` | pnpm-lock.yaml v9 importer alias |
| `disagreement-pnpm-v9/` | pnpm specifier vs locked version disagreement |
| `alias-yarn-v1/` | yarn.lock v1 alias descriptor |
| `alias-yarn-berry/` | Yarn Berry YAML alias + `resolution` |
| `exact-npm-v3/` | exact pin, no alias, range satisfied |
| `shrinkwrap-alias/` | npm-shrinkwrap.json same as lock v3 |
| `missing-lockfile/` | package.json only |
| `unsupported-cargo/` | Cargo.lock is unsupported → unknown |
| `multiple-lockfiles/` | package-lock.json + yarn.lock without `lockfilePath` |
| `override-npm-v3/` | `overrides` explaining a range miss |
| `scoped-npm-v3/` | `@scope/name` direct dep |
| `file-protocol/` | `file:` spec → non-registry unknown |
| `npm-v1-dependencies/` | lockfileVersion 1 `dependencies` tree |
| `pnpm-v6-alias/` | pnpm-lock v6 `/name@version` package keys |
| `hostile-proto/` | `__proto__` key ignored; real dep still resolves |
