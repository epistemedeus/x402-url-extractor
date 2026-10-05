/**
 * In-process observation seal. A JSON round-trip or object spread cannot revive
 * it: the mark is a module Symbol and is not enumerable. Disk reads canonicalize
 * without a seal. Append and caller declarations require the live object.
 */

const SEAL = Symbol("samedaydesk.deliveryObservation");
const PAYLOAD = Symbol("samedaydesk.deliveryObservationPayload");
const RECORD_SEAL = Symbol("samedaydesk.deliveryRecordObservation");

const DIGEST_RE = /^[0-9a-f]{64}$/;
const SOURCES = new Set([
  "observed_response_bytes",
  "http_response_capture",
  "mcp_tool_result",
]);

function copyBytes(bytes) {
  if (bytes === undefined || bytes === null) return null;
  if (Buffer.isBuffer(bytes)) return Buffer.from(bytes);
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return null;
}

/**
 * Sibling modules seal bytes they actually hashed. Callers cannot pass a plain
 * object with the same field names and have it treated as captured output.
 */
export function createDeliveryObservation(fields = {}) {
  if (!SOURCES.has(fields.source)) return null;
  if (typeof fields.responseDigest !== "string" || !DIGEST_RE.test(fields.responseDigest)) return null;
  if (!Number.isInteger(fields.responseByteLength) || fields.responseByteLength < 0) return null;
  const observation = {
    source: fields.source,
    responseDigest: fields.responseDigest,
    responseByteLength: fields.responseByteLength,
    tool: fields.tool ?? null,
    productSku: fields.productSku ?? null,
    resource: fields.resource ?? null,
    issuedOfferDigest: fields.issuedOfferDigest ?? null,
    callId: fields.callId ?? null,
    callDigest: fields.callDigest ?? null,
    settlementReference: fields.settlementReference ?? null,
    paidEvidenceId: fields.paidEvidenceId ?? null,
    method: fields.method ?? null,
    httpResource: fields.httpResource ?? null,
    applicationIsError: fields.applicationIsError === true,
    outputRetained: true,
    captured: true,
  };
  Object.defineProperty(observation, SEAL, { value: true });
  Object.defineProperty(observation, PAYLOAD, { value: copyBytes(fields.payload) });
  return Object.freeze(observation);
}

export function isSealedDeliveryObservation(value) {
  return Boolean(
    value
    && typeof value === "object"
    && value[SEAL] === true
    && value.outputRetained === true
    && value.captured === true
    && SOURCES.has(value.source),
  );
}

export function observationPayload(observation) {
  if (!isSealedDeliveryObservation(observation)) return null;
  const payload = observation[PAYLOAD];
  return Buffer.isBuffer(payload) ? payload : null;
}

export function sealDirectBytes({
  paidEvidenceId = null,
  responseDigest,
  responseByteLength,
  method = null,
  resource = null,
  payload = null,
} = {}) {
  return createDeliveryObservation({
    source: "observed_response_bytes",
    responseDigest,
    responseByteLength,
    paidEvidenceId,
    method,
    httpResource: resource,
    payload,
  });
}

/** Full-stream digest from capturePaidEvidenceResponseDigest. Retained bytes may be a prefix. */
export function sealStreamedHttpCapture({
  digest,
  byteLength,
  bytes = null,
  paidEvidenceId = null,
  method = null,
  resource = null,
} = {}) {
  return createDeliveryObservation({
    source: "http_response_capture",
    responseDigest: digest,
    responseByteLength: byteLength,
    paidEvidenceId,
    method,
    httpResource: resource,
    payload: bytes,
  });
}

export function bindDeliveryObservation(observation, { paidEvidenceId = null } = {}) {
  if (!isSealedDeliveryObservation(observation)) return null;
  if (observation.paidEvidenceId && paidEvidenceId && observation.paidEvidenceId !== paidEvidenceId) {
    return null;
  }
  return createDeliveryObservation({
    source: observation.source,
    responseDigest: observation.responseDigest,
    responseByteLength: observation.responseByteLength,
    tool: observation.tool,
    productSku: observation.productSku,
    resource: observation.resource,
    issuedOfferDigest: observation.issuedOfferDigest,
    callId: observation.callId,
    callDigest: observation.callDigest,
    settlementReference: observation.settlementReference,
    paidEvidenceId: paidEvidenceId || observation.paidEvidenceId || null,
    method: observation.method,
    httpResource: observation.httpResource,
    applicationIsError: observation.applicationIsError === true,
    payload: observationPayload(observation),
  });
}

/**
 * Emission follows a captured observation, not an incident id list.
 * The seal's paid evidence id must already be bound to this call.
 */
export function httpDeliveryEmissionAllowed(paidEvidenceId, observation) {
  if (typeof paidEvidenceId !== "string" || paidEvidenceId.length === 0) return false;
  if (!isSealedDeliveryObservation(observation)) return false;
  return observation.paidEvidenceId === paidEvidenceId;
}

export function attachRecordObservation(record, observation) {
  if (!record || typeof record !== "object") {
    throw new Error("retained output is absent for this paid evidence id");
  }
  if (!isSealedDeliveryObservation(observation) || !observation.paidEvidenceId) {
    throw new Error("retained output is absent for this paid evidence id");
  }
  const slim = createDeliveryObservation({
    source: observation.source,
    responseDigest: observation.responseDigest,
    responseByteLength: observation.responseByteLength,
    tool: observation.tool,
    productSku: observation.productSku,
    resource: observation.resource,
    issuedOfferDigest: observation.issuedOfferDigest,
    callId: observation.callId,
    callDigest: observation.callDigest,
    settlementReference: observation.settlementReference,
    paidEvidenceId: observation.paidEvidenceId,
    method: observation.method,
    httpResource: observation.httpResource,
    applicationIsError: observation.applicationIsError === true,
  });
  if (!slim) throw new Error("retained output is absent for this paid evidence id");
  Object.defineProperty(record, RECORD_SEAL, { value: slim });
  return record;
}

export function recordObservation(record) {
  if (!record || typeof record !== "object") return null;
  const seal = record[RECORD_SEAL];
  return isSealedDeliveryObservation(seal) ? seal : null;
}
