export class SellerRepairError extends Error {
  constructor(message, code = "invalid_intake") {
    super(message);
    this.name = "SellerRepairError";
    this.code = code;
    this.charged = false;
  }
}

export function fail(message, code) {
  throw new SellerRepairError(message, code);
}
