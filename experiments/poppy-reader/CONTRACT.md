# Poppy reader adapter contract

Source-only optional adapter for one existing walletless reader task. Draft 0.3 only. This file is the consumer contract. It is not a public Poppy support claim, and it does not mount routes on the merchant.

## Routes

Lab origin and issuer are configuration (`https://reader.lab.example` and `https://issuer.lab.example` unless the caller overrides them). Request `Host` and `X-Forwarded-Proto` do not select the target.

| Method and path | Session | Behavior |
| --- | --- | --- |
| `GET /.well-known/poppy.json` | no | Draft 0.3 discovery. One OpenAPI API. No agent, feedback, scopes, or sign-in. |
| `GET /.well-known/oauth-protected-resource` | no | `resource` is the lab origin. `authorization_servers` is the configured issuer. This adapter is not an OAuth server. |
| `GET /poppy/v0/openapi.json` | no | Operation `trialRead` only. |
| `GET /poppy/v0/excluded-tasks.json` | no | Paid markdown read is excluded. The alternative is `trialRead`. |
| `POST /poppy/v0/trial-read` | required | Calls `executeBoundedTrialRead`. Same body, limits, and budget as `POST /trial/read`. |
| `GET /poppy/v0/paid-read` | required | Hidden refusal. Returns the existing unpaid x402 challenge. Not listed in OpenAPI. |

Direct merchant routes stay in place: `POST /trial/read` and MCP tool `trial_read`.

## Verifier port

The adapter refuses to start unless `verifier` is a function. Expected H64220 manifest, which this repo does not invent as a live export:

```json
{
  "schema": "h64220.poppy-core.export.v1",
  "module": "./relative-to-experiments/oct29-poppy/core.mjs",
  "export": "verifyPoppySession"
}
```

Call:

```text
verifyPoppySession({ header, method, url, authorization, issuer, now })
```

Success:

```json
{
  "ok": true,
  "session": {
    "clientId": "https://client.example/agent",
    "sid": "sid",
    "sub": "user",
    "agentId": null,
    "signedIn": false,
    "htm": "POST",
    "htu": "https://reader.lab.example/poppy/v0/trial-read",
    "aud": "https://issuer.lab.example"
  }
}
```

Failure: `{ "ok": false, "error": "invalid_session" }`. HTTP responses use only `{ "error": "invalid_session" }` with status 400.

`authorization` is omitted when the request has no `Authorization` header. `signedIn` may be true or false. The adapter does not forward the access token, does not settle payment, and does not fetch a different URL than the body or query already names.

After a success result, this adapter still refuses the handler when `htm`, `htu`, or `aud` disagree with the configured method, URL (no query or fragment), and issuer. That check is deployment binding. It is not a second signature runtime.

`evidence` is not part of the port. Callers must ignore it.

## Boundary fixture

`verifyBoundaryFixture` accepts only headers that start with `boundary-fixture:v1:`. JWT-shaped values are rejected whole. The fixture does not verify signatures or access tokens. Its `evidence` value is `boundary-fixture`. Tests may use it until H64220's fetched `EXPORT.json` names a function that loads and runs. Fixture evidence is not integrated compatibility.

## H64220 binding

Fetch `https://github.com/epistemedeus/pilot.git` branch `codex/root64220-heavy-window-20261029`. Read only `experiments/oct29-poppy/core/EXPORT.json`. Import the declared module only when it stays inside that directory and the named export is a function. Integrated compatibility requires that fetched function to have been invoked. A missing manifest means not integrated.

## Paid guard

The guard uses `@x402/express` `paymentMiddleware` with scheme `exact`, price `$0.005`, network `eip155:8453`, and payTo `0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee`, plus payment-identifier `required: false`. Those are the merchant read defaults. The adapter does not copy bazaar, builder-code, or commerce-trust extensions. It strips `payment-signature`, `x-payment`, and `x-payment-signature` before the middleware, so the facilitator is not asked to verify or settle. The challenge resource URL is the lab guard, not the caller's document URL. A bad public URL returns 400 `charged: false` before the challenge, using `assertPublicHttpUrl`. The handler behind the middleware is not the reader.

The facilitator URL must be an injected `http://127.0.0.1` URL. There is no default public facilitator.

## Budget

Pass the product `createExtractionTrialBudget`. This adapter does not open a second allowance. A shared fixture store must use the fixture clock, because the fixture authority is not valid at the real wall clock.
