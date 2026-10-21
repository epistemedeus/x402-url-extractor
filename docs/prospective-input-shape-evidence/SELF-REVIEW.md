ROOT1862 self-review

Reviewed the complete diff against f31abbce319037bfe7bb98dcd859b598ef041ee5.
Only extract-batch.mjs and commerce-events.mjs change runtime behavior. Three
focused test files and this receipt directory are the remaining changes.

The validator's original branch order, predicates, public refusal bodies and
schemas remain intact. Stage assignments annotate its actual progression. Its
error carries only four static/capped fields. Earlier body/key refusals explicitly
leave urls uninspected; a getter regression verifies the telemetry cannot inspect
a later input after an earlier refusal. Array counts are empty, in_range (1–5)
or over_limit; all other counts are null. Scalars group JSON strings, booleans
and numbers without retaining values. Body and URL types distinguish absent,
null, scalar, object and array. There are at most 24 admitted aggregate keys.

A response-bound WeakMap is an ephemeral internal handoff populated only by
validateExtractBatchRequest. It does not add a journal or persistence mechanism.
Telemetry requires its existing exact route/method/status/construction/replay/
settlement gates, the observed strict semantic response, and a matching handoff
code before retaining the classification. Caller-supplied res.locals, forged
public bodies, crossed response codes and parser errors cannot supply it.
Metadata work is caught separately; a failed metadata read preserves the original
semantic refusal. Valid requests perform no refusal-metadata work.

The strict canonical reader rejects the entire contradictory/malformed record,
matching the existing code-field policy. Missing/null historical shape and code
remain unknown. No reader rewrites history. Summary counts use the same already
filtered external population/window and expose known/unknown shape coverage.
They do not attribute the nine earlier urls_invalid events or establish identity,
wallet cause, validator defect, usefulness, customer count or demand.

Review finding corrected: the first checkpoint allowed the fixed not_inspected
sentinel but omitted it from the declaration. The final contract explicitly lists
bodyTypes and urlsTypes, including that sentinel, and declares maxUrls=5. Stage
input is checked as a string before allowlist lookup. Added per-stage adversarial
checks, historical absent/null coverage, and the early-input inspection regression.
No open source finding remains.

Mounted controls exercise actual server.js, disposable COMMERCE_DATA_DIR,
synthetic loopback facilitator, journal, normal /v0/commerce-demand.json, paid
result and replay. They include absent/scalar/null/object/empty/over-limit URLs,
earlier/later refusals, secret/arbitrary-key markers, parser/body limits, other
routes/methods and origin populations. Concurrent HTTP append/read, five real
5 MiB rotations, restart and malformed-line recovery preserve existing bounds.
Rotation uses owned whitespace padding to reach the actual writer threshold;
that padding is test fault/control input, not evidence of continuous observation.
Injected corrupt records intentionally remain stored, while public summaries
quarantine them and reveal no marker. Producer-created records do not retain any
secret markers or arbitrary input property names.

ROOT1595's unchanged ordinary-delivery-coverage cases remain part of the existing
ordinary-delivery-join suite. No coverage/admission/retention/join implementation
changes, new plane, monitor or ledger are introduced. Source changes naturally
invalidate incompatible old source-bound cuts through the existing digest.
Cross-process exclusivity and event-time closure stay unproven. Fixtures prove
source behavior only: Root must independently receive/install and check genuine
future eligible uses; earlier refusals remain unexplained.
