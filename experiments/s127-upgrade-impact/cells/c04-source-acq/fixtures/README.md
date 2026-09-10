# c04 fixture packs

Synthetic stub packages for offline source acquisition. **Not npm publications.**
Default evidence class / packet label is `fixture`. Nothing here is a live-capture.

| name@version | coverage | layout |
| --- | --- | --- |
| `s127-demo-lib@1.0.0` | full tarball | unpacked `packs/…/package/` + `tarballs/*.tgz` |
| `s127-demo-lib@2.0.0` | full tarball | same; export surface changed vs 1.0.0 |
| `s127-demo-lib@0.9.0` | partial page | `version-document.json` only |
| `s127-demo-lib@9.9.9` | missing | catalog marker, no files |
| `@s127/tiny@1.0.0` | full tarball | scoped path `packs/@s127/tiny/1.0.0/package/` |

Rebuild tarballs and hashes (no npm):

```
node cells/c04-source-acq/pack-fixtures.mjs
```

`package.json` includes failing `preinstall`/`install`/`postinstall` scripts so a mistaken `npm install` is visible (`LIFECYCLE_RAN.txt`). Acquire must never run them.
