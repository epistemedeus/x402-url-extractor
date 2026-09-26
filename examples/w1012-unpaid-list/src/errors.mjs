export class W1012UnpaidListError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "W1012UnpaidListError";
    this.code = code;
    this.kind = extra.kind ?? null;
    this.details = extra.details ?? null;
  }
}

export function fail(code, message, extra = {}) {
  throw new W1012UnpaidListError(code, message, extra);
}
