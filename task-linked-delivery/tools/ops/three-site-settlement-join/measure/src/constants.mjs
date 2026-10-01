export const COLLECT_SCHEMA = "pilot.three-site-measure-collect.v1";
export const BINDING_SCHEMA = "pilot.s17.outcome-binding.v1";
export const BINDING_JOB_ID = "S17-OUTCOME-BINDING-093095";
export const BINDING_ATTEMPT_OF = "S17-TREASURY-RECV-093086";
export const PRODUCER_COMMIT = "ebd6834f3501ace0948b2ad5b7a3df9ab5c6b048";
export const PUBLIC_AGGREGATE_URL = "https://agents.samedaydesk.com/v0/commerce-demand.json";
export const FORWARD_SCHEMA = "samedaydesk.outcome-binding.forward.v1";
export const FORWARD_SCHEMA_V2 = "samedaydesk.outcome-binding.forward.v2";
export const FORWARD_WRITER_ID = "x402-url-extractor.createCommerceTelemetry.forward-v2";
export const OPERATION_ID = "d93dfc13-39d2-4932-9867-8de35d4d1b03";
export const ATTEMPT_OF = "S17-SOL-REGRESS-093061";
export const JOB_ID = "S17-MEASURE-093066";
export const LEDGER_SCHEMA = "pilot/experiment-return-ledger/v1";
export const ADMITTED_SOURCE = "overview/EXPERIMENT-RETURN-LEDGER.json";
export const FIXTURE_CONTROL = "fixtures/outcome-classes-equal-value.json";
export const MAX_SOURCE_BYTES = 256_000;

export const MESSAGES = Object.freeze({
  wrong_source_schema: "source schema is not the recorded experiment-return ledger",
  wrong_source_rejected_by_observation_contract: "restricted source fields were not projected",
  wrong_source_unadmitted_path: "only the committed experiment-return ledger is the real source",
  invalid_source: "source is not a readable in-repo JSON file",
});
