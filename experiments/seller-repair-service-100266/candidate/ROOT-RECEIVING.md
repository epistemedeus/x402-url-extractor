# Root receiving for seller-repair-external-consumer 0.2.0

The frozen 0.1.0 archive is `candidate/seller-repair-external-consumer-0.1.0.tar.gz`, 22870 bytes, sha256 `3f3552e9cdedff9910211b1820b229daa834cf3811fcc5b38035046cefda4a27`. Those bytes are not rewritten.

0.2.0 is the draft public-acquisition asset:

- `public-acquisition/bytes/seller-repair-external-consumer/0.2.0/seller-repair-external-consumer-0.2.0.tar.gz`
- sha256 `86e55a75f7e7e5c5ad188de8b20c64648f40c236b11981186b56abeb6d11350f`
- 30462 bytes
- sidecars: `provenance.json`, `SOURCE-NOTICE.txt`, `LICENSE`
- cold command: `deliver`, then the retained loopback `reproduce`

`hostedAcquisitionVerified` and `productionHosted` stay false. This file does not replace `public-acquisition/receiving/artifact.json`. That artifact remains the earlier readback.

The free diagnosis route is not mounted. Apply `experiments/seller-repair-service-100266/route/ROOT-SERVER-MOUNT.patch` before the paid middleware. It registers `POST /commerce/seller-repair-diagnosis` with `charged: false`. It does not add a SKU and does not change `GET /commerce/seller-integrity-audit` at `$0.01` / atomic `10000`.

Declared runtime for the consumer is Node.js `>=22.22.0`. A public proof on an older Node stays blocked by that pin. Loopback acquisition can still run the cold command. Do not mark the draft hosted from this branch.

## 2026-10-02 addendum (100308)

The paragraph above is the 100287 receiving note and stays as written. Source head `c1518cce1b60799044cfd8b8a749abb150299a63` already calls `mountSellerRepairDiagnosis` before the paid middleware. A disposable observation of production `POST /commerce/seller-repair-diagnosis` with `{}` on 2026-10-02T08:21:11Z returned HTTP 400, `charged` false, and `paymentSent` false. `hostedAcquisitionVerified` and `productionHosted` stay false. The `$0.01` audit is unchanged at atomic `10000`. The commercial lifecycle command is `node experiments/seller-repair-service-100266/bin/commercial-path.mjs`. It does not add a price, SKU, signer, or customer grant. Node on the worker that ran the disposable merchant was v22.14.0; that run is not a public receiving proof of the consumer pin.
