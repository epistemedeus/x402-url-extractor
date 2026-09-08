export function issue(fields) {
  return {
    code: fields.code,
    message: fields.message,
    field: fields.field ?? null,
    pointer: fields.pointer ?? null,
    recordId: fields.recordId ?? null,
    repair: fields.repair ?? null,
    location: fields.location ?? null,
  };
}

export function boundedList(maximum) {
  const items = [];
  Object.defineProperties(items, {
    total: { value: 0, writable: true },
    codes: { value: new Set() },
  });
  Object.defineProperty(items, "push", {
    value(...values) {
      for (const value of values) {
        this.total += 1;
        this.codes.add(value.code);
        if (this.length < maximum) Array.prototype.push.call(this, value);
        else this.truncated = true;
      }
      return this.length;
    },
  });
  return items;
}
