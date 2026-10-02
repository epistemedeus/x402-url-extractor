# Draft response for x402-foundation/x402#3511

Status: draft only. Root decides whether to publish. This file is not a GitHub comment.

## Their report, kept separate

Dotman-Bei reports that bazaar `info.input` on `https://chat.gedx402.com/v1/chat/completions` follows the probing method. A GET probe declared method GET with `bodyType` `json` and a body. A POST probe declared method POST with a body. They say a client followed the GET declaration, reached the payment step, and Fetch then threw because it cannot send a GET body. They also say curl can hide the same shape by rewriting a GET with a body into POST. They observed this on 2026-09-16 and 2026-09-17. The failed call they mention is theirs. It is not our payment and not our revenue.

## What we are not claiming

Our replay uses supplied unpaid captures taken 2026-10-02T09:26:19Z. Both GET and POST returned HTTP 402, x402 version 2, scheme `exact`, network `eip155:8453`, amount `1000`, asset name USD Coin. No `PAYMENT-SIGNATURE` was sent. Amount `1000` is their challenge. It is not our price and not an order. One dated pair does not prove the service is down today, and this draft does not probe it again.

A JSON body does not mean the method is POST. RFC 9110 does not make GET, HEAD, or DELETE content uniformly illegal. The Fetch failure is a separate fact about that client: this runtime throws `TypeError: Request with GET/HEAD method cannot have body`. That limit is not a protocol ban, and it is not a reason to rewrite the method from the body type alone.

## Our replay

On those two supplied observations the declared method changes with the discovering method. The decision is `mismatch` / `declaration_follows_probe`, with the Fetch limit recorded beside it. `safeToPay` is false. The comparison is caller-supplied evidence, not an independent live execution, and it is not current forever.

The free command, once Root hosts seller-repair-external-consumer 0.4.0, is:

```bash
node package/bin/caller-deliver.mjs deliver --request request.json
```

The caller supplies the request. The archive does not embed this capture as a hidden default. Until that host exists, the branch command is:

```bash
node experiments/seller-repair-service-100266/bin/commercial-path.mjs deliver \
  --request experiments/seller-repair-service-100266/cases/method-gedx402-3511.json
```

Changing the method, the body agreement, or the client profile produces a fresh decision. Agreement, when it is present, is still not permission to pay.
