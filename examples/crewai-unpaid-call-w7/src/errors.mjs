export class CrewaiUnpaidCallError extends Error {
  constructor(message, { code = "REFUSED", kind = "refused", details = null } = {}) {
    super(message);
    this.name = "CrewaiUnpaidCallError";
    this.code = code;
    this.kind = kind;
    this.details = details;
  }
}

export function fail(message, options) {
  throw new CrewaiUnpaidCallError(message, options);
}
