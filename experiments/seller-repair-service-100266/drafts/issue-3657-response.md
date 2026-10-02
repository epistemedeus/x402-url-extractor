# Draft response for x402-foundation/x402#3657

Status: draft only. Root decides whether to publish. This file is not a GitHub comment.

## Their report, kept separate

parthod0x reports that a resource server accepted payment only on POST, while the reference Python client retried the prepared request that had received the 402. In their log, `GET /x402/provision` and `GET /x402/receipt` on `https://api.satledger.org` received a challenge, and the same GET carrying `PAYMENT-SIGNATURE` was refused with "required, by POST". They describe four payment attempts among 6,259 external requests, all refused, and the loss of their only buyer. Those counts and that loss are their report. They are not our logs.

They also say they have already changed that behavior. Presence of `PAYMENT-SIGNATURE` is now the discriminator, a request without it still receives the challenge, and they have since settled a real payment carried on GET on Base mainnet. They kept a HEAD restriction as their own remaining policy. We did not re-verify the settlement, the current server, or that policy. The report's provenance is the issue text.

## What we are not claiming

This is a historical compatibility case. It is not evidence that the provider is still broken, not an unpaid order, and not our revenue. We are not proposing another repair of `api.satledger.org`. RFC 9110 does not make GET, HEAD, or DELETE content uniformly illegal, and it does not prove that HEAD can never be a paid resource. Their remaining HEAD rule is their policy, not a protocol absolute we are asking them to change.

## Our replay

A supplied replay of the historical disagreement (discovering method GET, prepared-request retry, accepted method POST) is a mismatch on that evidence. Because they report the later change, and we did not verify it, the current decision is unknown: `historical_report_not_current`. `safeToPay` stays false. The stored report is not spend authority and does not stay current.

The free command, once Root hosts seller-repair-external-consumer 0.4.0, is:

```bash
node package/bin/caller-deliver.mjs deliver --request request.json
```

`request.json` is the caller's own file. The tool does not ship their capture as a default, does not send a payment header, and does not POST to their origin. `hostedAcquisitionVerified` is still false. Until Root hosts the bytes, the same replay on this branch is:

```bash
node experiments/seller-repair-service-100266/bin/commercial-path.mjs deliver \
  --request experiments/seller-repair-service-100266/cases/method-issue-3657.json
```

A later process that supplies a fresh method, body, or client input gets a new decision. The historical artifact does not authorize that call.
