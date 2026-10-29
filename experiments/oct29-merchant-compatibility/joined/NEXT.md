# NEXT

Root owns merge, release, PR 243, customer communication, and signer-free readback. This branch is the combined candidate. It is not merged and it is not deployed.

Production MPP stays off until Root configures it. This run did not read, copy, restore, or rotate production secrets or config.

The deciding acceptance entry is `experiments/oct29-mpp-availability/accept.mjs` at `3ab40526a63faf247b8a83ac3986b88157f3db7e`. It installs this HEAD and requires the `3da7278` lock. The `ab5bf51b` overlay against `2e197da`, and that commit's evidence directory, remain the historical H64330 record.

`2e197da` still shows the original paid-body release. `bdea3f75` is the withhold. H64202 `dbe23333` stays immutable. A settle object with no boolean `success` remains unknown and can still carry the handler body. An already `isError` result still passes through. Pending false-settlement credentials stay quarantined.

Leave package `1.23.55`, prices, recipients, `qs` `6.16.0`, and the axios pin `1.20.0`. Axios applicability stays separate from that pin. Python `mcp` `2.3.0` for the payment case came from `/tmp/oct29-mcp-py-site`.

Human HTML pages stayed equal to the preserved base capture. Machine discovery text follows the joined availability source. Loopback captures use the canonical Host and forwarded HTTPS scheme. They are not a lab TLS session.
