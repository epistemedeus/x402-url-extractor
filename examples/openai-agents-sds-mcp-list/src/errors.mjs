export class PolicyRefusal extends Error {
  constructor(message, { field = null } = {}) {
    super(message);
    this.name = "PolicyRefusal";
    this.code = "policy_refused";
    this.field = field;
  }
}

export class InventoryError extends Error {
  constructor(message, { field = null } = {}) {
    super(message);
    this.name = "InventoryError";
    this.code = "inventory_refused";
    this.field = field;
  }
}

export function isRefusal(error) {
  return error instanceof PolicyRefusal || error instanceof InventoryError;
}
