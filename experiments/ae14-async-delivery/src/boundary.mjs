export class BoundaryError extends Error {
  constructor(code) {
    super(code);
    this.name = "BoundaryError";
    this.code = code;
  }
}

export function requireThat(test, code) {
  if (!test) throw new BoundaryError(code);
}

export const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/;
export const ATOMIC = /^(0|[1-9][0-9]{0,77})$/;
export const ADDR = /^0x[a-f0-9]{40}$/;
export const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
export const SHA256 = /^[a-f0-9]{64}$/;

export function atomic(value) {
  requireThat(typeof value === "string" && ATOMIC.test(value), "atomic");
  return BigInt(value);
}

export function id(value, code) {
  requireThat(typeof value === "string" && ID.test(value), code);
  return value;
}

export function address(value, code) {
  requireThat(typeof value === "string" && ADDR.test(value) && value !== ZERO_ADDR, code);
  return value;
}

export function refusal(code, fields = {}) {
  return {
    ok: false,
    schemaVersion: "ae14.async-delivery.v1",
    qualification: "pending-join",
    canonicalJoin: "pending-join",
    acceptedSettled: false,
    paymentCompleted: false,
    fundedAcceptance: false,
    usefulWork: false,
    code,
    statusCode: code === "forbidden" ? 403 : 409,
    ...fields,
  };
}
