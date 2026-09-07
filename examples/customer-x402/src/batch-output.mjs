import {
  LIVE_BATCH_PRODUCT,
  LIVE_BATCH_SCHEMA_VERSION,
  LIVE_BATCH_AMOUNT_ATOMIC,
} from "./constants.mjs";

const SOURCE_STATUSES = new Set([
  "pending", "success", "partial", "failure", "unknown", "skipped_duplicate",
]);

function fieldValue(object, path) {
  return path.split(".").reduce((current, key) =>
    current != null && Object.hasOwn(current, key) ? current[key] : undefined, object);
}

const TOP_FIELDS = ["ok", "product", "schemaVersion", "quote", "jobId", "jobStatus",
  "stopReason", "partial", "sources", "accounting", "costInputs", "charged", "boundary"];
const JOB_STATUSES = new Set(["running", "completed", "completed_with_unknown", "stopped", "interrupted"]);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nullableObject = value => value === null || isObject(value);
const nullableString = value => value === null || typeof value === "string";

// Narrow snapshot of the public batch v0 HTTP output contract, not a general
// schema engine. Row identity and selected-field checks below add buyer intent.
function assertSellerShape(body) {
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  for (const key of TOP_FIELDS) require(Object.hasOwn(body, key), `seller field missing: ${key}`);
  require(Object.keys(body).every(key => TOP_FIELDS.includes(key) || key === "error"), "unexpected batch response field");
  require(isObject(body.quote) && body.quote.displayUsdc === "0.01" && typeof body.quote.meaning === "string", "invalid batch quote");
  require(typeof body.jobId === "string" && /^[a-f0-9]{64}$/.test(body.jobId), "invalid batch jobId");
  require(JOB_STATUSES.has(body.jobStatus), "invalid batch jobStatus");
  require(nullableString(body.stopReason), "invalid batch stopReason");
  for (const key of ["accounting", "costInputs", "boundary"]) require(isObject(body[key]), `invalid batch ${key}`);
  require(!Object.hasOwn(body, "error") || typeof body.error === "string", "invalid batch error");
  require(Array.isArray(body.sources) && body.sources.length >= 1 && body.sources.length <= 5, "invalid batch sources");
  for (const [index, row] of body.sources.entries()) {
    require(isObject(row), `sources[${index}] must be an object`);
    for (const key of ["id", "source", "status", "data", "notes", "error", "provenance"]) {
      require(Object.hasOwn(row, key), `sources[${index}] missing ${key}`);
    }
    require(nullableObject(row.data) && nullableObject(row.error) && nullableObject(row.provenance), `sources[${index}] invalid nullable object`);
    require(Array.isArray(row.notes), `sources[${index}] notes must be an array`);
    require(!Object.hasOwn(row, "finalUrl") || nullableString(row.finalUrl), `sources[${index}] invalid finalUrl`);
    require(!Object.hasOwn(row, "httpStatus") || row.httpStatus === null || Number.isInteger(row.httpStatus), `sources[${index}] invalid httpStatus`);
  }
}

/**
 * Validate paid batch JSON against the seller contract and buyer intent.
 * A structurally valid paid attempt may still be only partial.
 */
