export class ListError extends Error {
  constructor(message, { code = "list_error", field = null, exitCode = 2 } = {}) {
    super(message);
    this.name = "ListError";
    this.code = code;
    this.field = field;
    this.exitCode = exitCode;
  }
}

export function fail(message, options) {
  throw new ListError(message, options);
}
