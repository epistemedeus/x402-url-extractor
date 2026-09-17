export class CrewaiUnpaidListError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "CrewaiUnpaidListError";
    this.code = code;
    this.kind = extra.kind ?? null;
    this.details = extra.details ?? null;
  }
}

export function fail(code, message, extra = {}) {
  throw new CrewaiUnpaidListError(code, message, extra);
}
