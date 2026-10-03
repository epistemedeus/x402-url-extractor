export class ViewError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "ViewError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new ViewError(code, message);
}
