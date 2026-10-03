export class FunnelError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "FunnelError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new FunnelError(code, message);
}
