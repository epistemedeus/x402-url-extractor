export class UnpaidListError extends Error {
  constructor(message, { code = "unpaid_list_error", field = null } = {}) {
    super(message);
    this.name = "UnpaidListError";
    this.code = code;
    this.field = field;
  }
}

export function fail(message, code, field = null) {
  throw new UnpaidListError(message, { code, field });
}
