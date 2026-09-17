export class UnpaidCallError extends Error {
  constructor(message, { kind = "rejected", details = null } = {}) {
    super(message);
    this.name = "UnpaidCallError";
    this.kind = kind;
    this.details = details;
  }
}

export function fail(message, options) {
  throw new UnpaidCallError(message, options);
}
