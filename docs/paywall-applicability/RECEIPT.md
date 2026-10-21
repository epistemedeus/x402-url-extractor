# ROOT2191 bounded applicability

Source f171b2d44ae53f0b65d0ed0298f162a1d7c37e51; package-lock SHA256
212c78b62206723b04af693e8c828541953b97db92342cd8135268f854236be7.
`npm ci --ignore-scripts --no-audit --no-fund`; execute
`node --test paywall-applicability.http.test.mjs` on loopback only.

The actual server uses @x402/express/core/evm 2.16.0, literal paid paths,
Express 4, no legacy x402-express and no registered @x402/paywall producer.
The compatibility JSON body adapter adds v1 field aliases; it is not v1 routing.
HTML selection additionally requires Mozilla User-Agent in this SDK. Without
@x402/paywall, it emits a static fallback rather than inline window.x402 config.
Invalid script-bearing Host/forwarded-host authorities return 500 before the
challenge; this is observed rejection, not a claim of correct 400 handling.

Upstream issue3850 targets legacy v1 decoded parameter separators; issue3852
uses a registered v2 inline paywall producer. PR3857/3855 own the corrections.
We do not copy either patch or upgrade dependencies. Regression drives server.js
with exact lockfile dependencies, unpaid default/JSON/browser HTML requests,
encoded separators/path/query, raw script termination query and hostile authority,
plus free health control. No verify/settle/payment or external fetch is permitted.

Installed-source 8ac6b44e156a0468a94d615e95c68a6b7dec284c differs only in free
page-change observation wiring and its supporting files; lockfile/payment gate
unchanged. Runtime and live deployment remain untested; no production requests.
Full bounded receipt and command output are exported to the assigned owner.
