# Receiving handoff to Root

This branch owns only `task-linked-delivery/experiments/scoped-repair-commerce-100348`.
The shared edits are a reviewable patch, tested in a disposable receiving
checkout. Root owns final merge, mounting, readback, deployment and outreach.

After taking the package, copy its four candidate assets and inventory into the
existing machine acquisition tree, then check and apply the exact patch:

```sh
node task-linked-delivery/experiments/scoped-repair-commerce-100348/export/install-candidate.mjs --check
node task-linked-delivery/experiments/scoped-repair-commerce-100348/export/install-candidate.mjs --apply
git apply --check task-linked-delivery/experiments/scoped-repair-commerce-100348/route/ROOT-INTEGRATION.patch
git apply task-linked-delivery/experiments/scoped-repair-commerce-100348/route/ROOT-INTEGRATION.patch
```

The patch adds four known free routes to the existing commerce classifier,
bypasses the global JSON parser so their full allowance starts before intake,
and mounts them after telemetry and before payment middleware. It also fixes
seller classification of a present, incorrect scalar, rotates the existing
store before a bounded append would make its file unreadable, and seals historical
exporters. It changes no paid route, payment rail, signer, price or journal.
All seller predecessor archive bytes remain exact. Any future seller source
publication must use a successor version, rather than regenerate 0.2/0.3/0.4.

The acquisition additions include the client's exact archive/sidecars, inventory
and a bounded cold command that proves useful missing-input refusal. Existing
cold commands and all predecessor pins stay byte-for-byte within their entries.
The current projection must stay partial if that command is missing; an index
row alone is insufficient. Repository cold QA separately runs two supplied tasks
through the actual service. Those QA facts confer no production readback flag.

Default mount uses the already packaged public SkillGuard scanner. Missing
scanner yields `missing_task_input` with unavailable observations. No private
provider is downloaded. Optional `SCOPED_REPAIR_PACKET_DIR` must be an isolated
directory with one configured writer; absent storage still supports fresh
delivery, while accept/reuse/review explicitly refuse unavailable readback.

Root can inject `offerFor`, `publicKeys`, `retention`, `regressionFor` and
`evidenceFor` through the existing mount options. These are trusted owner
providers, never caller-supplied authority. `offerFor` reads the current unpaid
challenge for the existing audit and must honor the passed allowance;
`publicKeys` maps enrolled caller IDs to their existing verification keys.
`retention` and `regressionFor` expose an already enrolled current owner record;
this package neither enrolls a share nor writes an owner continuation.
`evidenceFor` returns an authorized read-only observer cut for the existing
causal/outcome/settlement projection. Missing providers yield unknown facts and
withheld acceptance. No module here creates a signing key or paid execution.

Do not mark current publication verified from a successful local mount. Root
must separately read back current production acquisition and execution bytes,
obtain outside-task usefulness evidence and inspect actual settlement proof.
The receiving QA uses the real routes/libraries with isolated ephemeral files;
it does not claim customer demand, saved costs, settlement or production hosting.