export function validateBatchBuyerOutput(body, authorization) {
  const requiredOutput = authorization.requiredOutput;
  const batch = authorization.batch;
  if (!batch?.urls?.length) {
    return { valid: false, delivery: "invalid", reason: "authorization is missing batch urls", report: null };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, delivery: "invalid", reason: "batch body must be a JSON object", report: null };
  }
  try {
    assertSellerShape(body);
    const wire = Buffer.byteLength(JSON.stringify(body));
    if (wire > requiredOutput.maxResponseBytes) {
      return { valid: false, delivery: "invalid", reason: "response exceeds authorized maxResponseBytes", report: null };
    }
    for (const field of requiredOutput.requiredFields) {
      const value = fieldValue(body, field);
      if (value === undefined) {
        return { valid: false, delivery: "invalid", reason: `required field is missing: ${field}`, report: null };
      }
    }
    if (body.product !== LIVE_BATCH_PRODUCT) {
      return { valid: false, delivery: "invalid", reason: "product does not match seller contract", report: null };
    }
    if (body.schemaVersion !== LIVE_BATCH_SCHEMA_VERSION) {
      return { valid: false, delivery: "invalid", reason: "schemaVersion does not match seller contract", report: null };
    }
    if (body.quote?.amountAtomic !== LIVE_BATCH_AMOUNT_ATOMIC) {
      return { valid: false, delivery: "invalid", reason: "quote.amountAtomic does not match seller contract", report: null };
    }
    if (typeof body.ok !== "boolean" || typeof body.partial !== "boolean" || typeof body.charged !== "boolean") {
      return { valid: false, delivery: "invalid", reason: "ok/partial/charged must be booleans", report: null };
    }
    if (!Array.isArray(body.sources)) {
      return { valid: false, delivery: "invalid", reason: "sources must be an array", report: null };
    }
    if (body.sources.length !== batch.urls.length) {
      return {
        valid: false,
        delivery: "invalid",
        reason: `sources length ${body.sources.length} does not match submitted URL count ${batch.urls.length}`,
        report: null,
      };
    }
    const seenIds = new Set();
    let usefulRows = 0;
    let failedOrPartialRows = 0;
    for (let index = 0; index < batch.urls.length; index += 1) {
      const row = body.sources[index];
      const expectedUrl = batch.urls[index];
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return { valid: false, delivery: "invalid", reason: `sources[${index}] must be an object`, report: null };
      }
      if (row.id !== `item-${String(index + 1).padStart(3, "0")}`) {
        return { valid: false, delivery: "invalid", reason: `sources[${index}].id does not match submitted identity`, report: null };
      }
      if (seenIds.has(row.id)) {
        return { valid: false, delivery: "invalid", reason: `duplicate source id ${row.id}`, report: null };
      }
      seenIds.add(row.id);
      if (row.source !== expectedUrl) {
        return {
          valid: false,
          delivery: "invalid",
          reason: `sources[${index}].source does not match submitted URL order/identity`,
          report: null,
        };
      }
      if (!SOURCE_STATUSES.has(row.status)) {
        return { valid: false, delivery: "invalid", reason: `sources[${index}].status is unsupported`, report: null };
      }
      if (row.status === "success") {
        if (row.data == null || typeof row.data !== "object" || Array.isArray(row.data)) {
          return { valid: false, delivery: "invalid", reason: `sources[${index}].data must be an object on success`, report: null };
        }
        for (const field of batch.fields) {
          if (!Object.prototype.hasOwnProperty.call(row.data, field)) {
            return {
              valid: false,
              delivery: "invalid",
              reason: `sources[${index}] missing requested field ${field}`,
              report: null,
            };
          }
          // Seller permits explicit null for some fields (e.g. description).
        }
        usefulRows += 1;
      } else if (row.status === "partial" || row.status === "failure" || row.status === "unknown" ||
                 row.status === "skipped_duplicate" || row.status === "pending") {
        failedOrPartialRows += 1;
        if (row.data != null && typeof row.data === "object" && !Array.isArray(row.data)) {
          for (const field of batch.fields) {
            if (Object.prototype.hasOwnProperty.call(row.data, field) && row.data[field] === undefined) {
              return {
                valid: false,
                delivery: "invalid",
                reason: `sources[${index}] has undefined for field ${field}`,
                report: null,
              };
            }
          }
        }
      }
    }
    if (usefulRows === batch.urls.length && failedOrPartialRows === 0 && body.ok === true && body.partial === false
        && body.jobStatus === "completed" && body.stopReason === null && body.charged === true && !Object.hasOwn(body, "error")) {
      return {
        valid: true,
        delivery: "useful",
        reason: null,
        report: { usefulRows, failedOrPartialRows, rowCount: batch.urls.length },
      };
    }
    if (usefulRows + failedOrPartialRows === batch.urls.length) {
      return {
        valid: true,
        delivery: "partial",
        reason: "bounded attempt retained with non-success rows or incomplete overall status; not a refund or retry signal",
        report: { usefulRows, failedOrPartialRows, rowCount: batch.urls.length },
      };
    }
    return { valid: false, delivery: "invalid", reason: "unable to classify batch rows", report: null };
  } catch (error) {
    return { valid: false, delivery: "invalid", reason: error.message, report: null };
  }
}
