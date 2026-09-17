export class SkillsPinError extends Error {
  constructor(message, { kind = "rejected", details = null } = {}) {
    super(message);
    this.name = "SkillsPinError";
    this.kind = kind;
    this.details = details;
  }
}

export function fail(message, options) {
  throw new SkillsPinError(message, options);
}
