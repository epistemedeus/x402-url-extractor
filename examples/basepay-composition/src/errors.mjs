export class BasePayCompositionError extends Error {
  constructor(message, { kind = "rejected", layer = null } = {}) {
    super(message);
    this.name = "BasePayCompositionError";
    this.kind = kind;
    this.layer = layer;
  }
}

export function fail(message, options) {
  throw new BasePayCompositionError(message, options);
}
