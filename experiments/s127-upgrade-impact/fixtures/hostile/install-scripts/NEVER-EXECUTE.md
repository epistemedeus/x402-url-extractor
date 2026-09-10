# NEVER execute these scripts

This package's `preinstall` / `install` / `postinstall` / `prepare` /
`prepublish` / `prepublishOnly` hooks only write `SCRIPT_RAN.marker` in this
directory. They are still **untrusted lifecycle scripts**.

- Do not `npm install`, `npm ci`, `yarn`, or `pnpm install` here.
- Do not `node write-marker.mjs`.
- Extract `untrusted.tgz` with `tar` only (`tar -tzf` / `tar -xzf`). Never
  `npm pack` install or `npm install ./untrusted.tgz`.
- Tests assert `SCRIPT_RAN.marker` is absent after analysis.

Label: fixture / synthetic. Not live-capture.
