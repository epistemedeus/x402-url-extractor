# c14 — hostile input cases

Owned writes: this directory, `fixtures/hostile/`, `test/hostile.test.mjs`.

Isolation contract: `scanHostileInputs()` inspects an untrusted package tree
without executing lifecycle scripts, following escape symlinks, or treating
partial/conflicting input as `action`.

All fixtures are **fixture / synthetic**. Not live-capture. Not paid demand.

```bash
node --test test/hostile.test.mjs
node cells/c14-hostile/materialize.mjs
```
